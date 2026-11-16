"""Shared parts of the Notification Center entities."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo

from .const import DOMAIN, NAME


def device_info(entry: ConfigEntry, version: str) -> DeviceInfo:
    """Return the service device every entity belongs to."""
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=NAME,
        entry_type=DeviceEntryType.SERVICE,
        sw_version=version,
    )
