"""The configuration schema of Notification Center.

The whole configuration is one dictionary with these sections:
``general``, ``modes``, ``people``, ``lights``, ``speakers``, ``chimes``,
``categories`` and ``notifications``. Field names follow the labels of the
user interface in ``snake_case``. The same structure is stored, sent over the
websocket API and used for YAML import and export.

Validation runs in two passes. ``CONFIG_SCHEMA`` checks the structure and
fills in defaults. ``async_validate_config`` then checks the Home Assistant
triggers and conditions inside the steps, and the references between
sections (a notification's category, a channel's mode, and so on).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, Final, cast

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.condition import async_validate_conditions_config
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.trigger import async_validate_trigger_config
from homeassistant.util.ulid import ulid_now
import voluptuous as vol

from .const import DEFAULT_SNOOZE_TOMORROW_AT, DOMAIN

type ConfigData = dict[str, Any]

SECTIONS: Final = (
    "general",
    "modes",
    "people",
    "lights",
    "speakers",
    "chimes",
    "categories",
    "notifications",
)

# Sections that are ordered lists of items with an ``id``.
COLLECTIONS: Final = (
    "modes",
    "lights",
    "speakers",
    "chimes",
    "categories",
    "notifications",
)

HOME_MODE_ID: Final = "home"
GENERAL_CATEGORY_ID: Final = "general"

# Channel keys: the Notification center and Push are single channels, every
# light and speaker is its own channel, keyed by its id.
CHANNEL_NOTIFICATION_CENTER: Final = "notification_center"
CHANNEL_PUSH: Final = "push"
CHANNEL_LIGHT_PREFIX: Final = "light:"
CHANNEL_SPEAKER_PREFIX: Final = "speaker:"

BUILTIN_BUTTONS: Final = ("tap", "done", "snooze", "dismiss")
BUTTON_TYPES: Final = (*BUILTIN_BUTTONS, "custom")
CARD_EFFECTS: Final = ("done", "snooze", "dismiss", "keep", "keep_silent")
WEEKDAYS: Final = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
INTERVAL_UNITS: Final = ("days", "weeks", "months", "years")

# Triggers and conditions of the integration itself. Their full behaviour
# comes with the engine; the schema is checked here already.
TRIGGER_LISTED_ENTITIES: Final = f"{DOMAIN}.listed_entities"
TRIGGER_NOTIFICATION_STATE: Final = f"{DOMAIN}.notification_state"
NOTIFICATION_STATES: Final = ("active", "done", "snoozed", "dismissed")
# Earlier name of a state, accepted and changed to the new one.
_RENAMED_STATES: Final = {"shown": "active"}


class ConfigValidationError(HomeAssistantError):
    """The configuration is not valid."""


def new_id() -> str:
    """Return a new, unique item id."""
    return ulid_now().lower()


# ---------------------------------------------------------------------------
# Small building blocks


def _rgb(value: Any) -> list[int]:
    """Validate an RGB colour given as three numbers from 0 to 255."""
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise vol.Invalid("expected three numbers: red, green, blue")
    return [vol.All(vol.Coerce(int), vol.Range(0, 255))(part) for part in value]


def _optional(validator: Callable[[Any], Any]) -> Callable[[Any], Any]:
    """Accept None, or a value the validator accepts (keeping its message)."""

    def validate(value: Any) -> Any:
        return None if value is None else validator(value)

    return validate


def _id(value: Any) -> str:
    """Validate an item id: a non-empty string without spaces."""
    text = cv.string(value).strip()
    if not text or " " in text:
        raise vol.Invalid("an id is a non-empty text without spaces")
    return text


def _with_id(schema: dict[Any, Any]) -> vol.Schema:
    """Return a schema for a list item that gets a new id when it has none."""
    return vol.Schema({vol.Optional("id", default=new_id): _id, **schema})


def _non_negative_or_entity(value: Any) -> int | str:
    """Validate a number of at least 0, or an entity that holds the number."""
    if isinstance(value, str) and "." in value:
        return cv.entity_id(value)
    return cast(int, vol.All(vol.Coerce(int), vol.Range(min=0))(value))


_DURATION_UNITS: Final = ("days", "hours", "minutes", "seconds")


def DURATION(value: Any) -> dict[str, int]:  # noqa: N802 - used like a schema
    """Validate a duration such as ``{hours: 1, minutes: 30}`` or ``"01:30:00"``.

    It is kept as a mapping of whole units, so that it stores as JSON and
    exports as readable YAML.
    """
    period = cv.positive_time_period(value)
    seconds = int(period.total_seconds())
    if seconds <= 0:
        raise vol.Invalid("a duration must be longer than zero")
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, seconds = divmod(rest, 60)
    parts = dict(zip(_DURATION_UNITS, (days, hours, minutes, seconds), strict=True))
    return {unit: amount for unit, amount in parts.items() if amount}


def _time(value: Any) -> str:
    """Validate a time of day and keep it as ``HH:MM`` or ``HH:MM:SS``."""
    parsed = cv.time(value)
    return parsed.strftime("%H:%M:%S" if parsed.second else "%H:%M")


def _date(value: Any) -> str:
    """Validate a date and keep it as ``YYYY-MM-DD``."""
    return cv.date(value).isoformat()


DURATION_OR_ASK = vol.Any("ask", DURATION)

ACTIONS = vol.All(cv.ensure_list, [dict])
TRIGGERS = vol.All(cv.ensure_list, [dict])
CONDITIONS = vol.All(cv.ensure_list, [dict])

MEDIA = vol.Schema(
    {
        vol.Required("media_content_id"): cv.string,
        vol.Required("media_content_type"): cv.string,
        vol.Optional("metadata"): dict,
    },
    extra=vol.ALLOW_EXTRA,
)

# ---------------------------------------------------------------------------
# General settings, modes, people and devices

GENERAL_SCHEMA = vol.Schema(
    {
        # When a card snoozed until "Tomorrow" comes back, unless its step is
        # scheduled (then it comes back at the time it appeared).
        vol.Optional("snooze_tomorrow_at", default=DEFAULT_SNOOZE_TOMORROW_AT): _time,
        vol.Optional("read_the_message", default=dict): vol.Schema(
            {
                vol.Optional("tts_service"): _optional(cv.entity_id),
                vol.Optional("language"): _optional(cv.string),
                vol.Optional("volume"): vol.Any(
                    None, vol.All(vol.Coerce(float), vol.Range(0, 1))
                ),
            }
        ),
    }
)

MODE_CONDITION_SCHEMA = vol.Any(
    vol.Schema(
        {vol.Required("type"): "toggle", vol.Required("entity_id"): cv.entity_id}
    ),
    vol.Schema(
        {
            vol.Required("type"): "state",
            vol.Required("entity_id"): cv.entity_id,
            vol.Required("state"): cv.string,
        }
    ),
    vol.Schema(
        {vol.Required("type"): "template", vol.Required("value_template"): cv.string}
    ),
)

MODE_SCHEMA = _with_id(
    {
        vol.Required("name"): cv.string,
        vol.Optional("icon"): _optional(cv.icon),
        # The Home mode has no condition: it applies when no other mode does.
        vol.Optional("condition"): _optional(MODE_CONDITION_SCHEMA),
    }
)

PERSON_SCHEMA = vol.Schema(
    {
        vol.Required("person"): cv.entity_domain("person"),
        vol.Optional("notify"): _optional(cv.string),
        vol.Optional("device_type", default="other"): vol.In(
            ("ios", "android", "other")
        ),
        vol.Optional("sleep_entity"): _optional(cv.entity_id),
    }
)

LIGHT_SCHEMA = _with_id(
    {
        vol.Required("entity_id"): cv.entity_domain("light"),
        vol.Optional("transition"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(min=0))
        ),
        vol.Optional("brightness"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(0, 100))
        ),
        vol.Optional("illuminance_sensor"): _optional(cv.entity_id),
        vol.Optional("dim_below"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(min=0))
        ),
        vol.Optional("dim_brightness"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(0, 100))
        ),
        vol.Optional("highlight_effect", default="none"): vol.In(
            ("none", "flash", "glow", "pulse")
        ),
    }
)

SPEAKER_SCHEMA = _with_id(
    {
        vol.Required("entity_id"): cv.entity_domain("media_player"),
        vol.Optional("volume"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(0, 1))
        ),
        vol.Optional("resume_playback", default=True): cv.boolean,
    }
)

CHIME_SCHEMA = _with_id(
    {
        vol.Required("name"): cv.string,
        vol.Required("media"): MEDIA,
    }
)

# ---------------------------------------------------------------------------
# Channels

WHEN_SCHEMA = vol.Any(
    vol.Schema({vol.Required("type"): "immediately"}),
    vol.Schema({vol.Required("type"): "after", vol.Required("delay"): DURATION}),
    vol.Schema({vol.Required("type"): "on_arrival"}),
)

REPEAT_SCHEMA = vol.Any(
    vol.Schema({vol.Required("type"): "once"}),
    vol.Schema({vol.Required("type"): "until_muted", vol.Required("every"): DURATION}),
)

RECIPIENTS_SCHEMA = vol.Schema(
    {
        vol.Optional("at_home"): cv.boolean,
        vol.Optional("away"): cv.boolean,
        vol.Optional("sleeping"): cv.boolean,
    }
)

# Every key is optional so that a step can store only what it changes.
_CHANNEL_COMMON = {
    vol.Optional("modes"): vol.All(cv.ensure_list, [_id]),
    vol.Optional("when"): WHEN_SCHEMA,
}
_CHANNEL_EXTRA: dict[str, dict[Any, Any]] = {
    CHANNEL_NOTIFICATION_CENTER: {},
    "light": {},
    "speaker": {
        vol.Optional("chime"): _optional(_id),
        vol.Optional("repeat"): REPEAT_SCHEMA,
        vol.Optional("read_the_message"): cv.boolean,
    },
    CHANNEL_PUSH: {
        vol.Optional("critical"): cv.boolean,
        vol.Optional("send_again_after"): _optional(DURATION),
        vol.Optional("sound"): _optional(cv.string),
        vol.Optional("recipients"): RECIPIENTS_SCHEMA,
        vol.Optional("action_buttons"): cv.boolean,
        vol.Optional("attachments"): cv.boolean,
        vol.Optional("clear_when_done"): cv.boolean,
    },
}


def channel_kind(key: str) -> str | None:
    """Return the kind of channel a key names, or None if it is not one."""
    if key in (CHANNEL_NOTIFICATION_CENTER, CHANNEL_PUSH):
        return key
    if key.startswith(CHANNEL_LIGHT_PREFIX):
        return "light"
    if key.startswith(CHANNEL_SPEAKER_PREFIX):
        return "speaker"
    return None


def _channels(value: Any) -> dict[str, dict[str, Any]]:
    """Validate the channel settings, keyed by channel."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise vol.Invalid("expected a mapping of channels")
    result: dict[str, dict[str, Any]] = {}
    for key, settings in value.items():
        kind = channel_kind(str(key))
        if kind is None:
            raise vol.Invalid(
                f"unknown channel '{key}': use notification_center, push, "
                "light:<id> or speaker:<id>"
            )
        schema = vol.Schema({**_CHANNEL_COMMON, **_CHANNEL_EXTRA[kind]})
        try:
            result[str(key)] = schema(settings or {})
        except vol.Invalid as err:
            raise vol.Invalid(f"channel '{key}': {err}") from err
    return result


