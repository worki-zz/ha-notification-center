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
STORAGE_KEYS: Final[tuple[str, ...]] = (
    DOMAIN,
    f"{DOMAIN}.runtime",
    f"{DOMAIN}.backup",
)

# Entity platforms
PLATFORMS: Final = ("calendar", "sensor")

# Unique ids of the entities. A notification's sensor uses the prefix and the
# notification's id.
UNIQUE_ID_NOTIFICATION_PREFIX: Final = "notification-"
UNIQUE_ID_SUMMARY: Final = "summary"
# The event entity of 0.2.x, removed: only its registry entry is cleaned up.
UNIQUE_ID_EVENT: Final = "event"
UNIQUE_ID_CALENDAR: Final = "calendar"

# What a notification's sensor shows, most important first: with more than
# one card, the first of these that applies is the state.
STATE_ACTIVE: Final = "active"
STATE_HIDDEN: Final = "hidden"
STATE_SNOOZED: Final = "snoozed"
STATE_UPCOMING: Final = "upcoming"
STATE_DONE: Final = "done"
STATE_IDLE: Final = "idle"
STATE_DISABLED: Final = "disabled"
SENSOR_STATES: Final = (
    STATE_ACTIVE,
    STATE_HIDDEN,
    STATE_SNOOZED,
    STATE_UPCOMING,
    STATE_DONE,
    STATE_IDLE,
    STATE_DISABLED,
)

# Ways a card closes.
CLOSED_DONE: Final = "done"
CLOSED_DISMISSED: Final = "dismissed"
CLOSED_EXPIRED: Final = "expired"

# What the engine reports about a card (for the channels).
EVENT_ACTIVE: Final = "active"
EVENT_DONE: Final = "done"
EVENT_SNOOZED: Final = "snoozed"
EVENT_DISMISSED: Final = "dismissed"
EVENT_EXPIRED: Final = "expired"

# What started or closed a card.
SOURCE_TRIGGER: Final = "trigger"
SOURCE_ENTITY: Final = "entity"
SOURCE_ACTION: Final = "action"
SOURCE_BUTTON: Final = "button"
SOURCE_DONE_WHEN: Final = "done_when"
SOURCE_SCHEDULE: Final = "schedule"
SOURCE_SNOOZE_END: Final = "snooze_end"

# Actions
SERVICE_TRIGGER: Final = "trigger"
SERVICE_DONE: Final = "done"
SERVICE_CLEAR: Final = "clear"
SERVICE_SNOOZE: Final = "snooze"
SERVICE_SET_LAST_DONE: Final = "set_last_done"

# Snooze time of "Tomorrow" when the step is not scheduled.
DEFAULT_SNOOZE_TOMORROW_AT: Final = "08:00"
