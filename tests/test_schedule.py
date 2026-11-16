"""Tests for scheduled steps: due times, expiry, upcoming and the calendar."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
import zoneinfo

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.notification_center import schedule as sched

from .common import Center, load

ZONE = "Europe/Budapest"


def _local(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=zoneinfo.ZoneInfo(ZONE))


def _fmt(value: datetime | str | None) -> str:
    if isinstance(value, str):
        value = dt_util.parse_datetime(value)
    assert value is not None
    return dt_util.as_local(value).strftime("%Y-%m-%d %a %H:%M")


@pytest.fixture
async def budapest(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> None:
    await hass.config.async_set_time_zone(ZONE)
    # A Monday morning.
    freezer.move_to(_local("2026-11-16 09:00"))


async def _move(hass: HomeAssistant, freezer: FrozenDateTimeFactory, when: str) -> None:
    freezer.move_to(_local(when))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()


def _scheduled(schedule: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "message": extra.pop("message", "Do it"),
        "start": {
            "type": "schedule",
            "schedule": schedule,
            "conditions": extra.pop("conditions", []),
        },
        **extra,
    }


WEEKLY_WASTE = {
    "type": "calendar",
    "every": 1,
    "unit": "weeks",
    "weekdays": ["wed"],
    "at": "19:00",
    "expires": {"hours": 14},
}


# -- Due times ----------------------------------------------------------------


def test_rotating_three_weekly_tasks(budapest: None) -> None:
    """Three tasks every 3 weeks from different Sundays take turns."""
    after = _local("2026-11-16 09:00")
    firsts = {}
    for name, starting in (
        ("bedding", "2026-11-01"),
        ("bottles", "2026-11-08"),
        ("bin", "2026-11-15"),
    ):
        schedule = {
            "type": "calendar",
            "every": 3,
            "unit": "weeks",
            "weekdays": ["sat"],
            "at": "10:00",
            "starting": starting,
        }
        first = sched.calendar_after(schedule, 3, after)
        assert first is not None
        second = sched.calendar_after(schedule, 3, first)
        firsts[name] = (_fmt(first), _fmt(second))
    assert firsts == {
        "bedding": ("2026-11-21 Sat 10:00", "2026-12-12 Sat 10:00"),
        "bottles": ("2026-11-28 Sat 10:00", "2026-12-19 Sat 10:00"),
        "bin": ("2026-12-05 Sat 10:00", "2026-12-26 Sat 10:00"),
    }


@pytest.mark.parametrize(
    ("schedule", "expected"),
    [
        (
            {"type": "calendar", "every": 2, "unit": "weeks", "weekdays": ["tue"],
             "at": "19:00", "starting": "2026-11-03"},
            ["2026-11-17 Tue 19:00", "2026-12-01 Tue 19:00"],
        ),
        (
            {"type": "calendar", "every": 1, "unit": "years", "month": 4,
             "day_of_month": 5, "at": "09:00"},
            ["2027-04-05 Mon 09:00", "2028-04-05 Wed 09:00"],
        ),
        (
            {"type": "calendar", "every": 3, "unit": "months", "day_of_month": 1,
             "at": "10:00", "starting": "2026-12-01"},
            ["2026-12-01 Tue 10:00", "2027-03-01 Mon 10:00"],
        ),
        (
            {"type": "calendar", "every": 1, "unit": "months",
             "day_of_month": "last", "at": "20:00"},
            ["2026-11-30 Mon 20:00", "2026-12-31 Thu 20:00"],
        ),
        (
            {"type": "calendar", "every": 1, "unit": "months", "day_of_month": 31,
             "at": "08:00", "starting": "2027-01-31"},
            ["2027-01-31 Sun 08:00", "2027-02-28 Sun 08:00"],
        ),
        (
            {"type": "calendar", "every": 2, "unit": "days", "at": "07:00",
             "starting": "2026-11-15"},
            ["2026-11-17 Tue 07:00", "2026-11-19 Thu 07:00"],
        ),
    ],
)  # fmt: skip
def test_calendar_due_times(
    budapest: None, schedule: dict[str, Any], expected: list[str]
) -> None:
    """Weeks, months, years and days are counted from the starting date."""
    first = sched.calendar_after(
        schedule, schedule["every"], _local("2026-11-16 09:00")
    )
    assert first is not None
    second = sched.calendar_after(schedule, schedule["every"], first)
    assert [_fmt(first), _fmt(second)] == expected


def test_daylight_saving(budapest: None) -> None:
    """A step at 10:00 stays at 10:00 across both daylight saving changes."""
    schedule = {"type": "calendar", "every": 1, "unit": "days", "at": "10:00"}
    when: datetime | None = _local("2026-03-28 12:00")
    days = []
    for _ in range(2):
        assert when is not None
        when = sched.calendar_after(schedule, 1, when)
        assert when is not None
        days.append(dt_util.as_local(when).isoformat())
    assert days == ["2026-03-29T10:00:00+02:00", "2026-03-30T10:00:00+02:00"]
    when = sched.calendar_after(schedule, 1, _local("2026-10-24 12:00"))
    assert when is not None
    assert dt_util.as_local(when).isoformat() == "2026-10-25T10:00:00+01:00"
    # 02:30 does not exist on the spring forward day: it comes an hour later.
    night = {"type": "calendar", "every": 1, "unit": "days", "at": "02:30"}
    when = sched.calendar_after(night, 1, _local("2026-03-28 12:00"))
    assert when is not None
    assert dt_util.as_local(when).isoformat() == "2026-03-29T03:30:00+02:00"


def test_after_last_done(budapest: None) -> None:
    """N days after it was done, at the time; never done: at the next time."""
    schedule = {"type": "after_last_done", "every": 3, "unit": "days", "at": "22:00"}
    now = _local("2026-11-16 09:00")
    assert _fmt(sched.after_last_done_due(schedule, 3, None, None, now)) == (
        "2026-11-16 Mon 22:00"
    )
    done = _local("2026-11-14 23:30")
    due = sched.after_last_done_due(schedule, 3, done, None, now)
    assert _fmt(due) == "2026-11-17 Tue 22:00"
    # Due but not done (expired or dismissed): again the next day.
    assert _fmt(sched.after_last_done_due(schedule, 3, done, due, now)) == (
        "2026-11-18 Wed 22:00"
    )
    no_time = {"type": "after_last_done", "every": 1, "unit": "months"}
    assert _fmt(sched.after_last_done_due(no_time, 1, done, None, now)) == (
        "2026-12-14 Mon 23:30"
    )


# -- The engine ------------------------------------------------------------------


async def test_calendar_step_upcoming_active_expired(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    budapest: None,
) -> None:
    """A weekly step is idle, upcoming on the day, active, then expired."""
    center = await load(hass, config_entry)
    await center.add("Mixed waste", _scheduled(WEEKLY_WASTE))
    assert center.state("sensor.nc_mixed_waste") == "idle"
    assert _fmt(center.attrs("sensor.nc_mixed_waste")["next_due"]) == (
        "2026-11-18 Wed 19:00"
    )

    await _move(hass, freezer, "2026-11-18 00:00")
    assert center.state("sensor.nc_mixed_waste") == "upcoming"

    await _move(hass, freezer, "2026-11-18 19:00")
    assert center.state("sensor.nc_mixed_waste") == "active"
    assert center.events[-1][1]["source"] == "schedule"
    assert _fmt(center.attrs("sensor.nc_mixed_waste")["active_since"]) == (
        "2026-11-18 Wed 19:00"
    )
    assert _fmt(center.attrs("sensor.nc_mixed_waste")["next_due"]) == (
        "2026-11-25 Wed 19:00"
    )

    await _move(hass, freezer, "2026-11-19 09:00")
    assert center.state("sensor.nc_mixed_waste") == "idle"
    assert center.kinds() == ["active", "expired"]
    assert center.attrs("sensor.nc_mixed_waste")["last_done"] is None


async def test_scheduled_card_waits_for_conditions(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    budapest: None,
) -> None:
    """A due card is hidden while the Start conditions are not true."""
    center = await load(hass, config_entry)
    await center.set("sensor.rain_today", "10")
    await center.add(
        "Watering",
        _scheduled(
            {"type": "calendar", "every": 1, "unit": "days", "at": "22:00"},
            conditions=[
                {"condition": "numeric_state", "entity_id": "sensor.rain_today",
                 "below": 5}
            ],
        ),
    )  # fmt: skip
    await _move(hass, freezer, "2026-11-16 22:00")
    assert center.state("sensor.nc_watering") == "hidden"
    await center.set("sensor.rain_today", "1")
    assert center.state("sensor.nc_watering") == "active"


async def test_after_last_donestep(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    budapest: None,
) -> None:
    """Done moves the next due time; N can come from an entity."""
    center = await load(hass, config_entry)
    await center.set("input_number.interval", "3")
    await center.add(
        "Watering",
        _scheduled(
            {"type": "after_last_done", "every": "input_number.interval",
             "unit": "days", "at": "22:00", "expires": {"hours": 6}},
        ),
    )  # fmt: skip
    assert _fmt(center.attrs("sensor.nc_watering")["next_due"]) == (
        "2026-11-16 Mon 22:00"
    )
    assert center.state("sensor.nc_watering") == "upcoming"

    await _move(hass, freezer, "2026-11-16 22:00")
    assert center.state("sensor.nc_watering") == "active"
    await center.call("done", "sensor.nc_watering")
    assert _fmt(center.attrs("sensor.nc_watering")["next_due"]) == (
        "2026-11-19 Thu 22:00"
    )

    await center.set("input_number.interval", "5")
    assert _fmt(center.attrs("sensor.nc_watering")["next_due"]) == (
        "2026-11-21 Sat 22:00"
    )
    await center.set("input_number.interval", "0")
    assert center.attrs("sensor.nc_watering")["next_due"] is None
    await center.set("input_number.interval", "1")

    # Not done: it expires, and it is due again the next evening.
    await _move(hass, freezer, "2026-11-17 22:00")
    assert center.state("sensor.nc_watering") == "active"
    await _move(hass, freezer, "2026-11-18 04:00")
    assert center.events[-1][0] == "expired"
    assert _fmt(center.attrs("sensor.nc_watering")["next_due"]) == (
        "2026-11-18 Wed 22:00"
    )


async def test_missed_while_stopped(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    budapest: None,
) -> None:
    """An occurrence that fell while stopped shows after the start."""
    center = await load(hass, config_entry)
    await center.add("Mixed waste", _scheduled(WEEKLY_WASTE))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    freezer.move_to(_local("2026-11-18 20:00"))
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    center = Center(hass, config_entry)
    assert center.state("sensor.nc_mixed_waste") == "active"
    assert _fmt(center.attrs("sensor.nc_mixed_waste")["active_since"]) == (
        "2026-11-18 Wed 19:00"
    )

    # Restarting again does not open it a second time.
    await center.call("done", "sensor.nc_mixed_waste")
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert Center(hass, config_entry).state("sensor.nc_mixed_waste") == "done"

    # An occurrence that already expired while stopped does not show.
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    freezer.move_to(_local("2026-11-26 10:00"))
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert Center(hass, config_entry).state("sensor.nc_mixed_waste") == "idle"


async def test_expiry_survives_a_restart(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    budapest: None,
) -> None:
    """A snoozed scheduled card still expires at its time after a restart."""
    center = await load(hass, config_entry)
    await center.add("Mixed waste", _scheduled(WEEKLY_WASTE))
    await _move(hass, freezer, "2026-11-18 19:00")
    await center.call("snooze", "sensor.nc_mixed_waste")
    until = center.attrs("sensor.nc_mixed_waste")["snoozed_until"]
    # Tomorrow at the time it appeared today.
    assert _fmt(until) == "2026-11-19 Thu 19:00"

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    center = Center(hass, config_entry)
    await _move(hass, freezer, "2026-11-19 09:00")
    assert center.state("sensor.nc_mixed_waste") == "idle"
    assert center.kinds() == ["expired"]


async def test_calendar_entity(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    budapest: None,
) -> None:
    """The calendar lists the occurrences as all-day events on the due day."""
    center = await load(hass, config_entry)
    await center.add("Mixed waste", _scheduled(WEEKLY_WASTE, message="Put it out"))
    await center.add(
        "Filter",
        _scheduled({"type": "after_last_done", "every": 1, "unit": "months"}),
    )
    state = hass.states.get("calendar.notification_center")
    assert state is not None
    assert state.attributes["message"] in ("Mixed waste", "Filter")

    result = await hass.services.async_call(
        "calendar",
        "get_events",
        {
            "entity_id": "calendar.notification_center",
            "start_date_time": _local("2026-11-16 00:00").isoformat(),
            "end_date_time": _local("2026-12-01 00:00").isoformat(),
        },
        blocking=True,
        return_response=True,
    )
    assert result is not None
    response: Any = result
    events: list[dict[str, Any]] = response["calendar.notification_center"]["events"]
    waste = [event for event in events if event["summary"] == "Mixed waste"]
    assert [event["start"] for event in waste] == ["2026-11-18", "2026-11-25"]
    assert waste[0]["end"] == "2026-11-19"
    assert waste[0]["description"] == "Put it out"
    filters = [event for event in events if event["summary"] == "Filter"]
    # Never done: due now, so the card is open and the next one is tomorrow.
    assert [event["start"] for event in filters] == ["2026-11-17"]


async def test_example_config_runs_for_a_week(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    budapest: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The example notifications run hour by hour for a week without errors."""
    center = await load(hass, config_entry)
    text = (Path(__file__).parent / "fixtures" / "example_config.yaml").read_text()
    await center.manager.async_import_yaml(text)
    await hass.async_block_till_done()
    seen: set[str] = set()
    for _ in range(8 * 24):
        freezer.tick(timedelta(hours=1))
        async_fire_time_changed(hass, dt_util.utcnow())
        await hass.async_block_till_done()
        seen |= {
            state.entity_id
            for state in hass.states.async_all("sensor")
            if state.entity_id.startswith("sensor.nc_") and state.state == "active"
        }
    assert {"sensor.nc_mixed_waste", "sensor.nc_recycling"} <= seen
    assert not [
        record
        for record in caplog.records
        if record.levelname in ("ERROR", "CRITICAL")
        and record.name.startswith("custom_components")
    ]