# ---------------------------------------------------------------------------
# Categories

SNOOZE_SCHEMA = vol.Any(
    vol.Schema({vol.Required("type"): "not_allowed"}),
    vol.Schema({vol.Required("type"): "fixed", vol.Required("duration"): DURATION}),
    vol.Schema({vol.Required("type"): "ask"}),
)

CATEGORY_SCHEMA = _with_id(
    {
        vol.Required("name"): cv.string,
        vol.Optional("icon"): _optional(cv.icon),
        vol.Optional("card_color"): _optional(cv.string),
        vol.Optional("light_color"): _optional(_rgb),
        vol.Optional("chime"): _optional(_id),
        vol.Optional("snooze", default={"type": "ask"}): SNOOZE_SCHEMA,
        vol.Optional("channels", default=dict): _channels,
    }
)

# ---------------------------------------------------------------------------
# Notifications and steps

# A scheduled card expires after a duration, or on a later day at a time
# (``day: 0`` is the day it appeared, ``day: 1`` the next one, and so on).
EXPIRES_ON_DAY = vol.Schema(
    {
        vol.Required("day"): vol.All(vol.Coerce(int), vol.Range(0, 366)),
        vol.Required("at"): _time,
    }
)


def EXPIRES(value: Any) -> dict[str, Any]:  # noqa: N802 - used like a schema
    """Validate when a scheduled card expires."""
    if isinstance(value, dict) and "day" in value:
        return cast(dict[str, Any], EXPIRES_ON_DAY(value))
    return DURATION(value)


