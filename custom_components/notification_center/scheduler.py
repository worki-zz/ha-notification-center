"""Run the schedule of one step: open its card when it is due.

The time a step was last due is kept with the engine's history (state
``scheduled``), so a restart neither repeats an occurrence nor loses one
that fell while Home Assistant was stopped (unless it already expired).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, Final

from homeassistant.core import CALLBACK_TYPE, callback
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_state_change_event,
)
from homeassistant.util import dt as dt_util

from .const import CLOSED_DISMISSED, CLOSED_DONE, SOURCE_SCHEDULE
from .schedule import (
    SCHEDULE_CALENDAR,
    after_last_done_due,
    calendar_after,
    calendar_before,
    every,
    every_entity,
    expires_at,
)

if TYPE_CHECKING:
    from .engine import StepRunner

HISTORY_SCHEDULED: Final = "scheduled"
# The occurrence of a calendar step that was done early, so it is skipped.
HISTORY_SKIPPED: Final = "skipped"
# An after-last-done step that keeps expiring is tried at most this many
# days back when Home Assistant starts.
_MAX_CATCH_UP: Final = 400


class StepSchedule:
    """The schedule of one step."""

    def __init__(self, step: StepRunner, schedule: dict[str, Any]) -> None:
        """Set up the schedule; call ``async_start`` to begin."""
        self.step = step
        self.engine = step.engine
        self.hass = step.hass
        self.config = schedule
        self.next: datetime | None = None
        self._timer: CALLBACK_TYPE | None = None
        self._unsub_every: CALLBACK_TYPE | None = None

    @property
    def is_calendar(self) -> bool:
        """Return whether the schedule follows the calendar."""
        return bool(self.config["type"] == SCHEDULE_CALENDAR)

    def expires_at(self, due: datetime) -> datetime | None:
        """Return when a card due at a time expires, if it does."""
        return expires_at(self.config, due)

    def _still_open(self, due: datetime, now: datetime) -> bool:
        """Return whether a card due at a time would still be open now."""
        until = self.expires_at(due)
        return until is None or until > now

    @property
    def n(self) -> int:
        """Return N; 0 means off."""
        return every(self.hass, self.config)

    def _last_due(self) -> datetime | None:
        return self.engine.last_reached(
            self.step.notification.id, self.step.step_id, HISTORY_SCHEDULED
        )

    def _skipped(self) -> datetime | None:
        return self.engine.last_reached(
            self.step.notification.id, self.step.step_id, HISTORY_SKIPPED
        )

    def _last_done(self) -> datetime | None:
        return self.engine.last_reached(
            self.step.notification.id, self.step.step_id, CLOSED_DONE
        )

    @callback
    def async_start(self) -> None:
        """Open a card missed while stopped, then wait for the next one."""
        if not self.is_calendar and self._last_done() is None:
            # Never done: counted from when the step got its schedule (the
            # notification was made or imported), so it is not due at once.
            self.engine.record(
                self.step.notification.id,
                self.step.step_id,
                CLOSED_DONE,
                dt_util.utcnow(),
            )
        if (entity_id := every_entity(self.config)) is not None:
            self._unsub_every = async_track_state_change_event(
                self.hass, [entity_id], self._every_changed
            )
        self._catch_up()
        self._plan()

    @callback
    def async_stop(self) -> None:
        """Stop waiting."""
        self._cancel()
        if self._unsub_every is not None:
            self._unsub_every()
            self._unsub_every = None

    @callback
    def reschedule(self) -> None:
        """Work out the next time again (last done or N changed)."""
        self._cancel()
        self._plan()
        self.engine.schedule_changed()

    @callback
    def _every_changed(self, *_: Any) -> None:
        self.reschedule()

    def _cancel(self) -> None:
        if self._timer is not None:
            self._timer()
            self._timer = None
        self.next = None

    def due_after(self, now: datetime) -> datetime | None:
        """Return when the step is next due after a time."""
        n = self.n
        if n == 0:
            return None
        if self.is_calendar:
            due = calendar_after(self.config, n, now)
            if due is not None and due == self._skipped():
                due = calendar_after(self.config, n, due)
            return due
        due = after_last_done_due(
            self.config, n, self._last_done(), self._last_due(), now
        )
        while due <= now:
            due = after_last_done_due(self.config, n, self._last_done(), due, now)
        return due

    def _plan(self) -> None:
        now = dt_util.utcnow()
        self.next = self.due_after(now)
        if self.next is None:
            return
        self._timer = async_track_point_in_utc_time(self.hass, self._fire, self.next)

    @callback
    def _fire(self, _now: datetime) -> None:
        self._timer = None
        due = self.next
        self.next = None
        if due is not None:
            self._due(due)
        self._plan()
        self.engine.schedule_changed()

    def _catch_up(self) -> None:
        """Open the card of an occurrence that fell while stopped."""
        n = self.n
        if n == 0:
            return
        now = dt_util.utcnow()
        last = self._last_due()
        if self.is_calendar:
            # A new step only catches up today's occurrence.
            since = last or dt_util.start_of_local_day() - timedelta(microseconds=1)
            due = calendar_before(self.config, n, now, since)
            if due is not None and due == self._skipped():
                self._record(due)
            elif due is not None and self._still_open(due, now):
                self._due(due)
            elif due is not None:
                self._record(due)
            else:
                self._reopen(last, now)
            return
        last_done = self._last_done()
        for _ in range(_MAX_CATCH_UP):
            due = after_last_done_due(self.config, n, last_done, last, now)
            if due > now:
                self._reopen(last, now)
                return
            if self._still_open(due, now):
                self._due(due)
                return
            # Expired while stopped: the next day is tried.
            self._record(due)
            last = due

    def _reopen(self, last: datetime | None, now: datetime) -> None:
        """Open again the last occurrence whose card is gone but still due.

        Switching a notification off forgets its cards; switched on again,
        an occurrence nobody did or dismissed comes back until it expires,
        as it would have stayed over a restart.
        """
        if last is None or last > now or not self._still_open(last, now):
            return
        notification_id = self.step.notification.id
        if self.engine.cards_of(notification_id, self.step.step_id):
            return
        for state in (CLOSED_DONE, CLOSED_DISMISSED, HISTORY_SKIPPED):
            closed = self.engine.last_reached(notification_id, self.step.step_id, state)
            if closed is not None and closed >= last:
                return
        self._due(last)

    def _record(self, due: datetime) -> None:
        self.engine.record(
            self.step.notification.id, self.step.step_id, HISTORY_SCHEDULED, due
        )

    def _due(self, due: datetime) -> None:
        self._record(due)
        self.engine.open(
            self.step,
            None,
            {"platform": "schedule", "due": due.isoformat()},
            SOURCE_SCHEDULE,
            since=due,
            expires_at=self.expires_at(due),
        )
