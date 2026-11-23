"""The Notification Center integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from . import websocket_api
from .const import DOMAIN, PLATFORMS, STORAGE_KEYS
from .devices import DeviceManager
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
    devices: DeviceManager


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
    devices = DeviceManager(engine)
    try:
        await devices.async_start()
        engine.devices = devices
        entry.runtime_data = RuntimeData(
            version=version, manager=manager, engine=engine, devices=devices
        )
        await _async_finish_setup(hass, entry, version)
    except Exception:
        # Nothing may keep running when the setup fails.
        await devices.async_stop()
        await engine.async_unload()
        manager.async_unload()
        raise
    return True


async def _async_finish_setup(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry, version: str
) -> None:

    # Websocket commands cannot be removed, so they are registered once and
    # answer "not loaded" while the integration is unloaded.
    if not hass.data.get(_WEBSOCKET_REGISTERED):
        websocket_api.async_register(hass)
        hass.data[_WEBSOCKET_REGISTERED] = True

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_register_frontend(hass, version)


async def async_unload_entry(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> bool:
    """Unload a config entry."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    async_unregister_frontend(hass, entry.runtime_data.version)
    await entry.runtime_data.devices.async_stop()
    await entry.runtime_data.engine.async_unload()
    entry.runtime_data.manager.async_unload()
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete all stored data when the integration is removed."""
    for key in STORAGE_KEYS:
        await Store[dict[str, Any]](hass, 1, key).async_remove()