SCHEDULE_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("type"): "calendar",
            vol.Required("every"): _non_negative_or_entity,
            vol.Required("unit"): vol.In(INTERVAL_UNITS),
            vol.Optional("weekdays"): vol.All(cv.ensure_list, [vol.In(WEEKDAYS)]),
            vol.Optional("day_of_month"): vol.Any(
                "last", vol.All(vol.Coerce(int), vol.Range(1, 31))
            ),
            vol.Optional("month"): vol.All(vol.Coerce(int), vol.Range(1, 12)),
            vol.Required("at"): _time,
            vol.Optional("starting"): _date,
            vol.Optional("expires"): _optional(EXPIRES),
        }
    ),
    vol.Schema(
        {
            vol.Required("type"): "after_last_done",
            vol.Required("every"): _non_negative_or_entity,
            vol.Required("unit"): vol.In(INTERVAL_UNITS),
            vol.Optional("at"): _optional(_time),
            vol.Optional("expires"): _optional(EXPIRES),
        }
    ),
)

START_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("type"): "triggers",
            # No triggers: the step starts only with the trigger action.
            vol.Optional("triggers", default=list): TRIGGERS,
            vol.Optional("conditions", default=list): CONDITIONS,
        }
    ),
    vol.Schema(
        {
            vol.Required("type"): "schedule",
            vol.Required("schedule"): SCHEDULE_SCHEMA,
            vol.Optional("conditions", default=list): CONDITIONS,
        }
    ),
)

