"""Websocket commands of Notification Center.

Every user can read the configuration, follow it and the live state of the
cards, and act on a card (Done, Snooze, Dismiss); only administrators can
change the configuration.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, Final

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .const import CLOSED_DISMISSED, CLOSED_DONE, DOMAIN, SOURCE_BUTTON
from .engine import async_get_engine
from .model import COLLECTIONS, ConfigData, ConfigValidationError
from .store import ConfigManager, async_people_view

ERR_INVALID: Final = "invalid_config"

CARD_DONE: Final = "done"
CARD_DISMISS: Final = "dismiss"
CARD_SNOOZE: Final = "snooze"
CARD_ACTIONS: Final = (CARD_DONE, CARD_DISMISS, CARD_SNOOZE)

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
    """Mark a card done, dismiss it or snooze it (any user)."""
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
    else:
        until = dt_util.parse_datetime(msg["until"]) if msg.get("until") else None
        if msg.get("until") and until is None:
            connection.send_error(msg["id"], ERR_INVALID, "until is not a time")
            return
        engine.snooze_cards(cards, until, SOURCE_BUTTON, context)
    connection.send_result(msg["id"])
