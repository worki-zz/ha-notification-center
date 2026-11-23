"""Tests for the engine: cards, states, entities and actions."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from .common import Center, load, state_trigger, step, tick


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
            activation={
                "type": "triggers",
                "triggers": [state_trigger("input_boolean.dishwasher")],
            },
            done_when={"triggers": [state_trigger("input_boolean.dishwasher", "off")]},
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
            activation={
                "type": "triggers",
                "triggers": [state_trigger("input_boolean.bell")],
            },
            conditions={
                "activate_only_while_met": True,
                "hide_while_not_met": False,
                "conditions": [
                    {
                        "condition": "state",
                        "entity_id": "input_boolean.away",
                        "state": "off",
                    }
                ],
            },
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
            activation={
                "type": "triggers",
                "triggers": [state_trigger("input_boolean.hot")],
            },
            conditions={
                "activate_only_while_met": False,
                "hide_while_not_met": True,
                "conditions": [
                    {
                        "condition": "state",
                        "entity_id": "input_boolean.raining",
                        "state": "off",
                    }
                ],
            },
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


async def test_show_when_switches(center: Center) -> None:
    """Start only: no card while not met. Hide only: the card starts hidden."""
    away = {"condition": "state", "entity_id": "input_boolean.away", "state": "off"}
    await center.set("input_boolean.away", "on")
    for name, entity, start, hide in (
        ("Start only", "input_boolean.one", True, False),
        ("Hide only", "input_boolean.two", False, True),
    ):
        await center.add(
            name,
            step(
                activation={"type": "triggers", "triggers": [state_trigger(entity)]},
                conditions={
                    "activate_only_while_met": start,
                    "hide_while_not_met": hide,
                    "conditions": [away],
                },
            ),
        )
    await center.set("input_boolean.one", "on")
    await center.set("input_boolean.two", "on")
    assert center.state("sensor.nc_start_only") == "idle"
    assert center.state("sensor.nc_hide_only") == "hidden"

    await center.set("input_boolean.away", "off")
    assert center.state("sensor.nc_start_only") == "idle"
    assert center.state("sensor.nc_hide_only") == "active"

    await center.set("input_boolean.one", "off")
    await center.set("input_boolean.one", "on")
    assert center.state("sensor.nc_start_only") == "active"
    # Start only: the card stays when the conditions stop being met.
    await center.set("input_boolean.away", "on")
    assert center.state("sensor.nc_start_only") == "active"
    assert center.state("sensor.nc_hide_only") == "hidden"


async def test_show_when_no_longer_met_closes(center: Center) -> None:
    """Start condition no longer true closes the card when Show when fails."""
    away = {"condition": "state", "entity_id": "input_boolean.away", "state": "off"}
    await center.set("input_boolean.away", "off")
    await center.add(
        "Bell",
        step(
            activation={
                "type": "triggers",
                "triggers": [state_trigger("input_boolean.bell")],
            },
            conditions={
                "activate_only_while_met": True,
                "hide_while_not_met": False,
                "conditions": [away],
            },
            done_when={"activation_conditions_no_longer_true": True},
        ),
    )
    await center.set("input_boolean.bell", "on")
    assert center.state("sensor.nc_bell") == "active"

    await center.set("input_boolean.away", "on")
    assert center.state("sensor.nc_bell") != "active"
    assert center.kinds() == ["active", "done"]


async def test_retrigger_keeps_the_card(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """A trigger on an open card keeps its start time; a snoozed one shows."""
    await center.add(
        "Bell",
        step(
            activation={
                "type": "triggers",
                "triggers": [{"trigger": "event", "event_type": "bell"}],
            }
        ),
    )
    hass.bus.async_fire("bell")
    await hass.async_block_till_done()
    since = center.attrs("sensor.nc_bell")["active_since"]

    await tick(hass, freezer, timedelta(minutes=5))
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

    await tick(hass, freezer, timedelta(minutes=31))
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


async def test_live_message(center: Center) -> None:
    """The message follows the entities it reads while the card is open."""
    await center.set("sensor.battery", "40")
    await center.add("Battery", step("Battery {{ states('sensor.battery') }}%"))
    await center.call("trigger", "sensor.nc_battery")
    assert center.attrs("sensor.nc_battery")["message"] == "Battery 40%"
    await center.set("sensor.battery", "15")
    assert center.attrs("sensor.nc_battery")["message"] == "Battery 15%"


async def test_notification_state_trigger_and_condition(center: Center) -> None:
    """A step can start when another notification's step is done."""
    waste = await center.add("Waste", step("Take out the waste"))
    await center.add(
        "Waste check",
        step(
            "Bring the bin back",
            activation={
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
            activation={
                "type": "triggers",
                "triggers": [{"trigger": "event", "event_type": "check"}],
            },
            conditions={
                "activate_only_while_met": True,
                "hide_while_not_met": False,
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

    await tick(hass, freezer, timedelta(hours=2))
    assert center.state("sensor.nc_bell") == "active"


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
        and not state.entity_id.startswith("sensor.nc_channel_")
    ]
    assert len(sensors) == 28
    # A scheduled step due later today makes its notification "upcoming";
    # a card whose conditions fail at this time of day is "hidden".
    assert {state.state for state in sensors} <= {
        "idle",
        "active",
        "hidden",
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