DONE_WHEN_SCHEMA = vol.Schema(
    {
        vol.Optional("triggers", default=list): TRIGGERS,
        # With Listed entities: close an entity's card when the start
        # condition is no longer true for it.
        vol.Optional("start_no_longer_true", default=False): cv.boolean,
    }
)

BUTTON_ACTION_SCHEMA = vol.Any(
    vol.Schema({vol.Required("type"): "nothing"}),
    vol.Schema({vol.Required("type"): "ha_action", vol.Required("actions"): ACTIONS}),
    vol.Schema({vol.Required("type"): "entity_action"}),
    vol.Schema(
        {
            vol.Required("type"): "more_info",
            vol.Optional("entity_id"): _optional(cv.entity_id),
        }
    ),
    vol.Schema({vol.Required("type"): "navigate", vol.Required("path"): cv.string}),
    vol.Schema({vol.Required("type"): "show_attachment"}),
)

BUTTON_SCHEMA = _with_id(
    {
        vol.Required("type"): vol.In(BUTTON_TYPES),
        vol.Optional("enabled", default=True): cv.boolean,
        vol.Optional("label"): _optional(cv.string),
        vol.Optional("icon"): _optional(cv.icon),
        vol.Optional("card"): vol.In(CARD_EFFECTS),
        vol.Optional("action", default={"type": "nothing"}): BUTTON_ACTION_SCHEMA,
        vol.Optional("snooze"): DURATION_OR_ASK,
        vol.Optional("confirm", default=False): cv.boolean,
        # Tap on the card: also when the push notification is tapped.
        vol.Optional("push_tap"): cv.boolean,
    }
)

# Default state of the built-in buttons of a new step.
BUILTIN_BUTTON_DEFAULTS: Final[dict[str, dict[str, Any]]] = {
    "tap": {"enabled": False, "card": "keep", "action": {"type": "more_info"}},
    "done": {"enabled": True, "card": "done", "action": {"type": "nothing"}},
    "snooze": {"enabled": True, "card": "snooze", "action": {"type": "nothing"}},
    "dismiss": {"enabled": False, "card": "dismiss", "action": {"type": "nothing"}},
}


def _buttons(value: Any) -> list[dict[str, Any]]:
    """Validate the buttons and make sure every built-in button is there.

    The built-in buttons (tap, done, snooze, dismiss) are always listed,
    switched on or off; custom buttons can be added and removed freely.
    """
    buttons: list[dict[str, Any]] = vol.All(cv.ensure_list, [BUTTON_SCHEMA])(
        value or []
    )
    seen: set[str] = set()
    for button in buttons:
        kind = button["type"]
        if kind != "custom":
            if kind in seen:
                raise vol.Invalid(f"the {kind} button is listed twice")
            seen.add(kind)
            button.setdefault("card", BUILTIN_BUTTON_DEFAULTS[kind]["card"])
        elif "card" not in button:
            button["card"] = "keep"
    missing = [
        BUTTON_SCHEMA({"type": kind, **BUILTIN_BUTTON_DEFAULTS[kind]})
        for kind in BUILTIN_BUTTONS
        if kind not in seen
    ]
    return missing + buttons if missing else buttons


ENTITY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("enabled", default=True): cv.boolean,
        # Entity action per button id.
        vol.Optional("actions", default=dict): {_id: ACTIONS},
    }
)


