"""Tests for setting up and removing the Notification Center integration."""

from __future__ import annotations

from typing import Any

from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL, DATA_PANELS
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.notification_center.const import (
    CARD_FILENAME,
    PANEL_ELEMENT,
    PANEL_FILENAME,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL_BASE,
    STORAGE_KEYS,
)

VERSION = "0.7.11"
CARD_URL = f"{STATIC_URL_BASE}/{CARD_FILENAME}?v={VERSION}"


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_setup_registers_panel_and_card(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Setting up adds the sidebar panel and loads the card module."""
    await _setup(hass, config_entry)

    assert config_entry.state is ConfigEntryState.LOADED
    assert config_entry.runtime_data.version == VERSION

    panel = hass.data[DATA_PANELS][PANEL_URL_PATH]
    assert panel.sidebar_title == PANEL_TITLE
    assert panel.sidebar_icon == PANEL_ICON
    assert panel.require_admin is False
    assert panel.config is not None
    custom = panel.config["_panel_custom"]
    assert custom["name"] == PANEL_ELEMENT
    assert custom["module_url"] == f"{STATIC_URL_BASE}/{PANEL_FILENAME}?v={VERSION}"

    assert CARD_URL in hass.data[DATA_EXTRA_MODULE_URL].urls


async def test_unload_removes_panel_and_card(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Unloading removes the panel and stops loading the card."""
    await _setup(hass, config_entry)

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.state is ConfigEntryState.NOT_LOADED
    assert PANEL_URL_PATH not in hass.data[DATA_PANELS]
    assert CARD_URL not in hass.data[DATA_EXTRA_MODULE_URL].urls


async def test_reload(hass: HomeAssistant, config_entry: MockConfigEntry) -> None:
    """A reload registers the panel again without errors."""
    await _setup(hass, config_entry)

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()

    assert config_entry.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH in hass.data[DATA_PANELS]


async def test_frontend_files_are_served(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_client: ClientSessionGenerator,
) -> None:
    """The built panel and card modules are reachable over HTTP."""
    await _setup(hass, config_entry)
    client = await hass_client()

    for filename in (PANEL_FILENAME, CARD_FILENAME):
        response = await client.get(f"{STATIC_URL_BASE}/{filename}")
        assert response.status == 200, filename


async def test_remove_entry_deletes_storage(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_storage: dict[str, Any]
) -> None:
    """Removing the integration deletes its stored data."""
    await _setup(hass, config_entry)
    for key in STORAGE_KEYS:
        await Store[dict[str, Any]](hass, 1, key).async_save({"stored": True})
    assert all(key in hass_storage for key in STORAGE_KEYS)

    await hass.config_entries.async_remove(config_entry.entry_id)
    await hass.async_block_till_done()

    assert not any(key in hass_storage for key in STORAGE_KEYS)
    assert PANEL_URL_PATH not in hass.data[DATA_PANELS]
