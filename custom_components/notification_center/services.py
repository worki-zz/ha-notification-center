"""The actions of Notification Center.

Every action targets the sensors of notifications (``sensor.nc_...``). The
step is given by its number (1 is the first) and, for a Listed entities
step, the card by its entity.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.service import async_extract_entity_ids
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .cards import Overrides
from .const import (
    CLOSED_DISMISSED,
    CLOSED_DONE,
    DOMAIN,
    SERVICE_CLEAR,
    SERVICE_DONE,
    SERVICE_SET_LAST_DONE,
    SERVICE_SNOOZE,
    SERVICE_TRIGGER,
    SOURCE_ACTION,
)
from .engine import Engine, async_get_engine
from .push import person_of_user

_STEP = vol.All(vol.Coerce(int), vol.Range(min=1))

_COMMON = {
    vol.Optional("step", default=1): _STEP,
    vol.Optional("entity"): cv.entity_id,
}

TRIGGER_SCHEMA = cv.make_entity_service_schema(
    {
        **_COMMON,
        vol.Optional("message"): cv.string,
        vol.Optional("info"): cv.string,
        vol.Optional("data"): dict,
        vol.Optional("only_me"): cv.boolean,
    }
)
CLOSE_SCHEMA = cv.make_entity_service_schema(_COMMON)
SNOOZE_SCHEMA = cv.make_entity_service_schema(
    {
        **_COMMON,
        vol.Exclusive("duration", "until"): cv.positive_time_period,
        vol.Exclusive("until", "until"): cv.datetime,
    }
)
SET_LAST_DONE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("step", default=1): _STEP,
        vol.Optional("datetime"): cv.datetime,
    }
)


def _engine(hass: HomeAssistant) -> Engine:
    if (engine := async_get_engine(hass)) is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="not_loaded"
        )
    return engine


async def _targets(
    hass: HomeAssistant, call: ServiceCall
) -> list[tuple[Engine, str, str]]:
    """Return the engine, notification id and step id of every target."""
    engine = _engine(hass)
    entity_ids = await async_extract_entity_ids(call)
    if not entity_ids:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_target"
        )
    result = []
    for entity_id in sorted(entity_ids):
        notification_id = engine.resolve_notification(entity_id)
        if notification_id is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_a_notification",
                translation_placeholders={"entity_id": entity_id},
            )
        step_id = engine.step_id_of(notification_id, call.data["step"])
        result.append((engine, notification_id, step_id))
    return result


def _when(value: datetime) -> datetime:
    """Return a time from an action in UTC; a naive one is local time."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt_util.get_default_time_zone())
    return dt_util.as_utc(value)


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the actions."""

    async def trigger(call: ServiceCall) -> None:
        only_people: list[str] | None = None
        if call.data.get("only_me"):
            person = person_of_user(hass, call.context.user_id)
            if person is None:
                raise ServiceValidationError("Your user is not a person.")
            only_people = [person]
        overrides = Overrides(
            message=call.data.get("message"),
            info=call.data.get("info"),
            data=call.data.get("data"),
            only_people=only_people,
        )
        for engine, notification_id, step_id in await _targets(hass, call):
            engine.trigger(
                notification_id,
                step_id,
                call.data.get("entity"),
                overrides,
                call.context,
            )

    async def done(call: ServiceCall) -> None:
        for engine, notification_id, step_id in await _targets(hass, call):
            cards = engine.select(notification_id, step_id, call.data.get("entity"))
            if cards:
                engine.close_cards(cards, CLOSED_DONE, SOURCE_ACTION, call.context)
            elif engine.has_schedule(notification_id, step_id):
                # Nothing is open: as the Done button of Upcoming.
                engine.done_early(notification_id, step_id, call.context)
            else:
                # Nothing is open: the task was done anyway, so it counts.
                engine.set_last_done(notification_id, step_id, dt_util.utcnow())

    async def clear(call: ServiceCall) -> None:
        for engine, notification_id, step_id in await _targets(hass, call):
            cards = engine.select(notification_id, step_id, call.data.get("entity"))
            if cards:
                engine.close_cards(cards, CLOSED_DISMISSED, SOURCE_ACTION, call.context)
            elif engine.has_schedule(notification_id, step_id):
                # Nothing is open: as the Dismiss button of Upcoming.
                engine.dismiss_early(notification_id, step_id, call.context)

    async def snooze(call: ServiceCall) -> None:
        until: datetime | None = None
        if (duration := call.data.get("duration")) is not None:
            until = dt_util.utcnow() + timedelta(seconds=duration.total_seconds())
        elif (value := call.data.get("until")) is not None:
            until = _when(value)
        for engine, notification_id, step_id in await _targets(hass, call):
            engine.snooze_cards(
                engine.select(notification_id, step_id, call.data.get("entity")),
                until,
                SOURCE_ACTION,
                call.context,
            )

    async def set_last_done(call: ServiceCall) -> None:
        value = call.data.get("datetime")
        when = _when(value) if value is not None else dt_util.utcnow()
        for engine, notification_id, step_id in await _targets(hass, call):
            engine.set_last_done(notification_id, step_id, when)

    handlers: list[tuple[str, Any, Any]] = [
        (SERVICE_TRIGGER, trigger, TRIGGER_SCHEMA),
        (SERVICE_DONE, done, CLOSE_SCHEMA),
        (SERVICE_CLEAR, clear, CLOSE_SCHEMA),
        (SERVICE_SNOOZE, snooze, SNOOZE_SCHEMA),
        (SERVICE_SET_LAST_DONE, set_last_done, SET_LAST_DONE_SCHEMA),
    ]
    for name, handler, schema in handlers:
        hass.services.async_register(DOMAIN, name, handler, schema=schema)