def _group_lists(value: Any) -> Any:
    """Turn the earlier single ``area`` and ``label`` into lists."""
    if not isinstance(value, dict):
        return value
    value = dict(value)
    for old, new in (("area", "areas"), ("label", "labels")):
        if old in value:
            single = value.pop(old)
            if single and new not in value:
                value[new] = [single]
    return value


_IDS = vol.All(cv.ensure_list, [cv.string])

_ENTITY_GROUP_FIELDS = _with_id(
    {
        vol.Required("domain"): cv.string,
        vol.Optional("device_class"): _optional(cv.string),
        # An entity matches if it is in any of the areas, floors and labels
        # given (each list that is not empty must match).
        vol.Optional("areas", default=list): _IDS,
        vol.Optional("floors", default=list): _IDS,
        vol.Optional("labels", default=list): _IDS,
        # Off: only the entities that matched when the group was saved.
        vol.Optional("add_new", default=True): cv.boolean,
        vol.Optional("members"): _optional(vol.All(cv.ensure_list, [cv.entity_id])),
        vol.Optional("enabled", default=True): cv.boolean,
        # Entities of the group that are switched off.
        vol.Optional("excluded", default=list): vol.All(cv.ensure_list, [cv.entity_id]),
        vol.Optional("actions", default=dict): {_id: ACTIONS},
    }
)
ENTITY_GROUP_SCHEMA = vol.All(_group_lists, _ENTITY_GROUP_FIELDS)

ATTACHMENT_SCHEMA = vol.Any(
    vol.Schema({vol.Required("camera"): cv.entity_domain("camera")}),
    vol.Schema({vol.Required("image"): cv.string}),
    vol.Schema({vol.Required("video"): cv.string}),
)

DATA_TYPES: Final = (
    "none",
    "active_since",
    "due",
    "last_done",
    "state",
    "attribute",
    "last_changed",
    "last_updated",
    "custom",
)
DATA_FORMATS: Final = ("relative", "duration", "time", "date", "datetime")

# The text after the label of a card.
DATA_SCHEMA = vol.Schema(
    {
        vol.Required("type"): vol.In(DATA_TYPES),
        # State, attribute, last changed, last updated: the card's entity when
        # not given.
        vol.Optional("entity_id"): _optional(cv.entity_id),
        vol.Optional("attribute"): _optional(cv.string),
        # Custom: a template with the card's placeholders.
        vol.Optional("text"): _optional(cv.string),
        # Times: how they are written.
        vol.Optional("format"): _optional(vol.In(DATA_FORMATS)),
    }
)

STEP_SCHEMA = _with_id(
    {
        vol.Optional("enabled", default=True): cv.boolean,
        vol.Required("message"): cv.string,
        vol.Optional("info"): _optional(cv.string),
        vol.Optional("data"): _optional(DATA_SCHEMA),
        vol.Optional("start", default={"type": "triggers"}): START_SCHEMA,
        vol.Optional("hide_while", default=list): CONDITIONS,
        vol.Optional("done_when", default=dict): DONE_WHEN_SCHEMA,
        vol.Optional("buttons", default=list): _buttons,
        # People who see the card and get the push; empty means everyone.
        vol.Optional("audience", default=list): vol.All(
            cv.ensure_list, [cv.entity_domain("person")]
        ),
        vol.Optional("attachments", default=list): vol.All(
            cv.ensure_list, [ATTACHMENT_SCHEMA]
        ),
        # Only what differs from the category's channel settings.
        vol.Optional("channels", default=dict): _channels,
    }
)

NOTIFICATION_SCHEMA = _with_id(
    {
        vol.Required("name"): cv.string,
        vol.Optional("category", default=GENERAL_CATEGORY_ID): _id,
        vol.Optional("enabled", default=True): cv.boolean,
        # Left out: inherited from the category.
        vol.Optional("icon"): _optional(cv.icon),
        vol.Optional("snooze"): _optional(SNOOZE_SCHEMA),
        vol.Optional("card_color"): _optional(cv.string),
        vol.Optional("light_color"): _optional(_rgb),
        vol.Optional("entities", default=list): vol.All(
            cv.ensure_list, [ENTITY_SCHEMA]
        ),
        vol.Optional("entity_groups", default=list): vol.All(
            cv.ensure_list, [ENTITY_GROUP_SCHEMA]
        ),
        vol.Required("steps"): vol.All(
            cv.ensure_list, vol.Length(min=1), [STEP_SCHEMA]
        ),
    }
)

