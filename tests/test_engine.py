"""Tests for the engine: cards, states, entities and actions."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.engine import Engine
from custom_components.notification_center.store import ConfigManager

DOOR_GROUP = {"domain": "binary_sensor", "device_class": "door"}


class Center:
    """The loaded integration, with shortcuts for the tests."""

    def __init__(self, hass: HomeAssistant, entry: MockConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.engine.async_add_event_listener(
            lambda kind, data: self.events.append((kind, data))
        )

    @property
    def engine(self) -> Engine:
        engine: Engine = self.entry.runtime_data.engine
        return engine

    @property
    def manager(self) -> ConfigManager:
        manager: ConfigManager = self.entry.runtime_data.manager
        return manager

    async def add(self, name: str, *steps: dict[str, Any], **extra: Any) -> str:
        item = await self.manager.async_create(
            "notifications", {"name": name, "steps": list(steps), **extra}
        )
        await self.hass.async_block_till_done()
        return str(item["id"])

    def state(self, entity_id: str) -> str:
        state = self.hass.states.get(entity_id)
        assert state is not None, entity_id
        return state.state

    def attrs(self, entity_id: str) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        assert state is not None, entity_id
        return dict(state.attributes)

    def kinds(self) -> list[str]:
        return [kind for kind, _ in self.events]

    async def call(self, service: str, entity_id: str, **data: Any) -> None:
        await self.hass.services.async_call(
            DOMAIN, service, {"entity_id": entity_id, **data}, blocking=True
        )
        await self.hass.async_block_till_done()

    async def set(self, entity_id: str, state: str, **attributes: Any) -> None:
        self.hass.states.async_set(entity_id, state, attributes)
        await self.hass.async_block_till_done()


async def _load(hass: HomeAssistant, entry: MockConfigEntry) -> Center:
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return Center(hass, entry)


@pytest.fixture
async def center(hass: HomeAssistant, config_entry: MockConfigEntry) -> Center:
    return await _load(hass, config_entry)


def _state_trigger(entity_id: str, to: str = "on") -> dict[str, Any]:
    return {"trigger": "state", "entity_id": entity_id, "to": to}


def _step(message: str = "Do it", **extra: Any) -> dict[str, Any]:
    return {"message": message, **extra}


async def _tick(
    hass: HomeAssistant, freezer: FrozenDateTimeFactory, delta: timedelta
) -> None:
    freezer.tick(delta)
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()


async def test_entities_are_created(center: Center) -> None:
    """The summary sensor, the event entity and one sensor per notification."""
    assert center.state("sensor.notification_center") == "0"
    assert center.attrs("sensor.notification_center")["mode"] == "Home"
    assert center.hass.states.get("event.notification_center") is not None

    await center.add("Dishwasher", _step())
    assert center.state("sensor.nc_dishwasher") == "idle"
    attrs = center.attrs("sensor.nc_dishwasher")
    assert attrs["friendly_name"] == "Dishwasher"
    assert attrs["icon"] == "mdi:bell"
    assert attrs["options"] == [
        "active",
        "hidden",
        "snoozed",
        "upcoming",
        "done",
        "idle",
        "disabled",
    ]


async def test_trigger_done_when_and_last_done(
    hass: HomeAssistant, center: Center
) -> None:
    """A trigger opens the card; a Done when trigger marks it done."""
    await center.set("input_boolean.dishwasher", "off")
    await center.add(
        "Dishwasher",
        _step(
            "Empty the dishwasher",
            start={
                "type": "triggers",
                "triggers": [_state_trigger("input_boolean.dishwasher")],
            },
            done_when={"triggers": [_state_trigger("input_boolean.dishwasher", "off")]},
        ),
    )
    await center.set("input_boolean.dishwasher", "on")
    assert center.state("sensor.nc_dishwasher") == "active"
    attrs = center.attrs("sensor.nc_dishwasher")
    assert attrs["active_count"] == 1
    assert attrs["active_step"] == 1
    assert attrs["message"] == "Empty the dishwasher"
    assert center.state("sensor.notification_center") == "1"
    assert center.attrs("sensor.notification_center")["top_notification"] == (
        "sensor.nc_dishwasher"
    )
    event = hass.states.get("event.notification_center")
    assert event is not None
    assert event.attributes["event_type"] == "active"
    assert event.attributes["notification"] == "sensor.nc_dishwasher"
    assert event.attributes["step"] == 1

    await center.set("input_boolean.dishwasher", "off")
    assert center.state("sensor.nc_dishwasher") == "done"
    assert center.attrs("sensor.nc_dishwasher")["last_done"] is not None
    assert center.kinds() == ["active", "done"]
    assert center.events[-1][1]["source"] == "done_when"
    assert center.state("sensor.notification_center") == "0"


async def test_start_conditions(center: Center) -> None:
    """The conditions are checked when the trigger fires."""
    await center.set("input_boolean.away", "on")
    await center.add(
        "Bell",
        _step(
            start={
                "type": "triggers",
                "triggers": [_state_trigger("input_boolean.bell")],
                "conditions": [
                    {
                        "condition": "state",
                        "entity_id": "input_boolean.away",
                        "state": "off",
                    }
                ],
            }
        ),
    )
    await center.set("input_boolean.bell", "on")
    assert center.state("sensor.nc_bell") == "idle"

    await center.set("input_boolean.bell", "off")
    await center.set("input_boolean.away", "off")
    await center.set("input_boolean.bell", "on")
    assert center.state("sensor.nc_bell") == "active"


async def test_hide_while(center: Center) -> None:
    """A card is hidden while Hide while is true, and comes back after."""
    await center.set("input_boolean.raining", "on")
    await center.add(
        "Windows",
        _step(
            start={
                "type": "triggers",
                "triggers": [_state_trigger("input_boolean.hot")],
            },
            hide_while=[
                {
                    "condition": "state",
                    "entity_id": "input_boolean.raining",
                    "state": "on",
                }
            ],
        ),
    )
    await center.set("input_boolean.hot", "on")
    assert center.state("sensor.nc_windows") == "hidden"
    assert center.attrs("sensor.notification_center")["top_notification"] is None
    assert center.kinds() == []

    await center.set("input_boolean.raining", "off")
    assert center.state("sensor.nc_windows") == "active"
    assert center.kinds() == ["active"]

    await center.set("input_boolean.raining", "on")
    assert center.state("sensor.nc_windows") == "hidden"


async def test_retrigger_keeps_the_card(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """A trigger on an open card keeps its start time; a snoozed one shows."""
    await center.add(
        "Bell",
        _step(
            start={
                "type": "triggers",
                "triggers": [{"trigger": "event", "event_type": "bell"}],
            }
        ),
    )
    hass.bus.async_fire("bell")
    await hass.async_block_till_done()
    since = center.attrs("sensor.nc_bell")["active_since"]

    await _tick(hass, freezer, timedelta(minutes=5))
    hass.bus.async_fire("bell")
    await hass.async_block_till_done()
    assert center.attrs("sensor.nc_bell")["active_since"] == since
    assert center.kinds() == ["active"]

    await center.call("snooze", "sensor.nc_bell", duration={"hours": 1})
    assert center.state("sensor.nc_bell") == "snoozed"
    hass.bus.async_fire("bell")
    await hass.async_block_till_done()
    assert center.state("sensor.nc_bell") == "active"
    assert center.kinds() == ["active", "snoozed", "active"]


async def test_snooze_comes_back(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """A snoozed card shows again when the snooze ends."""
    nid = await center.add("Plants", _step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("snooze", "sensor.nc_plants", duration={"minutes": 30})
    attrs = center.attrs("sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "snoozed"
    assert attrs["snoozed_until"] is not None
    assert attrs["active_count"] == 0

    await _tick(hass, freezer, timedelta(minutes=31))
    assert center.state("sensor.nc_plants") == "active"
    assert center.events[-1][1]["source"] == "snooze_end"
    assert center.engine.cards_of(nid)[0].snoozed_until is None


async def test_snooze_until_tomorrow(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """Without a time, Snooze lasts until the General setting tomorrow."""
    await hass.config.async_set_time_zone("Europe/Budapest")
    freezer.move_to("2026-11-16 15:00:00+01:00")
    await center.manager.async_update_general({"snooze_tomorrow_at": "07:30"})
    await center.add("Plants", _step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("snooze", "sensor.nc_plants")
    until = dt_util.parse_datetime(center.attrs("sensor.nc_plants")["snoozed_until"])
    assert until is not None
    assert dt_util.as_local(until).isoformat() == "2026-11-17T07:30:00+01:00"


async def test_clear_and_done_actions(center: Center) -> None:
    """Clear dismisses without last done; Done records it even when closed."""
    await center.add("Plants", _step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("clear", "sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "idle"
    assert center.attrs("sensor.nc_plants")["last_done"] is None
    assert center.kinds() == ["active", "dismissed"]

    await center.call("done", "sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "idle"
    assert center.attrs("sensor.nc_plants")["last_done"] is not None

    await center.call(
        "set_last_done", "sensor.nc_plants", datetime="2026-01-02 03:04:05"
    )
    last = dt_util.parse_datetime(center.attrs("sensor.nc_plants")["last_done"])
    assert last is not None
    assert dt_util.as_local(last).strftime("%Y-%m-%d %H:%M") == "2026-01-02 03:04"


async def test_action_errors(center: Center) -> None:
    """Actions explain a wrong target or step."""
    await center.add("Plants", _step())
    with pytest.raises(ServiceValidationError):
        await center.call("trigger", "sensor.notification_center")
    with pytest.raises(ServiceValidationError, match="1 step"):
        await center.call("trigger", "sensor.nc_plants", step=2)


async def test_trigger_action_message_and_data(center: Center) -> None:
    """The trigger action can replace the message and pass data."""
    await center.set("input_boolean.front", "on", friendly_name="Front door")
    await center.add("Bell", _step("Someone at {Entity}"))
    await center.call("trigger", "sensor.nc_bell", entity="input_boolean.front")
    assert center.attrs("sensor.nc_bell")["message"] == "Someone at Front door"

    await center.call(
        "trigger",
        "sensor.nc_bell",
        message="Visitor: {{ data.visitor }}",
        data={"visitor": "Postman"},
    )
    cards = center.engine.cards_of(
        center.engine.resolve_notification("sensor.nc_bell") or ""
    )
    messages = sorted(card.message or "" for card in cards)
    assert messages == ["Someone at Front door", "Visitor: Postman"]


async def test_live_message(center: Center) -> None:
    """The message follows the entities it reads while the card is open."""
    await center.set("sensor.battery", "40")
    await center.add("Battery", _step("Battery {{ states('sensor.battery') }}%"))
    await center.call("trigger", "sensor.nc_battery")
    assert center.attrs("sensor.nc_battery")["message"] == "Battery 40%"
    await center.set("sensor.battery", "15")
    assert center.attrs("sensor.nc_battery")["message"] == "Battery 15%"


async def test_listed_entities(center: Center) -> None:
    """Each listed entity gets its own card, closed when it stops matching."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.set("binary_sensor.back", "on", device_class="door")
    await center.set("binary_sensor.motion", "on", device_class="motion")
    await center.add(
        "Doors",
        _step(
            "{Entity} is open",
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
            done_when={"start_no_longer_true": True},
        ),
        entity_groups=[DOOR_GROUP],
    )
    # An entity that already matches gets a card right away.
    assert center.state("sensor.nc_doors") == "active"
    assert center.attrs("sensor.nc_doors")["entities"] == ["binary_sensor.back"]

    await center.set("binary_sensor.front", "on", device_class="door")
    attrs = center.attrs("sensor.nc_doors")
    assert attrs["active_count"] == 2
    assert sorted(attrs["entities"]) == ["binary_sensor.back", "binary_sensor.front"]
    assert center.state("sensor.notification_center") == "2"

    await center.set("binary_sensor.back", "off", device_class="door")
    assert center.attrs("sensor.nc_doors")["entities"] == ["binary_sensor.front"]
    assert center.events[-1][0] == "done"
    assert center.events[-1][1]["entity"] == "binary_sensor.back"
    assert center.events[-1][1]["source"] == "entity"


