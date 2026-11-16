"""Tests for the triggers and conditions offered to automations."""

from __future__ import annotations

from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.trigger import async_get_all_descriptions
from homeassistant.setup import async_setup_component

from .common import DOOR_GROUP, Center, step


def _capture(hass: HomeAssistant, event_type: str) -> list[Event]:
    events: list[Event] = []

    @callback
    def listener(event: Event) -> None:
        events.append(event)

    hass.bus.async_listen(event_type, listener)
    return events


async def _automation(
    hass: HomeAssistant, trigger: dict[str, Any], **extra: Any
) -> None:
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "alias": "test",
                "triggers": [trigger],
                "actions": [
                    {
                        "event": "fired",
                        "event_data": {
                            "entity": "{{ trigger.entity_id }}",
                            "step": "{{ trigger.step }}",
                            "notification": "{{ trigger.notification }}",
                        },
                    }
                ],
                **extra,
            }
        },
    )
    await hass.async_block_till_done()


async def test_notification_state_trigger(hass: HomeAssistant, center: Center) -> None:
    """An automation fires when a notification is done."""
    await center.add("Plants", step(), step("Second"))
    fired = _capture(hass, "fired")
    await _automation(
        hass,
        {
            "trigger": "notification_center.notification_state",
            "notification": "sensor.nc_plants",
            "step": 2,
            "state": "done",
        },
    )
    await center.call("trigger", "sensor.nc_plants")
    await center.call("done", "sensor.nc_plants")
    assert fired == []
    await center.call("trigger", "sensor.nc_plants", step=2)
    await center.call("done", "sensor.nc_plants", step=2)
    assert len(fired) == 1
    assert fired[0].data["step"] == 2
    assert fired[0].data["notification"] == "sensor.nc_plants"


async def test_listed_entities_trigger(hass: HomeAssistant, center: Center) -> None:
    """An automation fires when a listed entity starts to match."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.set("binary_sensor.back", "off", device_class="door")
    await center.add("Doors", step(), entity_groups=[DOOR_GROUP])
    fired = _capture(hass, "fired")
    await _automation(
        hass,
        {
            "trigger": "notification_center.listed_entities",
            "options": {"notification": "sensor.nc_doors", "to": "on"},
        },
    )
    # An entity that already matches does not fire.
    assert fired == []
    await center.set("binary_sensor.back", "on", device_class="door")
    assert [event.data["entity"] for event in fired] == ["binary_sensor.back"]


async def test_notification_state_condition(
    hass: HomeAssistant, center: Center
) -> None:
    """An automation checks whether a notification was done lately."""
    await center.add("Plants", step())
    fired = _capture(hass, "fired")
    await _automation(
        hass,
        {"trigger": "event", "event_type": "check"},
        conditions=[
            {
                "condition": "notification_center.notification_state",
                "notification": "sensor.nc_plants",
                "state": "done",
                "within": {"hours": 1},
            }
        ],
    )
    hass.bus.async_fire("check")
    await hass.async_block_till_done()
    assert fired == []
    await center.call("done", "sensor.nc_plants")
    hass.bus.async_fire("check")
    await hass.async_block_till_done()
    assert len(fired) == 1


async def test_listed_entities_condition(hass: HomeAssistant, center: Center) -> None:
    """An automation checks whether any listed entity matches."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add("Doors", step(), entity_groups=[DOOR_GROUP])
    fired = _capture(hass, "fired")
    await _automation(
        hass,
        {"trigger": "event", "event_type": "check"},
        conditions=[
            {
                "condition": "notification_center.listed_entities",
                "notification": "sensor.nc_doors",
                "to": "on",
            }
        ],
    )
    hass.bus.async_fire("check")
    await hass.async_block_till_done()
    assert fired == []
    await center.set("binary_sensor.front", "on", device_class="door")
    hass.bus.async_fire("check")
    await hass.async_block_till_done()
    assert len(fired) == 1


async def test_editor_descriptions(hass: HomeAssistant, center: Center) -> None:
    """The automation editor finds the triggers with their fields."""
    descriptions = await async_get_all_descriptions(hass)
    assert "notification_center.notification_state" in descriptions
    listed = descriptions["notification_center.listed_entities"]
    assert listed is not None
    fields = listed["fields"]
    assert {"notification", "to", "above", "for"} <= set(fields)