ITEM_SCHEMAS: Final[dict[str, vol.Schema]] = {
    "modes": MODE_SCHEMA,
    "lights": LIGHT_SCHEMA,
    "speakers": SPEAKER_SCHEMA,
    "chimes": CHIME_SCHEMA,
    "categories": CATEGORY_SCHEMA,
    "notifications": NOTIFICATION_SCHEMA,
}

CONFIG_SCHEMA = vol.Schema(
    {
        vol.Optional("general", default=dict): GENERAL_SCHEMA,
        vol.Optional("modes", default=list): vol.All(cv.ensure_list, [MODE_SCHEMA]),
        vol.Optional("people", default=list): vol.All(cv.ensure_list, [PERSON_SCHEMA]),
        vol.Optional("lights", default=list): vol.All(cv.ensure_list, [LIGHT_SCHEMA]),
        vol.Optional("speakers", default=list): vol.All(
            cv.ensure_list, [SPEAKER_SCHEMA]
        ),
        vol.Optional("chimes", default=list): vol.All(cv.ensure_list, [CHIME_SCHEMA]),
        vol.Optional("categories", default=list): vol.All(
            cv.ensure_list, [CATEGORY_SCHEMA]
        ),
        vol.Optional("notifications", default=list): vol.All(
            cv.ensure_list, [NOTIFICATION_SCHEMA]
        ),
    }
)

# ---------------------------------------------------------------------------
# Default data


def default_config() -> ConfigData:
    """Return the data of a new installation: the Home mode and one category."""
    config: ConfigData = CONFIG_SCHEMA(
        {
            "modes": [{"id": HOME_MODE_ID, "name": "Home", "icon": "mdi:home"}],
            "categories": [
                {
                    "id": GENERAL_CATEGORY_ID,
                    "name": "General",
                    "icon": "mdi:bell",
                    "card_color": "blue",
                    "snooze": {"type": "ask"},
                    "channels": {
                        CHANNEL_NOTIFICATION_CENTER: {
                            "modes": [HOME_MODE_ID],
                            "when": {"type": "immediately"},
                        }
                    },
                }
            ],
        }
    )
    return config


# ---------------------------------------------------------------------------
# Full validation


def _path(*parts: object) -> str:
    return " → ".join(str(part) for part in parts)


def _check_unique(items: Iterable[dict[str, Any]], key: str, where: str) -> None:
    seen: set[str] = set()
    for item in items:
        value = str(item[key])
        folded = value.casefold()
        if folded in seen:
            raise ConfigValidationError(f"{where}: '{value}' is used twice")
        seen.add(folded)


def _check_references(config: ConfigData) -> None:
    """Check that every reference between sections points to an item."""
    for section in COLLECTIONS:
        _check_unique(config[section], "id", f"{section}: id")
    _check_unique(config["notifications"], "name", "notifications: name")
    _check_unique(config["people"], "person", "people")

    modes = {mode["id"]: mode for mode in config["modes"]}
    home = modes.get(HOME_MODE_ID)
    if home is None:
        raise ConfigValidationError(f"modes: the '{HOME_MODE_ID}' mode is required")
    if home.get("condition"):
        raise ConfigValidationError("modes: the Home mode has no condition")
    for mode in config["modes"]:
        if mode["id"] != HOME_MODE_ID and not mode.get("condition"):
            raise ConfigValidationError(
                _path("modes", mode["name"], "condition") + ": required"
            )

    channels = {CHANNEL_NOTIFICATION_CENTER, CHANNEL_PUSH}
    channels.update(CHANNEL_LIGHT_PREFIX + light["id"] for light in config["lights"])
    channels.update(
        CHANNEL_SPEAKER_PREFIX + speaker["id"] for speaker in config["speakers"]
    )
    chimes = {chime["id"] for chime in config["chimes"]}
    categories = {category["id"] for category in config["categories"]}

    def check_channels(settings: dict[str, dict[str, Any]], where: str) -> None:
        for key, channel in settings.items():
            if key not in channels:
                raise ConfigValidationError(_path(where, key) + ": no such device")
            for mode in channel.get("modes", []):
                if mode not in modes:
                    raise ConfigValidationError(
                        _path(where, key, "modes") + f": no mode '{mode}'"
                    )
            chime = channel.get("chime")
            if chime is not None and chime not in chimes:
                raise ConfigValidationError(
                    _path(where, key, "chime") + f": no chime '{chime}'"
                )

    for category in config["categories"]:
        where = _path("categories", category["name"])
        if category.get("chime") is not None and category["chime"] not in chimes:
            raise ConfigValidationError(
                _path(where, "chime") + f": no chime '{category['chime']}'"
            )
        check_channels(category["channels"], _path(where, "channels"))

    notification_ids = {item["id"] for item in config["notifications"]}
    for notification in config["notifications"]:
        where = _path("notifications", notification["name"])
        if notification["category"] not in categories:
            raise ConfigValidationError(
                _path(where, "category") + f": no category '{notification['category']}'"
            )
        _check_unique(notification["steps"], "id", _path(where, "steps"))
        for number, step in enumerate(notification["steps"], start=1):
            step_where = _path(where, f"step {number}")
            check_channels(step["channels"], _path(step_where, "channels"))
            _check_unique(step["buttons"], "id", _path(step_where, "buttons"))
            for trigger in _own_items(step, "trigger"):
                if trigger.get("trigger") == TRIGGER_NOTIFICATION_STATE and (
                    trigger["notification"] not in notification_ids
                ):
                    raise ConfigValidationError(
                        _path(step_where, "notification state")
                        + f": no notification '{trigger['notification']}'"
                    )


