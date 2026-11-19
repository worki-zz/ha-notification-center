"""When a scheduled step is due.

A step starts on a schedule in one of two ways:

- **calendar**: every N days, weeks (on the chosen weekdays), months (on a
  day of the month) or years, at a time, counted from the ``starting`` date;
- **after last done**: N days, weeks, months or years after the step was
  last done, at a time if one is set.

N can be a number or an entity whose state is a number. N = 0, or an entity
without a number, switches the schedule off.

All the arithmetic is on local dates, so a step at 10:00 stays at 10:00
across the daylight saving changes.
"""

from __future__ import annotations

from calendar import monthrange
from collections.abc import Iterator, Mapping
from datetime import date, datetime, time, timedelta
from typing import Any, Final

from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.util import dt as dt_util

from .model import WEEKDAYS

SCHEDULE_CALENDAR: Final = "calendar"
SCHEDULE_AFTER_LAST_DONE: Final = "after_last_done"

# How far ahead a calendar is searched for the next occurrence.
_SEARCH_YEARS: Final = 30
# The first day counted from when a calendar schedule has no starting date:
# a Monday, so weeks are whole weeks.
_DEFAULT_ANCHOR: Final = date(2024, 1, 1)


def every(hass: HomeAssistant, schedule: Mapping[str, Any]) -> int:
    """Return N of a schedule; 0 when it is off or the entity has no number."""
    value = schedule["every"]
    if isinstance(value, int):
        return max(value, 0)
    state = hass.states.get(str(value))
    if state is None:
        return 0
    try:
        number = int(float(state.state))
    except ValueError:
        return 0
    return max(number, 0)


def every_entity(schedule: Mapping[str, Any]) -> str | None:
    """Return the entity that holds N, if N is not a number."""
    value = schedule["every"]
    return None if isinstance(value, int) else str(value)


def is_valid_every(hass: HomeAssistant, schedule: Mapping[str, Any]) -> bool:
    """Return whether N is a number (an entity's state that is not is wrong)."""
    entity_id = every_entity(schedule)
    if entity_id is None:
        return True
    state = hass.states.get(entity_id)
    if state is None:
        return False
    try:
        float(state.state)
    except ValueError:
        return False
    return True


def expires_at(schedule: Mapping[str, Any], due: datetime) -> datetime | None:
    """Return when a card of the schedule that was due at a time expires.

    ``expires`` is a duration, or a day after the due day (0 is the same
    day) at a time; a time on the same day that is not after the due time
    means the next day.
    """
    value = schedule.get("expires")
    if not value:
        return None
    if "day" in value:
        at = dt_util.parse_time(str(value["at"])) or time(0)
        local = dt_util.as_local(due)
        when = _local(local.date() + timedelta(days=int(value["day"])), at)
        if when <= due:
            when = _local(local.date() + timedelta(days=int(value["day"]) + 1), at)
        return when
    period: timedelta = cv.positive_time_period_dict(value)
    return due + period if period else None


def _at(schedule: Mapping[str, Any]) -> time | None:
    value = schedule.get("at")
    return dt_util.parse_time(value) if value else None


def _local(day: date, at: time) -> datetime:
    """Return a local time as UTC, moving a time skipped by DST forward."""
    zone = dt_util.get_default_time_zone()
    local = datetime.combine(day, at, tzinfo=zone)
    # A time that does not exist (spring forward) comes back one hour later
    # after a round trip through UTC; a repeated one (fall back) is the first.
    return dt_util.as_utc(local)


def _add_months(day: date, months: int, wanted_day: int | str | None = None) -> date:
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    last = monthrange(year, month)[1]
    target = day.day if wanted_day is None else wanted_day
    if target == "last":
        return date(year, month, last)
    return date(year, month, min(int(target), last))


def add_units(day: date, count: int, unit: str) -> date:
    """Return a date some days, weeks, months or years later."""
    if unit == "days":
        return day + timedelta(days=count)
    if unit == "weeks":
        return day + timedelta(weeks=count)
    if unit == "months":
        return _add_months(day, count)
    return _add_months(day, count * 12)


# -- Calendar ---------------------------------------------------------------


def _anchor(schedule: Mapping[str, Any]) -> date:
    starting = schedule.get("starting")
    return (dt_util.parse_date(starting) if starting else None) or _DEFAULT_ANCHOR


