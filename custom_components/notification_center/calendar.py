"""The calendar of the scheduled steps.

``calendar.notification_center`` is read-only. Each occurrence of a
scheduled step is an event: the notification's name, the step's message,
from the due time until it expires (one hour if it does not). A step without
a time of day (after last done without At) is an all-day event.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, UNIQUE_ID_CALENDAR
from .entity import device_info

if TYPE_CHECKING:
    from . import NotificationCenterConfigEntry
    from .engine import Engine

PARALLEL_UPDATES = 0

# How far ahead the state looks for the next event.
_LOOK_AHEAD = timedelta(days=366)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: NotificationCenterConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the calendar."""
    runtime = entry.runtime_data
    async_add_entities(
        [NotificationCalendar(runtime.engine, device_info(entry, runtime.version))]
    )


def _event(item: dict[str, Any]) -> CalendarEvent:
    start: datetime = item["start"]
    end: datetime = item["end"]
    uid = f"{item['notification_id']}-{item['step_id']}-{start.isoformat()}"
    if item["all_day"]:
        day = dt_util.as_local(start).date()
        return CalendarEvent(
            start=day,
            end=day + timedelta(days=1),
            summary=item["summary"],
            description=item["description"],
            uid=uid,
        )
    return CalendarEvent(
        start=dt_util.as_local(start),
        end=dt_util.as_local(end),
        summary=item["summary"],
        description=item["description"],
        uid=uid,
    )


class NotificationCalendar(CalendarEntity):
    """The occurrences of the scheduled steps."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = "mdi:calendar-clock"
    _attr_translation_key = "schedule"

    def __init__(self, engine: Engine, info: Any) -> None:
        """Set up the calendar."""
        self._engine = engine
        self._attr_unique_id = UNIQUE_ID_CALENDAR
        self._attr_device_info = info
        self.entity_id = f"calendar.{DOMAIN}"
        self._event: CalendarEvent | None = None

    async def async_added_to_hass(self) -> None:
        """Follow the engine."""
        await super().async_added_to_hass()
        self.async_on_remove(self._engine.async_add_listener(self._changed))
        self._update()

    @callback
    def _changed(self) -> None:
        self._update()
        self.async_write_ha_state()

    def _update(self) -> None:
        now = dt_util.utcnow()
        # An event that started up to a day ago may still be on.
        items = self._engine.calendar_events(now - timedelta(days=1), now + _LOOK_AHEAD)
        events = [_event(item) for item in items]
        self._event = next(
            (event for event in events if event.end_datetime_local > now), None
        )

    @property
    def event(self) -> CalendarEvent | None:
        """Return the current or next event."""
        # Worked out again on every write, so the state also moves on when
        # an event ends without any change in the engine.
        self._update()
        return self._event

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Return the events between two times."""
        return [
            _event(item)
            for item in self._engine.calendar_events(
                dt_util.as_utc(start_date), dt_util.as_utc(end_date)
            )
        ]