# ---------------------------------------------------------------------------
# Triggers and conditions inside steps

LISTED_ENTITIES_FIELDS: dict[vol.Marker, Any] = {
    vol.Optional("to"): vol.Any(cv.string, [cv.string]),
    vol.Optional("not_to"): vol.Any(cv.string, [cv.string]),
    vol.Optional("above"): vol.Coerce(float),
    vol.Optional("below"): vol.Coerce(float),
    vol.Optional("attribute"): cv.string,
    vol.Optional("for"): cv.positive_time_period_dict,
}


def _notification_state(value: Any) -> str:
    """Validate a notification state, accepting earlier names."""
    text = cv.string(value)
    text = _RENAMED_STATES.get(text, text)
    return cast(str, vol.In(NOTIFICATION_STATES)(text))


_NOTIFICATION_STATE_FIELDS: dict[vol.Marker, Any] = {
    vol.Required("notification"): _id,
    vol.Optional("step"): _id,
    vol.Required("state"): _notification_state,
    vol.Optional("for"): cv.positive_time_period_dict,
}

OWN_TRIGGER_SCHEMAS: Final[dict[str, vol.Schema]] = {
    TRIGGER_LISTED_ENTITIES: vol.Schema(
        {vol.Required("trigger"): TRIGGER_LISTED_ENTITIES, **LISTED_ENTITIES_FIELDS},
        extra=vol.PREVENT_EXTRA,
    ),
    TRIGGER_NOTIFICATION_STATE: vol.Schema(
        {
            vol.Required("trigger"): TRIGGER_NOTIFICATION_STATE,
            **_NOTIFICATION_STATE_FIELDS,
        }
    ),
}
OWN_CONDITION_SCHEMAS: Final[dict[str, vol.Schema]] = {
    TRIGGER_LISTED_ENTITIES: vol.Schema(
        {vol.Required("condition"): TRIGGER_LISTED_ENTITIES, **LISTED_ENTITIES_FIELDS}
    ),
    TRIGGER_NOTIFICATION_STATE: vol.Schema(
        {
            vol.Required("condition"): TRIGGER_NOTIFICATION_STATE,
            **_NOTIFICATION_STATE_FIELDS,
            # True if the state was reached within this time.
            vol.Optional("within"): cv.positive_time_period_dict,
        }
    ),
}


def _trigger_lists(step: dict[str, Any]) -> list[list[dict[str, Any]]]:
    lists = [step["done_when"]["triggers"]]
    if step["start"]["type"] == "triggers":
        lists.append(step["start"]["triggers"])
    return lists


def _condition_lists(step: dict[str, Any]) -> list[list[dict[str, Any]]]:
    return [step["start"]["conditions"], step["hide_while"]]