def _calendar_days(schedule: Mapping[str, Any], n: int, first: date) -> Iterator[date]:
    """Yield the days of a calendar schedule, from ``first`` on."""
    anchor = _anchor(schedule)
    starting = bool(schedule.get("starting"))
    first = max(first, anchor) if starting else first
    unit = schedule["unit"]
    end = date(min(first.year + _SEARCH_YEARS * max(n, 1), 9998), 12, 31)
    if unit == "days":
        offset = (first - anchor).days % n
        day = first if offset == 0 else first + timedelta(days=n - offset)
        while day <= end:
            yield day
            day += timedelta(days=n)
        return
    if unit == "weeks":
        weekdays = {WEEKDAYS.index(item) for item in schedule.get("weekdays") or []}
        if not weekdays:
            weekdays = {anchor.weekday()}
        anchor_monday = anchor - timedelta(days=anchor.weekday())
        monday = first - timedelta(days=first.weekday())
        weeks = (monday - anchor_monday).days // 7
        if weeks % n:
            monday += timedelta(weeks=n - weeks % n)
        while monday <= end:
            for weekday in sorted(weekdays):
                day = monday + timedelta(days=weekday)
                if day >= first:
                    yield day
            monday += timedelta(weeks=n)
        return
    months = n if unit == "months" else n * 12
    wanted = schedule.get("day_of_month") or (anchor.day if starting else 1)
    month_of_year = schedule.get("month") if unit == "years" else None
    start_month = anchor.replace(day=1)
    if month_of_year is not None:
        start_month = start_month.replace(month=int(month_of_year))
        if start_month < anchor.replace(day=1) and starting:
            start_month = start_month.replace(year=start_month.year + 1)
    elif unit == "years" and not starting:
        start_month = start_month.replace(month=1)
    index = 0
    while True:
        day = _add_months(start_month, index * months, wanted)
        if day > end:
            return
        if day >= first:
            yield day
        index += 1


def calendar_after(
    schedule: Mapping[str, Any], n: int, after: datetime
) -> datetime | None:
    """Return the first occurrence of a calendar schedule after a time."""
    at = _at(schedule) or time(0)
    first = dt_util.as_local(after).date()
    for day in _calendar_days(schedule, n, first):
        when = _local(day, at)
        if when > after:
            return when
    return None


def calendar_before(
    schedule: Mapping[str, Any], n: int, before: datetime, since: datetime
) -> datetime | None:
    """Return the last occurrence at or before a time, but after ``since``."""
    at = _at(schedule) or time(0)
    first = dt_util.as_local(since).date()
    last: datetime | None = None
    for day in _calendar_days(schedule, n, first):
        when = _local(day, at)
        if when > before:
            break
        if when > since:
            last = when
    return last


def calendar_between(
    schedule: Mapping[str, Any], n: int, start: datetime, end: datetime
) -> Iterator[datetime]:
    """Yield the occurrences of a calendar schedule between two times."""
    at = _at(schedule) or time(0)
    first = dt_util.as_local(start).date() - timedelta(days=1)
    for day in _calendar_days(schedule, n, first):
        when = _local(day, at)
        if when >= end:
            return
        if when >= start:
            yield when


# -- After last done --------------------------------------------------------


def after_last_done_due(
    schedule: Mapping[str, Any],
    n: int,
    last_done: datetime | None,
    last_due: datetime | None,
    now: datetime,
) -> datetime:
    """Return when an after-last-done step is due.

    Never done: at the next At time, or now without one. After a due time
    that passed without the step being done (it expired or was dismissed),
    it is due again a day later.
    """
    at = _at(schedule)
    if last_done is None:
        due = now if at is None else _next_at(at, now)
    else:
        local = dt_util.as_local(last_done)
        day = add_units(local.date(), n, schedule["unit"])
        due = _local(day, at or local.time())
    if last_due is not None and last_due >= due:
        due = _next_day(last_due, at)
    return due


def _next_at(at: time, now: datetime) -> datetime:
    today = dt_util.as_local(now).date()
    when = _local(today, at)
    return when if when >= now else _local(today + timedelta(days=1), at)


def _next_day(last: datetime, at: time | None) -> datetime:
    local = dt_util.as_local(last)
    return _local(local.date() + timedelta(days=1), at or local.time())
