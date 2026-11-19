"""Tests for what the notification editor needs from the backend."""

from __future__ import annotations

from datetime import datetime
from typing import Any
import zoneinfo

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    entity_registry as er,
    floor_registry as fr,
)
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center import schedule as sched
from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.listed import EntityList
from custom_components.notification_center.model import DATA_SCHEMA, validate_item

from .common import load

ZONE = "Europe/Budapest"


def _local(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=zoneinfo.ZoneInfo(ZONE))


@pytest.fixture
async def budapest(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> None:
    await hass.config.async_set_time_zone(ZONE)
    freezer.move_to(_local("2026-11-16 09:00"))


async def _ws(hass: HomeAssistant, ws_client: WebSocketGenerator) -> Any:
    client = await ws_client(hass)

    async def call(command: str, **data: Any) -> dict[str, Any]:
        await client.send_json_auto_id({"type": f"{DOMAIN}/{command}", **data})
        return await client.receive_json()  # type: ignore[no-any-return]

    return call


async def test_own_triggers_in_editor_form(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The automation form is stored flat with ids; self is the default."""
    center = await load(hass, config_entry)
    other = await center.add("Washer", {"message": "Done"}, {"message": "Unload"})
    others = center.manager.config["notifications"][0]["steps"]
    item = await center.manager.async_create(
        "notifications",
        {
            "name": "Dryer",
            "entity_groups": [{"domain": "binary_sensor"}],
            "steps": [
                {
                    "message": "Start",
                    "start": {
                        "type": "triggers",
                        "triggers": [
                            {
                                "trigger": f"{DOMAIN}.listed_entities",
                                "target": {},
                                "options": {"notification": "", "to": ["on"]},
                            }
                        ],
                    },
                },
                {
                    "message": "Again",
                    "start": {
                        "type": "triggers",
                        "triggers": [
                            {
                                "trigger": f"{DOMAIN}.notification_state",
                                "options": {"step": 1, "state": "done"},
                            },
                            {
                                "trigger": f"{DOMAIN}.notification_state",
                                "options": {
                                    "notification": "sensor.nc_washer",
                                    "step": 2,
                                    "state": "active",
                                },
                            },
                        ],
                    },
                },
            ],
        },
    )
    steps = item["steps"]
    assert steps[0]["start"]["triggers"] == [
        {"trigger": f"{DOMAIN}.listed_entities", "to": ["on"]}
    ]
    own, washer = steps[1]["start"]["triggers"]
    assert own == {
        "trigger": f"{DOMAIN}.notification_state",
        "notification": item["id"],
        "step": steps[0]["id"],
        "state": "done",
    }
    assert washer["notification"] == other
    assert washer["step"] == others[1]["id"]


async def test_entity_group_lists_and_snapshot(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Groups take several areas, floors and labels; a snapshot can stay."""
    floor = fr.async_get(hass).async_create("Upstairs")
    bath = ar.async_get(hass).async_create("Bathroom", floor_id=floor.floor_id)
    kitchen = ar.async_get(hass).async_create("Kitchen")
    registry = er.async_get(hass)
    for name, area in (("bath", bath.id), ("kitchen", kitchen.id), ("hall", None)):
        entry = registry.async_get_or_create("binary_sensor", "test", name)
        registry.async_update_entity(entry.entity_id, area_id=area)
        hass.states.async_set(entry.entity_id, "off", {"device_class": "moisture"})
    # The earlier single area is still read.
    old = validate_item(
        "notifications",
        {"name": "x", "entity_groups": [{"domain": "d", "area": "Kitchen"}],
         "steps": [{"message": "m"}]},
    )  # fmt: skip
    assert old["entity_groups"][0]["areas"] == ["Kitchen"]

    center = await load(hass, config_entry)
    await center.add(
        "Leak",
        {"message": "Leak"},
        entity_groups=[
            {"domain": "binary_sensor", "floors": [floor.floor_id]},
            {"domain": "binary_sensor", "areas": [kitchen.id], "add_new": False},
        ],
    )
    upstairs, frozen = center.manager.config["notifications"][0]["entity_groups"]
    assert "members" not in upstairs
    assert frozen["members"] == ["binary_sensor.test_kitchen"]
    listed = EntityList(hass, center.manager.config["notifications"][0])
    assert sorted(listed.members()) == [
        "binary_sensor.test_bath",
        "binary_sensor.test_kitchen",
    ]
    # A new entity in the kitchen does not join the frozen group.
    entry = registry.async_get_or_create("binary_sensor", "test", "sink")
    registry.async_update_entity(entry.entity_id, area_id=kitchen.id)
    hass.states.async_set(entry.entity_id, "off")
    assert entry.entity_id not in listed.members()


async def test_expires_on_a_day(hass: HomeAssistant) -> None:
    """Expires: the same or a later day, at a time."""
    await hass.config.async_set_time_zone(ZONE)
    due = _local("2026-11-16 19:00")
    same = sched.expires_at({"expires": {"day": 0, "at": "23:00"}}, due)
    assert same == _local("2026-11-16 23:00")
    earlier = sched.expires_at({"expires": {"day": 0, "at": "08:00"}}, due)
    assert earlier == _local("2026-11-17 08:00")
    nxt = sched.expires_at({"expires": {"day": 1, "at": "08:00"}}, due)
    assert nxt == _local("2026-11-17 08:00")
    assert sched.expires_at({"expires": {"hours": 2}}, due) == _local(
        "2026-11-16 21:00"
    )
    assert sched.expires_at({}, due) is None


async def test_schedule_preview_and_set_next(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
) -> None:
    """The editor shows the next times and can set the next one."""
    await hass.config.async_set_time_zone(ZONE)
    center = await load(hass, config_entry)
    call = await _ws(hass, hass_ws_client)
    # After logging in: the token is not valid before it was made.
    freezer.move_to(_local("2026-11-16 09:00"))
    weekly = {"type": "calendar", "every": 1, "unit": "weeks",
              "weekdays": ["wed"], "at": "19:00"}  # fmt: skip
    result = await call("schedule/preview", schedule=weekly)
    assert result["success"], result
    assert [
        dt_util.as_local(dt_util.parse_datetime(item)).strftime("%m-%d %H:%M")  # type: ignore[arg-type]
        for item in result["result"]["next"]
    ] == ["11-18 19:00", "11-25 19:00", "12-02 19:00"]

    repeat = {"type": "after_last_done", "every": 2, "unit": "weeks", "at": "10:00"}
    await center.add(
        "Filter",
        {"message": "Change it", "start": {"type": "schedule", "schedule": repeat}},
    )
    notification = center.manager.config["notifications"][0]
    ids = {
        "notification_id": notification["id"],
        "step_id": notification["steps"][0]["id"],
    }
    result = await call("schedule/preview", schedule=repeat, **ids)
    # Never done: counted from when it was made.
    assert result["result"]["last_done"] is not None
    assert [dt_util.parse_datetime(item) for item in result["result"]["next"]] == [
        _local("2026-11-30 10:00")
    ]

    result = await call("step/set_next", next="2026-11-20", **ids)
    assert result["success"], result
    assert dt_util.parse_datetime(result["result"]["last_done"]) == _local(
        "2026-11-06 10:00"
    )
    assert dt_util.parse_datetime(
        center.attrs("sensor.nc_filter")["next_due"]
    ) == _local("2026-11-20 10:00")

    bad = await call("schedule/preview", schedule={"type": "calendar"})
    assert not bad["success"]


async def test_text_preview_and_custom_data(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Texts render with the entity's placeholders; custom data is rendered."""
    hass.states.async_set("binary_sensor.door", "on", {"friendly_name": "Door"})
    center = await load(hass, config_entry)
    call = await _ws(hass, hass_ws_client)
    result = await call(
        "text/preview",
        texts=["{Entity} is {State}", "{{ 1 + 1 }}", None],
        entity_id="binary_sensor.door",
    )
    assert result["success"], result
    assert [item["text"] for item in result["result"]] == ["Door is on", "2", None]

    await center.add(
        "Door",
        {"message": "Open", "data": {"type": "custom", "text": "{{ 2 * 3 }} min"}},
    )
    await center.call("trigger", "sensor.nc_door")
    card = center.engine.cards_of(center.manager.config["notifications"][0]["id"])[0]
    assert card.data_text == "6 min"
    assert card.as_dict()["data_text"] == "6 min"


def test_due_data_reads_as_active_since() -> None:
    """A step saved with Data Due (0.4.1) reads as Active since."""
    assert DATA_SCHEMA({"type": "due", "format": "time"}) == {
        "type": "active_since",
        "format": "time",
    }
