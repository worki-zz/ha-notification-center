"""Websocket commands of Notification Center.

Every user can read the configuration, follow it and the live state of the
cards, and act on a card (Done, Snooze, Dismiss); only administrators can
change the configuration.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, time
from functools import wraps
from typing import Any, Final

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .const import CLOSED_DISMISSED, CLOSED_DONE, DOMAIN, SOURCE_BUTTON
from .engine import async_get_engine
from .model import COLLECTIONS, SCHEDULE_SCHEMA, ConfigData, ConfigValidationError
from .render import render_text
from .schedule import (
    SCHEDULE_CALENDAR,
    add_units,
    after_last_done_due,
    calendar_after,
    every,
)
from .store import ConfigManager, async_people_view

ERR_INVALID: Final = "invalid_config"

CARD_DONE: Final = "done"
CARD_DISMISS: Final = "dismiss"
CARD_SNOOZE: Final = "snooze"
# Keep the card, stop its channels: a button with "Keep it silently".
CARD_SILENCE: Final = "silence"
CARD_ACTIONS: Final = (CARD_DONE, CARD_DISMISS, CARD_SNOOZE, CARD_SILENCE)

type Handler = Callable[
    [HomeAssistant, websocket_api.ActiveConnection, dict[str, Any], ConfigManager],
    Awaitable[None],
]


def _manager(hass: HomeAssistant) -> ConfigManager | None:
    manager: ConfigManager | None = hass.data.get(DOMAIN)
    return manager


def _with_manager(
    handler: Handler,
) -> websocket_api.AsyncWebSocketCommandHandler:
    """Pass the manager to the handler, and turn errors into messages."""

    @wraps(handler)
    async def wrapper(
        hass: HomeAssistant,
        connection: websocket_api.ActiveConnection,
        msg: dict[str, Any],
    ) -> None:
        manager = _manager(hass)
        if manager is None:
            connection.send_error(
                msg["id"], "not_loaded", "Notification Center is not loaded"
            )
            return
        try:
            await handler(hass, connection, msg, manager)
        except ConfigValidationError as err:
            connection.send_error(msg["id"], ERR_INVALID, str(err))

    return wrapper


def _view(hass: HomeAssistant, config: ConfigData) -> dict[str, Any]:
    """Return the configuration as the frontend sees it."""
    return {**config, "people": async_people_view(hass, config)}


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the websocket commands."""
    for command in (
        ws_get,
        ws_subscribe,
        ws_create,
        ws_update,
        ws_delete,
        ws_reorder,
        ws_duplicate,
        ws_set_enabled,
        ws_update_person,
        ws_update_general,
        ws_export,
        ws_import,
        ws_state_subscribe,
        ws_card_action,
        ws_card_press,
        ws_step_done_early,
        ws_schedule_preview,
        ws_step_set_next,
        ws_text_preview,
    ):
        websocket_api.async_register_command(hass, command)


