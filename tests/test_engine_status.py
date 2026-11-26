"""Status actions, Snooze when and Mute when."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_mock_service

from .common import Center, state_trigger, step, tick


def _ring(text: str) -> dict[str, Any]:
    """Return a status action that records a text."""
    return {"action": "test.ring", "data": {"what": text}}


def _actions(*texts: str, entity_action: bool = False) -> dict[str, Any]:
    return {
        "entity_action": entity_action,
        "ha_actions": [_ring(text) for text in texts],
    }


async def test_status_actions_run_whatever_caused_it(
    hass: HomeAssistant, center: Center
) -> None:
    """Activation and Done when actions run on any change, with their cause."""
    calls = async_mock_service(hass, "test", "ring")
    await center.add(
        "Mail",
        step(
            activation={
                "type": "triggers",
                "triggers": [state_trigger("binary_sensor.mail")],
                "actions": _actions("{{ status }} {{ cause.source }}"),
            },
            done_when={
                "triggers": [state_trigger("binary_sensor.mail", "off")],
                "actions": _actions("{{ status }} {{ cause.source }}"),
            },
        ),
    )
    await center.set("binary_sensor.mail", "on")
    await hass.async_block_till_done()
    assert [call.data["what"] for call in calls] == ["active trigger"]

    await center.set("binary_sensor.mail", "off")
    await hass.async_block_till_done()
    assert calls[-1].data["what"] == "done trigger"

    # The integration's own action.
    await center.call("trigger", "sensor.nc_mail")
    await center.call("done", "sensor.nc_mail")
    assert [call.data["what"] for call in calls][-2:] == [
        "active action",
        "done action",
    ]


async def test_run_state_actions_switch(hass: HomeAssistant, center: Center) -> None:
    """A button with Run ... actions off sets the state without the actions."""
    calls = async_mock_service(hass, "test", "ring")
    nid = await center.add(
        "Plants",
        step(
            done_when={"actions": _actions("done")},
            dismiss_when={"actions": _actions("dismissed {{ cause.button }}")},
            buttons=[
                {"type": "done", "id": "done", "run_state_actions": False},
                {"type": "dismiss", "id": "dismiss", "enabled": True},
            ],
        ),
    )
    await center.call("trigger", "sensor.nc_plants")
    card = center.engine.cards_of(nid)[0]
    await center.engine.async_press(card, "done", None)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "done"
    assert calls == []

    await center.call("trigger", "sensor.nc_plants")
    card = center.engine.cards_of(nid)[0]
    await center.engine.async_press(card, "dismiss", None)
    await hass.async_block_till_done()
    assert [call.data["what"] for call in calls] == ["dismissed dismiss"]


async def test_entity_actions_of_status_blocks(
    hass: HomeAssistant, center: Center
) -> None:
    """Done when runs the Done button's entity action; Activation its own."""
    calls = async_mock_service(hass, "test", "ring")
    await center.set("binary_sensor.front", "on", device_class="door")
    nid = await center.add(
        "Doors",
        step(
            activation={"type": "triggers", "actions": {"entity_action": True}},
            done_when={"actions": {"entity_action": True}},
            buttons=[{"type": "done", "id": "done-1"}],
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    config = center.engine.notification_config(nid) or {}
    step_id = config["steps"][0]["id"]
    item = dict(config)
    item["entities"] = [
        {
            "entity_id": "binary_sensor.front",
            "actions": {
                f"{step_id}.activation": [_ring("on {{ entity }}")],
                "done-1": [_ring("done {{ entity }}")],
            },
        }
    ]
    await center.manager.async_update("notifications", nid, item)
    await hass.async_block_till_done()
    await center.call("trigger", "sensor.nc_doors", entity="binary_sensor.front")
    await center.call("done", "sensor.nc_doors")
    assert [call.data["what"] for call in calls] == [
        "on binary_sensor.front",
        "done binary_sensor.front",
    ]


async def test_snooze_when(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """Its triggers snooze for the Snooze for; the snooze end can run Activation."""
    calls = async_mock_service(hass, "test", "ring")
    nid = await center.add(
        "Plants",
        step(
            activation={"type": "triggers", "actions": _actions("{{ cause.source }}")},
            snooze_when={
                "enabled": True,
                "triggers": [state_trigger("input_boolean.away")],
                "actions": _actions("snoozed"),
                "rerun_activation": True,
            },
            buttons=[{"type": "snooze", "snooze_for": "30m"}],
        ),
    )
    await center.call("trigger", "sensor.nc_plants")
    before = dt_util.utcnow()
    await center.set("input_boolean.away", "on")
    await hass.async_block_till_done()
    card = center.engine.cards_of(nid)[0]
    assert center.state("sensor.nc_plants") == "snoozed"
    until = card.snoozed_until
    assert until is not None
    assert timedelta(minutes=29) < until - before <= timedelta(minutes=31)
    assert [call.data["what"] for call in calls] == ["action", "snoozed"]

    await tick(hass, freezer, timedelta(minutes=31))
    assert center.state("sensor.nc_plants") == "active"
    assert calls[-1].data["what"] == "snooze_end"


async def test_snooze_when_switched_off(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """Switched off, it keeps its content but nothing of it runs."""
    calls = async_mock_service(hass, "test", "ring")
    await center.add(
        "Plants",
        step(
            activation={"type": "triggers", "actions": _actions("active")},
            snooze_when={
                "triggers": [state_trigger("input_boolean.away")],
                "actions": _actions("snoozed"),
                "rerun_activation": True,
            },
        ),
    )
    await center.call("trigger", "sensor.nc_plants")
    await center.set("input_boolean.away", "on")
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "active"

    await center.call("snooze", "sensor.nc_plants", duration={"minutes": 10})
    assert center.state("sensor.nc_plants") == "snoozed"
    await tick(hass, freezer, timedelta(minutes=11))
    assert center.state("sensor.nc_plants") == "active"
    assert [call.data["what"] for call in calls] == ["active"]


async def test_mute_when(hass: HomeAssistant, center: Center) -> None:
    """Its triggers mute the card (it stays); its actions run once."""
    calls = async_mock_service(hass, "test", "ring")
    nid = await center.add(
        "Smoke",
        step(
            mute_when={
                "enabled": True,
                "triggers": [state_trigger("input_boolean.quiet")],
                "actions": _actions("muted {{ cause.source }}"),
            },
        ),
    )
    await center.call("trigger", "sensor.nc_smoke")
    await center.set("input_boolean.quiet", "on")
    await hass.async_block_till_done()
    card = center.engine.cards_of(nid)[0]
    assert card.muted
    assert center.state("sensor.nc_smoke") == "active"
    assert [call.data["what"] for call in calls] == ["muted trigger"]

    await center.set("input_boolean.quiet", "off")
    await center.set("input_boolean.quiet", "on")
    await hass.async_block_till_done()
    assert len(calls) == 1