async def test_listed_entities_dismiss_waits(center: Center) -> None:
    """A dismissed listed card comes back only after the entity stops matching."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        _step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
        ),
        entity_groups=[DOOR_GROUP],
    )
    assert center.state("sensor.nc_doors") == "active"
    await center.call("clear", "sensor.nc_doors", entity="binary_sensor.front")
    assert center.state("sensor.nc_doors") == "idle"

    # A change that keeps it matching does not bring the card back.
    await center.set("binary_sensor.front", "on", device_class="door", other=1)
    assert center.state("sensor.nc_doors") == "idle"

    await center.set("binary_sensor.front", "off", device_class="door")
    await center.set("binary_sensor.front", "on", device_class="door")
    assert center.state("sensor.nc_doors") == "active"


async def test_listed_entities_for(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """With ``for``, the card opens when the entity matched long enough."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add(
        "Doors",
        _step(
            start={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.listed_entities",
                        "to": "on",
                        "for": {"minutes": 5},
                    }
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    await _tick(hass, freezer, timedelta(minutes=4))
    assert center.state("sensor.nc_doors") == "idle"
    await _tick(hass, freezer, timedelta(minutes=2))
    assert center.state("sensor.nc_doors") == "active"


async def test_notification_state_trigger_and_condition(center: Center) -> None:
    """A step can start when another notification's step is done."""
    waste = await center.add("Waste", _step("Take out the waste"))
    await center.add(
        "Waste check",
        _step(
            "Bring the bin back",
            start={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.notification_state",
                        "notification": waste,
                        "state": "done",
                    }
                ],
            },
        ),
        _step(
            "Done within a day",
            start={
                "type": "triggers",
                "triggers": [{"trigger": "event", "event_type": "check"}],
                "conditions": [
                    {
                        "condition": "notification_center.notification_state",
                        "notification": waste,
                        "state": "done",
                        "within": {"hours": 24},
                    }
                ],
            },
        ),
    )
    center.hass.bus.async_fire("check")
    await center.hass.async_block_till_done()
    assert center.state("sensor.nc_waste_check") == "idle"

    await center.call("trigger", "sensor.nc_waste")
    await center.call("done", "sensor.nc_waste")
    assert center.state("sensor.nc_waste_check") == "active"
    assert center.attrs("sensor.nc_waste_check")["message"] == "Bring the bin back"

    center.hass.bus.async_fire("check")
    await center.hass.async_block_till_done()
    assert center.attrs("sensor.nc_waste_check")["active_count"] == 2


