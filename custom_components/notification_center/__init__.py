"""The Notification Center integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from . import websocket_api
from .const import DOMAIN, PLATFORMS, STORAGE_KEYS, UNIQUE_ID_EVENT
from .engine import Engine
from .frontend_setup import async_register_frontend, async_unregister_frontend
from .services import async_setup_services
from .store import ConfigManager

_WEBSOCKET_REGISTERED = f"{DOMAIN}_websocket_registered"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


@dataclass
class RuntimeData:
    """What a loaded config entry holds."""

    version: str
    manager: ConfigManager
    engine: Engine


type NotificationCenterConfigEntry = ConfigEntry[RuntimeData]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the actions."""
    async_setup_services(hass)
    return True


async def async_setup_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Set up Notification Center from a config entry."""
    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version)

    manager = ConfigManager(hass)
    await manager.async_load()
    engine = Engine(hass, manager)
    await engine.async_load()
    entry.runtime_data = RuntimeData(version=version, manager=manager, engine=engine)
    hass.data[DOMAIN] = manager

    # Websocket commands cannot be removed, so they are registered once and
    # answer "not loaded" while the integration is unloaded.
    if not hass.data.get(_WEBSOCKET_REGISTERED):
        websocket_api.async_register(hass)
        hass.data[_WEBSOCKET_REGISTERED] = True

    # The event entity of 0.2.x is gone: remove what it left in the registry.
    registry = er.async_get(hass)
    if (
        old := registry.async_get_entity_id("event", DOMAIN, UNIQUE_ID_EVENT)
    ) is not None:
        registry.async_remove(old)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_register_frontend(hass, version)
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Unload a config entry."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    async_unregister_frontend(hass, entry.runtime_data.version)
    await entry.runtime_data.engine.async_unload()
    entry.runtime_data.manager.async_unload()
    hass.data.pop(DOMAIN, None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete all stored data when the integration is removed."""
    for key in STORAGE_KEYS:
        await Store[dict[str, Any]](hass, 1, key).async_remove()
