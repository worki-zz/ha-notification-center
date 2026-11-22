"""Register the sidebar panel and the dashboard card with the frontend."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import (
    CARD_FILENAME,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_FILENAME,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    SOUNDS_URL_BASE,
    STATIC_URL_BASE,
)

FRONTEND_DIR = Path(__file__).parent / "frontend"
SOUNDS_DIR = Path(__file__).parent / "sounds"
_STATIC_REGISTERED = f"{DOMAIN}_static_registered"


def _versioned_url(filename: str, version: str) -> str:
    """Return the URL of a frontend module, with the version for cache busting."""
    return f"{STATIC_URL_BASE}/{filename}?v={version}"


async def async_register_frontend(hass: HomeAssistant, version: str) -> None:
    """Serve the frontend modules, add the panel and load the card everywhere."""
    # Static paths cannot be unregistered, so register them once per run.
    if not hass.data.get(_STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_URL_BASE, str(FRONTEND_DIR), cache_headers=False
                ),
                StaticPathConfig(SOUNDS_URL_BASE, str(SOUNDS_DIR), cache_headers=True),
            ]
        )
        hass.data[_STATIC_REGISTERED] = True

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=_versioned_url(PANEL_FILENAME, version),
        require_admin=False,
    )

    # Loading the card as an extra module makes it available on every
    # dashboard without adding a dashboard resource by hand.
    frontend.add_extra_js_url(hass, _versioned_url(CARD_FILENAME, version))


def async_unregister_frontend(hass: HomeAssistant, version: str) -> None:
    """Remove the panel and stop loading the card."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    frontend.remove_extra_js_url(hass, _versioned_url(CARD_FILENAME, version))
