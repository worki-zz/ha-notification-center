"""The Notification Center integration."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration

from .const import DOMAIN, STORAGE_KEYS
from .frontend_setup import async_register_frontend, async_unregister_frontend

type NotificationCenterConfigEntry = ConfigEntry[str]
"""The runtime data of the config entry is the integration version."""


async def async_setup_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Set up Notification Center from a config entry."""
    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version)
    entry.runtime_data = version
    await async_register_frontend(hass, version)
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Unload a config entry."""
    async_unregister_frontend(hass, entry.runtime_data)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete all stored data when the integration is removed."""
    for key in STORAGE_KEYS:
        await Store[dict[str, Any]](hass, 1, key).async_remove()
