"""Tests of the placeholders of a card's texts."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from custom_components.notification_center.render import (
    entity_placeholders,
    replace_placeholders,
)


async def test_device_class_placeholder(hass: HomeAssistant) -> None:
    """{Device class} is the device class by name; empty without one."""
    hass.states.async_set(
        "binary_sensor.bath_leak",
        "on",
        {"device_class": "moisture", "friendly_name": "Bath leak"},
    )
    hass.states.async_set("sensor.plain", "1", {"friendly_name": "Plain"})
    values = entity_placeholders(hass, "binary_sensor.bath_leak")
    assert values["Device class"] == "Moisture"
    assert (
        replace_placeholders("{Device class}: {Entity}", values)
        == "Moisture: Bath leak"
    )
    assert entity_placeholders(hass, "sensor.plain")["Device class"] == ""
