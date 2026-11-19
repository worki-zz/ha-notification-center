"""Tests for the engine: cards, states, entities and actions."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.engine import Overrides

from .common import DOOR_GROUP, Center, load, step


def _state_trigger(entity_id: str, to: str = "on") -> dict[str, Any]:
    return {"trigger": "state", "entity_id": entity_id, "to": to}


async def _tick(
    hass: HomeAssistant, freezer: FrozenDateTimeFactory, delta: timedelta
) -> None:
    freezer.tick(delta)
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()


async def test_entities_are_created(center: Center) -> None:
    """The summary sensor and one sensor per notification (no event entity)."""
    assert center.state("sensor.notification_center") == "0"
    assert center.attrs("sensor.notification_center")["mode"] == "Home"
    assert center.hass.states.get("event.notification_center") is None

    await center.add("Dishwasher", step())
    assert center.state("sensor.nc_dishwasher") == "idle"
    attrs = center.attrs("sensor.nc_dishwasher")
    assert attrs["friendly_name"] == "Notification Center Dishwasher"
    registry = er.async_get(center.hass)
    sensor = registry.async_get("sensor.nc_dishwasher")
    summary = registry.async_get("sensor.notification_center")
    assert sensor is not None
    assert summary is not None
    assert sensor.device_id is not None
    assert sensor.device_id == summary.device_id
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
        step(
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
    assert center.kinds() == ["active"]
    assert center.events[0][1]["notification"] == "sensor.nc_dishwasher"
    assert center.events[0][1]["step"] == 1

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
        step(
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
        step(
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
        step(
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
    nid = await center.add("Plants", step())
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
    await center.add("Plants", step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("snooze", "sensor.nc_plants")
    until = dt_util.parse_datetime(center.attrs("sensor.nc_plants")["snoozed_until"])
    assert until is not None
    assert dt_util.as_local(until).isoformat() == "2026-11-17T07:30:00+01:00"


async def test_clear_and_done_actions(center: Center) -> None:
    """Clear dismisses without last done; Done records it even when closed."""
    await center.add("Plants", step())
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
    await center.add("Plants", step())
    with pytest.raises(ServiceValidationError):
        await center.call("trigger", "sensor.notification_center")
    with pytest.raises(ServiceValidationError, match="1 step"):
        await center.call("trigger", "sensor.nc_plants", step=2)


async def test_trigger_action_message_and_data(center: Center) -> None:
    """The trigger action can replace the message and pass data."""
    await center.set("input_boolean.front", "on", friendly_name="Front door")
    await center.add("Bell", step("Someone at {Entity}"))
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
    await center.add("Battery", step("Battery {{ states('sensor.battery') }}%"))
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
        step(
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
        step(
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
        step(
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


async def test_entities_numeric_state(center: Center) -> None:
    """A limit can be an entity, and the value can come from a template."""
    await center.set("input_number.limit", "20")
    await center.set("sensor.tank", "50")
    await center.add(
        "Tank",
        step(
            start={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_numeric_state",
                        "below": "input_number.limit",
                        "value_template": "{{ state.state | float * 2 }}",
                    }
                ],
            },
        ),
        entities=[{"entity_id": "sensor.tank"}],
    )
    # 15 * 2 = 30 is not below 20.
    await center.set("sensor.tank", "15")
    assert center.state("sensor.nc_tank") == "idle"
    # The limit rises: 30 is below 40 now.
    await center.set("input_number.limit", "40")
    assert center.state("sensor.nc_tank") == "active"


async def test_entities_of_another_notification(center: Center) -> None:
    """A step can watch the entities another notification lists."""
    await center.set("binary_sensor.leak", "off")
    leaks = await center.add(
        "Leaks", step(), entities=[{"entity_id": "binary_sensor.leak"}]
    )
    await center.add(
        "Main valve",
        step(
            "Close the main valve",
            start={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_state",
                        "notification": leaks,
                        "to": "on",
                    }
                ],
            },
        ),
    )
    await center.set("binary_sensor.leak", "on")
    assert center.state("sensor.nc_main_valve") == "active"


async def test_entities_for_template(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """The ``for`` time can be a template."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add(
        "Doors",
        step(
            start={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_state",
                        "to": "on",
                        "for": "{{ '00:05:00' }}",
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
    waste = await center.add("Waste", step("Take out the waste"))
    await center.add(
        "Waste check",
        step(
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
        step(
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
    # The other notification's sensor is the cause.
    cause = center.hass.states.get("sensor.nc_waste")
    effect = center.hass.states.get("sensor.nc_waste_check")
    assert cause is not None
    assert effect is not None
    assert effect.context.parent_id == cause.context.id

    center.hass.bus.async_fire("check")
    await center.hass.async_block_till_done()
    assert center.attrs("sensor.nc_waste_check")["active_count"] == 2


async def test_done_card_until_midnight(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A done card shows as done until the end of the day."""
    await hass.config.async_set_time_zone("Europe/Budapest")
    freezer.move_to("2026-11-16 20:00:00+01:00")
    center = await load(hass, config_entry)
    await center.add("Plants", step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("done", "sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "done"
    freezer.move_to("2026-11-17 00:00:00+01:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "idle"


async def test_disable_and_delete(hass: HomeAssistant, center: Center) -> None:
    """A disabled notification is ``disabled``; a deleted one loses its sensor."""
    nid = await center.add("Plants", step())
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
    nid = await center.add("Plants", step())
    item = center.engine.notification_config(nid)
    assert item is not None
    await center.manager.async_update("notifications", nid, {**item, "name": "Herbs"})
    await hass.async_block_till_done()
    name = center.attrs("sensor.nc_plants")["friendly_name"]
    assert name == "Notification Center Herbs"


async def test_cards_survive_a_restart(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Open and snoozed cards and last done times are restored."""
    center = await load(hass, config_entry)
    await center.add("Plants", step())
    await center.add("Bell", step())
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
    nid = await center.add("Plants", step())
    await center.call("trigger", "sensor.nc_plants")
    ws = await hass_ws_client(hass, hass_read_only_access_token)

    await ws.send_json_auto_id({"type": f"{DOMAIN}/state/subscribe"})
    assert (await ws.receive_json())["success"]
    snapshot = (await ws.receive_json())["event"]
    entry = snapshot["notifications"][nid]
    assert entry["state"] == "active"
    assert entry["entity_id"] == "sensor.nc_plants"
    card = entry["cards"][0]
    assert card["message"] == "Do it"
    assert card["silenced"] is False

    await ws.send_json_auto_id(
        {
            "type": f"{DOMAIN}/card/action",
            "notification_id": nid,
            "step_id": card["step_id"],
            "entity_id": None,
            "action": "silence",
        }
    )
    while True:
        message = await ws.receive_json()
        if message.get("type") == "event":
            silenced = message["event"]["notifications"][nid]["cards"][0]
            assert silenced["silenced"] is True
            assert silenced["status"] == "active"
        if message.get("type") == "result":
            assert message["success"], message
            break
    assert center.state("sensor.nc_plants") == "active"
    events = len(center.events)

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
    assert len(center.events) == events + 1
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
        step(
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
    """An entity that stopped matching while stopped closes its card (idle)."""
    center = await load(hass, config_entry)
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        step(
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
    assert Center(hass, config_entry).state("sensor.nc_doors") == "idle"


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
    # A scheduled step due later today makes its notification "upcoming".
    assert {state.state for state in sensors} <= {
        "idle",
        "active",
        "upcoming",
        "disabled",
    }
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
        step(
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


async def test_changes_link_to_their_cause(hass: HomeAssistant, center: Center) -> None:
    """The Activity log can say why: the state is a child of the cause."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add(
        "Doors",
        step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    cause = hass.states.get("binary_sensor.front")
    state = hass.states.get("sensor.nc_doors")
    assert cause is not None
    assert state is not None
    assert state.state == "active"
    assert state.context.parent_id == cause.context.id
    summary = hass.states.get("sensor.notification_center")
    assert summary is not None
    assert summary.context.parent_id == state.context.id

    context = Context()
    await hass.services.async_call(
        DOMAIN,
        "done",
        {"entity_id": "sensor.nc_doors"},
        blocking=True,
        context=context,
    )
    state = hass.states.get("sensor.nc_doors")
    assert state is not None
    assert state.state == "done"
    assert state.context.parent_id == context.id


async def test_time_driven_change_has_no_cause(
    hass: HomeAssistant, center: Center
) -> None:
    """A time driven change has no cause, but the summary still follows it."""
    nid = await center.add("Plain", step())
    runner = center.engine.runners[nid]
    center.engine.trigger(nid, next(iter(runner.steps)), None, Overrides())
    await hass.async_block_till_done()
    state = hass.states.get("sensor.nc_plain")
    assert state is not None
    assert state.state == "active"
    assert state.context.parent_id is None
    summary = hass.states.get("sensor.notification_center")
    assert summary is not None
    # The summary sensor is still caused by the notification's sensor.
    assert summary.context.parent_id == state.context.id


async def test_closing_is_caused_and_reopening_does_not_flicker(
    hass: HomeAssistant, center: Center
) -> None:
    """The entity closing a status card is the cause, and it goes to idle."""
    await center.set("binary_sensor.front", "off")
    await center.add(
        "Doors",
        step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
            done_when={"start_no_longer_true": True},
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    log: list[tuple[str, str]] = []

    @callback
    def record(event: Event[Any]) -> None:
        new = event.data["new_state"]
        if new is not None and new.entity_id in (
            "sensor.nc_doors",
            "sensor.notification_center",
        ):
            log.append((new.entity_id, new.state))

    hass.bus.async_listen("state_changed", record)
    await center.set("binary_sensor.front", "on")
    await center.set("binary_sensor.front", "off")
    door = hass.states.get("binary_sensor.front")
    state = hass.states.get("sensor.nc_doors")
    assert door is not None
    assert state is not None
    # A status goes back to idle, it is not "done today".
    assert state.state == "idle"
    assert state.context.parent_id == door.context.id

    log.clear()
    await center.set("binary_sensor.front", "on")
    # The sensor goes active, and the summary and the event follow it.
    assert [
        (entity, value) for entity, value in log if entity == "sensor.nc_doors"
    ] == [("sensor.nc_doors", "active")]
    assert [entity for entity, _ in log] == [
        "sensor.nc_doors",
        "sensor.notification_center",
    ]

    sensor = hass.states.get("sensor.nc_doors")
    summary = hass.states.get("sensor.notification_center")
    assert sensor is not None
    assert summary is not None
    assert summary.context.parent_id == sensor.context.id


async def test_entity_already_matching_has_no_cause(
    hass: HomeAssistant, center: Center
) -> None:
    """A card opened because the entity already matched has no state cause."""
    await center.set("binary_sensor.front", "on")
    await center.add(
        "Doors",
        step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.listed_entities", "to": "on"}
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    state = hass.states.get("sensor.nc_doors")
    assert state is not None
    assert state.state == "active"
    assert state.context.parent_id is None


async def test_old_event_entity_is_removed(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The event entity of 0.2.x does not stay in the registry."""
    config_entry.add_to_hass(hass)
    registry = er.async_get(hass)
    old = registry.async_get_or_create(
        "event",
        DOMAIN,
        "event",
        suggested_object_id="notification_center",
        config_entry=config_entry,
    )
    await load(hass, config_entry)
    assert registry.async_get(old.entity_id) is None


async def test_button_press(
    hass: HomeAssistant,
    center: Center,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: Any,
    hass_read_only_access_token: str,
) -> None:
    """A button changes the card, runs its action, and the log names the user."""
    calls = async_mock_service(hass, "test", "ring")
    await center.set("binary_sensor.front", "on", device_class="door")
    nid = await center.add(
        "Doors",
        step(
            buttons=[
                {"type": "done", "action": {"type": "entity_action"}, "id": "done"},
                {
                    "type": "custom",
                    "id": "ring",
                    "label": "Ring",
                    "action": {
                        "type": "ha_action",
                        "actions": [
                            {
                                "action": "test.ring",
                                "data": {"who": "{{ notification.name }}"},
                            }
                        ],
                    },
                },
                {"type": "snooze", "id": "snooze", "snooze": {"minutes": 20}},
            ]
        ),
        entities=[
            {
                "entity_id": "binary_sensor.front",
                "actions": {
                    "done": [{"action": "test.ring", "data": {"who": "{{ entity }}"}}]
                },
            }
        ],
    )
    await hass.services.async_call(
        DOMAIN,
        "trigger",
        {"entity_id": "sensor.nc_doors", "entity": "binary_sensor.front"},
        blocking=True,
    )
    await hass.async_block_till_done()
    card = center.engine.cards_of(nid)[0]
    ws = await hass_ws_client(hass, hass_read_only_access_token)

    async def press(button_id: str, **extra: Any) -> dict[str, Any]:
        await ws.send_json_auto_id(
            {
                "type": f"{DOMAIN}/card/press",
                "notification_id": nid,
                "step_id": card.step_id,
                "entity_id": "binary_sensor.front",
                "button_id": button_id,
                **extra,
            }
        )
        result: dict[str, Any] = await ws.receive_json()
        await hass.async_block_till_done()
        return result

    # A custom button keeps the card and runs its action.
    assert (await press("ring"))["success"]
    assert center.state("sensor.nc_doors") == "active"
    assert calls[-1].data == {"who": "Doors"}

    # Snooze with the button's own time.
    before = dt_util.utcnow()
    assert (await press("snooze"))["success"]
    assert center.state("sensor.nc_doors") == "snoozed"
    until = card.snoozed_until
    assert until is not None
    assert timedelta(minutes=19) < until - before <= timedelta(minutes=21)

    # Done runs the entity's own action; the state carries the user.
    assert (await press("done"))["success"]
    assert center.state("sensor.nc_doors") == "done"
    assert calls[-1].data == {"who": "binary_sensor.front"}
    assert calls[-1].context.user_id == hass_read_only_user.id
    state = hass.states.get("sensor.nc_doors")
    assert state is not None
    assert state.context.user_id == hass_read_only_user.id

    result = await press("done")
    assert not result["success"]
    assert result["error"]["code"] == "not_found"


async def test_switched_on_again_entities_match(
    hass: HomeAssistant, center: Center
) -> None:
    """On again, an entity that still matches gets its card back."""
    await center.set("binary_sensor.front", "off", device_class="door")
    nid = await center.add(
        "Doors",
        step(
            start={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    assert center.state("sensor.nc_doors") == "active"
    await center.manager.async_set_enabled(nid, False)
    await hass.async_block_till_done()
    await center.manager.async_set_enabled(nid, True)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_doors") == "active"