async def test_done_card_until_midnight(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A done card shows as done until the end of the day."""
    await hass.config.async_set_time_zone("Europe/Budapest")
    freezer.move_to("2026-11-16 20:00:00+01:00")
    center = await _load(hass, config_entry)
    await center.add("Plants", _step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("done", "sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "done"
    freezer.move_to("2026-11-17 00:00:00+01:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "idle"


async def test_disable_and_delete(hass: HomeAssistant, center: Center) -> None:
    """A disabled notification is ``disabled``; a deleted one loses its sensor."""
    nid = await center.add("Plants", _step())
    await center.call("trigger", "sensor.nc_plants")
    await center.manager.async_set_enabled(nid, False)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "disabled"
    assert center.engine.cards_of(nid) == []

    await center.manager.async_delete("notifications", nid)
    await hass.async_block_till_done()
    assert hass.states.get("sensor.nc_plants") is None
    assert er.async_get(hass).async_get("sensor.nc_plants") is None


async def test_rename_keeps_entity_id(hass: HomeAssistant, center: Center) -> None:
    """Renaming a notification changes its name, not its entity id."""
    nid = await center.add("Plants", _step())
    item = center.engine.notification_config(nid)
    assert item is not None
    await center.manager.async_update("notifications", nid, {**item, "name": "Herbs"})
    await hass.async_block_till_done()
    assert center.attrs("sensor.nc_plants")["friendly_name"] == "Herbs"


async def test_cards_survive_a_restart(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Open and snoozed cards and last done times are restored."""
    center = await _load(hass, config_entry)
    await center.add("Plants", _step())
    await center.add("Bell", _step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("trigger", "sensor.nc_bell")
    await center.call("snooze", "sensor.nc_bell", duration={"hours": 1})
    since = center.attrs("sensor.nc_plants")["active_since"]

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    center = Center(hass, config_entry)
    assert center.state("sensor.nc_plants") == "active"
    assert center.attrs("sensor.nc_plants")["active_since"] == since
    assert center.state("sensor.nc_bell") == "snoozed"

    await _tick(hass, freezer, timedelta(hours=2))
    assert center.state("sensor.nc_bell") == "active"


async def test_websocket_state_and_card_actions(
    hass: HomeAssistant,
    center: Center,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: Any,
    hass_read_only_access_token: str,
) -> None:
    """Any user can follow the cards and mark one done."""
    hass.states.async_set("person.reader", "home", {"user_id": hass_read_only_user.id})
    nid = await center.add("Plants", _step())
    await center.call("trigger", "sensor.nc_plants")
    ws = await hass_ws_client(hass, hass_read_only_access_token)

    await ws.send_json_auto_id({"type": f"{DOMAIN}/state/subscribe"})
    assert (await ws.receive_json())["success"]
    snapshot = (await ws.receive_json())["event"]
    entry = snapshot["notifications"][nid]
    assert entry["state"] == "active"
    card = entry["cards"][0]
    assert card["message"] == "Do it"

    await ws.send_json_auto_id(
        {
            "type": f"{DOMAIN}/card/action",
            "notification_id": nid,
            "step_id": card["step_id"],
            "entity_id": None,
            "action": "done",
        }
    )
    while True:
        message = await ws.receive_json()
        if message.get("type") == "result":
            assert message["success"], message
            break
    assert center.state("sensor.nc_plants") == "done"
    assert center.events[-1][1]["person"] == "person.reader"
    assert center.events[-1][1]["source"] == "button"


async def test_mode_follows_its_condition(center: Center) -> None:
    """The summary sensor shows the first mode whose condition is true."""
    await center.set("input_boolean.night", "off")
    await center.manager.async_create(
        "modes",
        {
            "name": "Night",
            "condition": {"type": "toggle", "entity_id": "input_boolean.night"},
        },
    )
    await center.manager.async_create(
        "modes",
        {
            "name": "Party",
            "condition": {
                "type": "template",
                "value_template": "{{ is_state('input_select.party', 'yes') }}",
            },
        },
    )
    await center.hass.async_block_till_done()
    assert center.attrs("sensor.notification_center")["mode"] == "Home"

    await center.set("input_boolean.night", "on")
    assert center.attrs("sensor.notification_center")["mode"] == "Night"
    await center.set("input_boolean.night", "off")
    await center.set("input_select.party", "yes")
    assert center.attrs("sensor.notification_center")["mode"] == "Party"


async def test_done_when_closes_only_its_entity(center: Center) -> None:
    """A Done when trigger about one listed entity closes only its card."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.set("binary_sensor.back", "on", device_class="door")
    await center.add(
        "Doors",
        _step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
            done_when={
                "triggers": [
                    {
                        "trigger": "state",
                        "entity_id": ["binary_sensor.front", "binary_sensor.back"],
                        "attribute": "locked",
                        "to": True,
                    }
                ]
            },
        ),
        entity_groups=[DOOR_GROUP],
    )
    assert center.attrs("sensor.nc_doors")["active_count"] == 2
    await center.set("binary_sensor.front", "on", device_class="door", locked=True)
    assert center.attrs("sensor.nc_doors")["entities"] == ["binary_sensor.back"]


async def test_listed_card_closes_after_restart(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An entity that stopped matching while stopped closes its card."""
    center = await _load(hass, config_entry)
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        _step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
            done_when={"start_no_longer_true": True},
        ),
        entity_groups=[DOOR_GROUP],
    )
    assert center.state("sensor.nc_doors") == "active"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    hass.states.async_set("binary_sensor.front", "off", {"device_class": "door"})
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert Center(hass, config_entry).state("sensor.nc_doors") == "done"


