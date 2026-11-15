"""The Notification Center integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration

from . import websocket_api
from .const import DOMAIN, STORAGE_KEYS
from .frontend_setup import async_register_frontend, async_unregister_frontend
from .store import ConfigManager

_WEBSOCKET_REGISTERED = f"{DOMAIN}_websocket_registered"


@dataclass
class RuntimeData:
    """What a loaded config entry holds."""

    version: str
    manager: ConfigManager


type NotificationCenterConfigEntry = ConfigEntry[RuntimeData]


async def async_setup_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Set up Notification Center from a config entry."""
    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version)

    manager = ConfigManager(hass)
    await manager.async_load()
    entry.runtime_data = RuntimeData(version=version, manager=manager)
    hass.data[DOMAIN] = manager

    # Websocket commands cannot be removed, so they are registered once and
    # answer "not loaded" while the integration is unloaded.
    if not hass.data.get(_WEBSOCKET_REGISTERED):
        websocket_api.async_register(hass)
        hass.data[_WEBSOCKET_REGISTERED] = True

    await async_register_frontend(hass, version)
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Unload a config entry."""
    async_unregister_frontend(hass, entry.runtime_data.version)
    entry.runtime_data.manager.async_unload()
    hass.data.pop(DOMAIN, None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete all stored data when the integration is removed."""
    for key in STORAGE_KEYS:
        await Store[dict[str, Any]](hass, 1, key).async_remove()
