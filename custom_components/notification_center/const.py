"""Constants for the Notification Center integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "notification_center"
NAME: Final = "Notification Center"

# Sidebar panel
PANEL_URL_PATH: Final = "notification-center"
PANEL_TITLE: Final = "Notification Center"
PANEL_ICON: Final = "mdi:message-bulleted"
PANEL_ELEMENT: Final = "notification-center-panel"

# Dashboard card
CARD_ELEMENT: Final = "notification-center-card"

# Static files: the built frontend modules are served from here.
STATIC_URL_BASE: Final = f"/{DOMAIN}_static"
PANEL_FILENAME: Final = "notification-center-panel.js"
CARD_FILENAME: Final = "notification-center-card.js"

# Storage keys owned by the integration. They are deleted when the
# config entry is removed.
STORAGE_KEYS: Final[tuple[str, ...]] = (DOMAIN, f"{DOMAIN}.runtime")