def _own_items(step: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    """Return the integration's own triggers or conditions of a step."""
    lists = _trigger_lists(step) if kind == "trigger" else _condition_lists(step)
    return [
        item
        for items in lists
        for item in items
        if str(item.get(kind, "")).startswith(f"{DOMAIN}.")
    ]


def _own_item(schema: vol.Schema, item: dict[str, Any]) -> dict[str, Any]:
    """Validate an own trigger or condition, keeping the user's form.

    Only a renamed state is changed in the stored item, so that an earlier
    name (``shown``) is saved under its new name (``active``).
    """
    validated: dict[str, Any] = schema(item)
    if "state" in validated:
        item["state"] = validated["state"]
    return validated


async def _validate_triggers(
    hass: HomeAssistant, triggers: list[dict[str, Any]], where: str
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for trigger in triggers:
        kind = str(trigger.get("trigger", trigger.get("platform", "")))
        try:
            if kind in OWN_TRIGGER_SCHEMAS:
                result.append(_own_item(OWN_TRIGGER_SCHEMAS[kind], trigger))
            else:
                checked = cv.TRIGGER_SCHEMA([trigger])
                await async_validate_trigger_config(hass, checked)
                result.append(trigger)
        except (vol.Invalid, HomeAssistantError) as err:
            raise ConfigValidationError(f"{where}: {err}") from err
    return result


async def _validate_conditions(
    hass: HomeAssistant, conditions: list[dict[str, Any]], where: str
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for condition in conditions:
        kind = str(condition.get("condition", ""))
        try:
            if kind in OWN_CONDITION_SCHEMAS:
                result.append(_own_item(OWN_CONDITION_SCHEMAS[kind], condition))
            else:
                checked = cv.CONDITIONS_SCHEMA([condition])
                await async_validate_conditions_config(hass, checked)
                result.append(condition)
        except (vol.Invalid, HomeAssistantError) as err:
            raise ConfigValidationError(f"{where}: {err}") from err
    return result


async def _validate_step_automation(
    hass: HomeAssistant, step: dict[str, Any], where: str
) -> None:
    """Validate the Home Assistant triggers and conditions of a step.

    The validated form is not stored: the user's own form is kept, so that
    export gives back what was written.
    """
    start = step["start"]
    if start["type"] == "triggers":
        await _validate_triggers(hass, start["triggers"], _path(where, "start"))
    await _validate_conditions(hass, start["conditions"], _path(where, "conditions"))
    await _validate_conditions(hass, step["hide_while"], _path(where, "hide while"))
    await _validate_triggers(
        hass, step["done_when"]["triggers"], _path(where, "done when")
    )
    for button in step["buttons"]:
        if button["action"]["type"] == "ha_action":
            _validate_actions(
                button["action"]["actions"], _path(where, "buttons", button["type"])
            )


def _validate_actions(actions: list[dict[str, Any]], where: str) -> None:
    try:
        cv.SCRIPT_SCHEMA(actions)
    except vol.Invalid as err:
        raise ConfigValidationError(f"{where}: {err}") from err


def _structure(schema: Callable[[Any], Any], data: Any, where: str) -> Any:
    try:
        return schema(data)
    except vol.Invalid as err:
        raise ConfigValidationError(f"{where}: {_humanize(err)}") from err


def _humanize(err: vol.Invalid) -> str:
    """Return a voluptuous error with its path in readable form."""
    path = " → ".join(str(part) for part in err.path)
    message = err.error_message if hasattr(err, "error_message") else str(err)
    return f"{path}: {message}" if path else message


async def async_validate_config(hass: HomeAssistant, data: Any) -> ConfigData:
    """Validate a whole configuration and return it with defaults filled in.

    Raises ConfigValidationError with a readable message on the first error.
    """
    if not isinstance(data, dict):
        raise ConfigValidationError("the configuration must be a mapping")
    config: ConfigData = _structure(CONFIG_SCHEMA, data, "configuration")
    for notification in config["notifications"]:
        for number, step in enumerate(notification["steps"], start=1):
            await _validate_step_automation(
                hass,
                step,
                _path("notifications", notification["name"], f"step {number}"),
            )
        for entity in notification["entities"]:
            for button, actions in entity["actions"].items():
                _validate_actions(
                    actions,
                    _path(
                        "notifications",
                        notification["name"],
                        entity["entity_id"],
                        button,
                    ),
                )
    for category in config["categories"]:
        _check_category_channels_complete(category)
    _check_references(config)
    return config


def _check_category_channels_complete(category: dict[str, Any]) -> None:
    """Fill in modes and When of a category's channels.

    A step stores only what it changes, but a category is the full setting.
    """
    for channel in category["channels"].values():
        channel.setdefault("modes", [])
        channel.setdefault("when", {"type": "immediately"})


def validate_item(section: str, data: Any) -> dict[str, Any]:
    """Check the structure of one item of a collection."""
    if section not in ITEM_SCHEMAS:
        raise ConfigValidationError(f"unknown section '{section}'")
    item: dict[str, Any] = _structure(ITEM_SCHEMAS[section], data, section)
    return item