async def test_example_config_runs(
    hass: HomeAssistant, center: Center, caplog: pytest.LogCaptureFixture
) -> None:
    """Every notification of the example starts without an error."""
    text = (Path(__file__).parent / "fixtures" / "example_config.yaml").read_text()
    await center.manager.async_import_yaml(text)
    await hass.async_block_till_done()
    sensors = [
        state
        for state in hass.states.async_all("sensor")
        if state.entity_id.startswith("sensor.nc_")
    ]
    assert len(sensors) == 28
    assert {state.state for state in sensors} <= {"idle", "active", "disabled"}
    assert not [
        record
        for record in caplog.records
        if record.levelname in ("ERROR", "CRITICAL")
        and record.name.startswith("custom_components")
    ]
    assert len(center.engine.runners) == len(
        [n for n in center.manager.config["notifications"] if n["enabled"]]
    )


async def test_listed_done_stays_done_today(center: Center) -> None:
    """A listed card marked done stays done when its entity stops matching."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        _step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
        ),
        entity_groups=[DOOR_GROUP],
    )
    await center.call("done", "sensor.nc_doors")
    await center.set("binary_sensor.front", "on", device_class="door", other=1)
    assert center.state("sensor.nc_doors") == "done"
    await center.set("binary_sensor.front", "off", device_class="door")
    assert center.state("sensor.nc_doors") == "done"
    await center.set("binary_sensor.front", "on", device_class="door")
    assert center.state("sensor.nc_doors") == "active"
