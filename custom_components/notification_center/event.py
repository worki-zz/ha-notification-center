"""The event entity: one event for every change of a card.

``event.notification_center`` fires ``active``, ``done``, ``snoozed``,
``dismissed``, ``expired`` and ``button`` events, with the notification's
sensor, the step number, the entity, the source and the person in the data.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, EVENT_TYPES, PANEL_ICON, UNIQUE_ID_EVENT
from .entity import device_info

if TYPE_CHECKING:
    from . import NotificationCenterConfigEntry
    from .engine import Engine

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: NotificationCenterConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the event entity."""
    runtime = entry.runtime_data
    async_add_entities(
        [NotificationEvent(runtime.engine, device_info(entry, runtime.version))]
    )


class NotificationEvent(EventEntity):
    """Report what happens to the cards."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = PANEL_ICON
    _attr_translation_key = "notification_center"

    def __init__(self, engine: Engine, info: Any) -> None:
        """Set up the event entity."""
        self._engine = engine
        self._attr_unique_id = UNIQUE_ID_EVENT
        self._attr_event_types = list(EVENT_TYPES)
        self._attr_device_info = info
        self.entity_id = f"event.{DOMAIN}"

    async def async_added_to_hass(self) -> None:
        """Follow the events of the engine."""
        await super().async_added_to_hass()
        self.async_on_remove(self._engine.async_add_event_listener(self._fired))

    @callback
    def _fired(self, event_type: str, data: dict[str, Any]) -> None:
        self._trigger_event(event_type, data)
        self.async_write_ha_state()
