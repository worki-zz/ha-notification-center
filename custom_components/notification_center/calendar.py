"""The calendar of the scheduled steps.

``calendar.notification_center`` is read-only. Each occurrence of a
scheduled step is an all-day event on the day it is due: the notification's
name and the step's message. The time of day (At) and the expiry only tell
when the card shows and goes away, the task itself belongs to the day.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, UNIQUE_ID_CALENDAR
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
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "schedule"

    def __init__(self, engine: Engine, info: Any) -> None:
        """Set up the calendar."""
        self._engine = engine
        self._attr_unique_id = UNIQUE_ID_CALENDAR
        self._attr_device_info = info
        self.entity_id = f"calendar.{DOMAIN}"

    @property
    def event(self) -> CalendarEvent | None:
        """Return no current event, so the state stays off.

        The calendar is for looking at the schedule. An "on" while an event
        is on would put a row in the Activity log every day.
        """
        return None

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