_SECTION = vol.In(COLLECTIONS)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/get"})
@websocket_api.async_response
@_with_manager
async def ws_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Return the whole configuration."""
    connection.send_result(
        msg["id"], {"config": _view(hass, manager.config), "has_data": manager.has_data}
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/subscribe"})
@websocket_api.async_response
@_with_manager
async def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Send the configuration now and after every change."""

    @callback
    def send(config: ConfigData) -> None:
        connection.send_message(
            websocket_api.event_message(
                msg["id"], {"config": _view(hass, config), "has_data": manager.has_data}
            )
        )

    connection.subscriptions[msg["id"]] = manager.async_add_listener(send)
    connection.send_result(msg["id"])
    send(manager.config)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/item/create",
        vol.Required("section"): _SECTION,
        vol.Required("data"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_create(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Add an item to a collection."""
    item = await manager.async_create(msg["section"], msg["data"])
    connection.send_result(msg["id"], item)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/item/update",
        vol.Required("section"): _SECTION,
        vol.Required("item_id"): str,
        vol.Required("data"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_update(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Replace an item of a collection."""
    item = await manager.async_update(msg["section"], msg["item_id"], msg["data"])
    connection.send_result(msg["id"], item)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/item/delete",
        vol.Required("section"): _SECTION,
        vol.Required("item_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Delete an item of a collection."""
    await manager.async_delete(msg["section"], msg["item_id"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/item/reorder",
        vol.Required("section"): _SECTION,
        vol.Required("item_ids"): [str],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_reorder(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Put the items of a collection in a new order."""
    await manager.async_reorder(msg["section"], msg["item_ids"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/notification/duplicate",
        vol.Required("notification_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_duplicate(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Copy a notification."""
    item = await manager.async_duplicate(msg["notification_id"])
    connection.send_result(msg["id"], item)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/notification/set_enabled",
        vol.Required("notification_id"): str,
        vol.Optional("step_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_set_enabled(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Switch a notification or one of its steps on or off."""
    await manager.async_set_enabled(
        msg["notification_id"], msg["enabled"], msg.get("step_id")
    )
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/person/update", vol.Required("data"): dict}
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_update_person(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Save the settings of a person."""
    await manager.async_update_person(msg["data"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/general/update", vol.Required("data"): dict}
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_update_general(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Save the general settings."""
    await manager.async_update_general(msg["data"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/export"})
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_export(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Return the whole configuration as YAML."""
    connection.send_result(msg["id"], {"yaml": manager.export_yaml()})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/config/import", vol.Required("yaml"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
@_with_manager
async def ws_import(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    manager: ConfigManager,
) -> None:
    """Replace the whole configuration with an imported YAML."""
    await manager.async_import_yaml(msg["yaml"])
    connection.send_result(msg["id"])


# -- Live state ---------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/state/subscribe"})
@callback
def ws_state_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the cards and states now and after every change."""
    engine = async_get_engine(hass)
    if engine is None:
        connection.send_error(
            msg["id"], "not_loaded", "Notification Center is not loaded"
        )
        return

    @callback
    def send() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], engine.snapshot())
        )

    connection.subscriptions[msg["id"]] = engine.async_add_listener(send)
    connection.send_result(msg["id"])
    send()


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/card/action",
        vol.Required("notification_id"): str,
        vol.Required("step_id"): str,
        vol.Optional("entity_id"): vol.Any(None, str),
        vol.Required("action"): vol.In(CARD_ACTIONS),
        vol.Optional("until"): str,
    }
)
@callback
def ws_card_action(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Mark a card done, dismiss, snooze or silence it (any user)."""
    engine = async_get_engine(hass)
    if engine is None:
        connection.send_error(
            msg["id"], "not_loaded", "Notification Center is not loaded"
        )
        return
    cards = [
        card
        for card in engine.select(msg["notification_id"], msg["step_id"], None)
        if card.entity_id == msg.get("entity_id")
    ]
    if not cards:
        connection.send_error(msg["id"], "not_found", "The card is not open")
        return
    context = connection.context(msg)
    action = msg["action"]
    if action == CARD_DONE:
        engine.close_cards(cards, CLOSED_DONE, SOURCE_BUTTON, context)
    elif action == CARD_DISMISS:
        engine.close_cards(cards, CLOSED_DISMISSED, SOURCE_BUTTON, context)
    elif action == CARD_SILENCE:
        engine.silence_cards(cards, SOURCE_BUTTON, context)
    else:
        until = dt_util.parse_datetime(msg["until"]) if msg.get("until") else None
        if msg.get("until") and until is None:
            connection.send_error(msg["id"], ERR_INVALID, "until is not a time")
            return
        engine.snooze_cards(cards, until, SOURCE_BUTTON, context)
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/card/press",
        vol.Required("notification_id"): str,
        vol.Required("step_id"): str,
        vol.Optional("entity_id"): vol.Any(None, str),
        vol.Required("button_id"): str,
        # A snooze time the user chose; left out, the button's own is used.
        vol.Optional("until"): str,
        # One of the Snooze button's times, which Home Assistant works out.
        vol.Optional("choice"): str,
    }
)
@websocket_api.async_response
async def ws_card_press(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Press a button of a card (any user)."""
    engine = async_get_engine(hass)
    if engine is None:
        connection.send_error(
            msg["id"], "not_loaded", "Notification Center is not loaded"
        )
        return
    card = next(
        (
            card
            for card in engine.select(msg["notification_id"], msg["step_id"], None)
            if card.entity_id == msg.get("entity_id")
        ),
        None,
    )
    if card is None:
        connection.send_error(msg["id"], "not_found", "The card is not open")
        return
    until = None
    if msg.get("until"):
        until = dt_util.parse_datetime(msg["until"])
        if until is None:
            connection.send_error(msg["id"], ERR_INVALID, "until is not a time")
            return
    try:
        await engine.async_press(
            card,
            msg["button_id"],
            until,
            connection.context(msg),
            choice=msg.get("choice"),
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], ERR_INVALID, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/step/done_early",
        vol.Required("notification_id"): str,
        vol.Required("step_id"): str,
    }
)
@callback
def ws_step_done_early(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Mark a scheduled step done before it is due (any user)."""
    engine = async_get_engine(hass)
    if engine is None:
        connection.send_error(
            msg["id"], "not_loaded", "Notification Center is not loaded"
        )
        return
    try:
        engine.done_early(
            msg["notification_id"], msg["step_id"], connection.context(msg)
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], ERR_INVALID, str(err))
        return
    connection.send_result(msg["id"])


_PREVIEW_COUNT: Final = 3


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/schedule/preview",
        vol.Required("schedule"): dict,
        vol.Optional("notification_id"): str,
        vol.Optional("step_id"): str,
        vol.Optional("count", default=_PREVIEW_COUNT): vol.All(int, vol.Range(1, 10)),
    }
)
@callback
def ws_schedule_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the next times of a schedule being edited.

    A calendar schedule gives its next occurrences. An after-last-done one
    gives only the next, counted from the step's last done (or from now, for
    a step that is not saved yet), and the last done itself.
    """
    try:
        schedule = SCHEDULE_SCHEMA(msg["schedule"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], ERR_INVALID, str(err))
        return
    now = dt_util.utcnow()
    n = every(hass, schedule)
    times: list[str] = []
    last_done = None
    if n > 0 and schedule["type"] == SCHEDULE_CALENDAR:
        after = now
        for _ in range(msg["count"]):
            due = calendar_after(schedule, n, after)
            if due is None:
                break
            times.append(due.isoformat())
            after = due
    elif n > 0:
        engine = async_get_engine(hass)
        if engine is not None and "notification_id" in msg and "step_id" in msg:
            last_done = engine.last_reached(
                msg["notification_id"], msg["step_id"], CLOSED_DONE
            )
        due = after_last_done_due(schedule, n, last_done or now, None, now)
        times.append(due.isoformat())
    connection.send_result(
        msg["id"],
        {
            "next": times,
            "every": n,
            "last_done": last_done.isoformat() if last_done else None,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/step/set_next",
        vol.Required("notification_id"): str,
        vol.Required("step_id"): str,
        vol.Required("next"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_step_set_next(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Set when an after-last-done step is next due.

    It is stored as its last done: the next time minus the interval. With
    an At time only the date of the next time counts.
    """
    engine = async_get_engine(hass)
    if engine is None:
        connection.send_error(
            msg["id"], "not_loaded", "Notification Center is not loaded"
        )
        return
    notification = engine.notification_config(msg["notification_id"]) or {}
    step = next(
        (
            item
            for item in notification.get("steps", [])
            if item["id"] == msg["step_id"]
        ),
        None,
    )
    start = (step or {}).get("start", {})
    schedule = start.get("schedule") if start.get("type") == "schedule" else None
    if step is None or schedule is None or schedule["type"] == SCHEDULE_CALENDAR:
        connection.send_error(
            msg["id"], ERR_INVALID, "the step does not repeat after it is done"
        )
        return
    wanted = dt_util.parse_datetime(msg["next"])
    if wanted is None:
        wanted_date = dt_util.parse_date(msg["next"])
        if wanted_date is None:
            connection.send_error(msg["id"], ERR_INVALID, "not a date or time")
            return
        wanted = datetime.combine(
            wanted_date, time(12), tzinfo=dt_util.get_default_time_zone()
        )
    local = dt_util.as_local(wanted)
    n = max(every(hass, schedule), 1)
    day = add_units(local.date(), -n, schedule["unit"])
    at = dt_util.parse_time(schedule["at"]) if schedule.get("at") else local.timetz()
    if at is None:
        at = local.timetz()
    last_done = datetime.combine(
        day, at.replace(tzinfo=None), tzinfo=dt_util.get_default_time_zone()
    )
    engine.set_last_done(msg["notification_id"], msg["step_id"], last_done)
    connection.send_result(msg["id"], {"last_done": last_done.isoformat()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/text/preview",
        vol.Required("texts"): [vol.Any(str, None)],
        vol.Optional("entity_id"): vol.Any(str, None),
        vol.Optional("notification_id"): vol.Any(str, None),
    }
)
@callback
def ws_text_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Render texts of a step being edited, for an entity of the list."""
    entity_id = msg.get("entity_id")
    variables = {
        "entity": entity_id,
        "trigger": {"entity_id": entity_id} if entity_id else {},
        "data": {},
        "notification": {"id": msg.get("notification_id")},
    }
    results = []
    for text in msg["texts"]:
        rendered, error = render_text(hass, text, variables, entity_id)
        results.append({"text": rendered, "error": error})
    connection.send_result(msg["id"], results)
