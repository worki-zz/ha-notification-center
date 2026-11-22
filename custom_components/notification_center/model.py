"""The configuration schema of Notification Center.

The whole configuration is one dictionary with these sections:
``general``, ``modes``, ``people``, ``lights``, ``speakers``, ``sirens``,
``chimes``, ``categories`` and ``notifications``. Field names follow the labels of the
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
    "sirens",
    "chimes",
    "categories",
    "notifications",
)

# Sections that are ordered lists of items with an ``id``.
COLLECTIONS: Final = (
    "modes",
    "lights",
    "speakers",
    "sirens",
    "chimes",
    "categories",
    "notifications",
)

HOME_MODE_ID: Final = "home"
GENERAL_CATEGORY_ID: Final = "general"

# Channel keys: the Dashboard (the panel and the dashboard cards) and Push
# are single channels, every light, speaker and siren is its own channel,
# keyed by its id.
CHANNEL_DASHBOARD: Final = "dashboard"
# The earlier name of the Dashboard channel, renamed by the upgrade.
CHANNEL_NOTIFICATION_CENTER: Final = "notification_center"
CHANNEL_PUSH: Final = "push"
CHANNEL_LIGHT_PREFIX: Final = "light:"
CHANNEL_SPEAKER_PREFIX: Final = "speaker:"
CHANNEL_SIREN_PREFIX: Final = "siren:"
# The device sections and the prefix of their channel keys.
DEVICE_PREFIXES: Final = {
    "lights": CHANNEL_LIGHT_PREFIX,
    "speakers": CHANNEL_SPEAKER_PREFIX,
    "sirens": CHANNEL_SIREN_PREFIX,
}

# The sounds that come with the integration, by chime id: their file and
# name. A chime of the Chimes list can be any other media.
BUILTIN_CHIMES: Final = {
    "nc_chime": ("chime.mp3", "Chime"),
    "nc_attention": ("attention.mp3", "Attention"),
    "nc_doorbell": ("doorbell.mp3", "Doorbell"),
    "nc_alarm": ("alarm.mp3", "Alarm"),
    "nc_alarm_indoor": ("alarm-indoor.mp3", "Indoor alarm"),
}
# How a light shows that a notification is highlighted: its own blinking,
# or one of the light's effects (by name).
EFFECT_BLINK: Final = "blink"

BUILTIN_BUTTONS: Final = ("tap", "done", "snooze", "dismiss")
BUTTON_TYPES: Final = (*BUILTIN_BUTTONS, "custom")
# The order of the buttons in the editors.
INTERACTION_ORDER: Final = ("tap", "done", "dismiss", "snooze", "custom")
# What a built-in button does to the card; the others only run their action.
BUTTON_EFFECTS: Final = {"done": "done", "dismiss": "dismiss", "snooze": "snooze"}
# The snooze times a Snooze button can offer, in this order. The minutes and
# hours count from now; the days come back on that day, at the time the card
# first came (a scheduled step) or at General's "Tomorrow" time.
SNOOZE_CHOICES: Final = (
    "15m",
    "30m",
    "1h",
    "2h",
    "3h",
    "6h",
    "12h",
    "tomorrow",
    "2d",
    "3d",
    "1w",
    "2w",
    "1mo",
)
DEFAULT_SNOOZE_CHOICES: Final = ("1h", "3h", "tomorrow")
WEEKDAYS: Final = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
INTERVAL_UNITS: Final = ("days", "weeks", "months", "years")

# Triggers and conditions of the integration itself. Their full behaviour
# comes with the engine; the schema is checked here already.
TRIGGER_ENTITIES_STATE: Final = f"{DOMAIN}.entities_state"
TRIGGER_ENTITIES_NUMERIC: Final = f"{DOMAIN}.entities_numeric_state"
# Both watch the entities a notification lists (its Entities block).
ENTITIES_KINDS: Final = (TRIGGER_ENTITIES_STATE, TRIGGER_ENTITIES_NUMERIC)
# The earlier single kind, read as one of the two above.
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
        # The order of the chimes (built-in and own) in the lists; the ones
        # not in it follow by name.
        vol.Optional("chime_order", default=list): vol.All(cv.ensure_list, [cv.string]),
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
        # When the person is asleep (only counted at home), set like the
        # condition of a mode.
        vol.Optional("sleep"): _optional(MODE_CONDITION_SCHEMA),
    }
)

LIGHT_SCHEMA = _with_id(
    {
        # A light, or a switch (a lamp on a plug): on, or blinking.
        vol.Required("entity_id"): cv.entity_domain(["light", "switch"]),
        vol.Optional("brightness"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(1, 100))
        ),
        # A light with white only: its colour temperature (empty: its own).
        vol.Optional("color_temp_kelvin"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(1000, 20000))
        ),
        # Dim when dark: below ``dim_below`` lx the light uses
        # ``dim_brightness``. Measured when the light turns on, or all the
        # time (a sensor outside, which the light does not reach).
        vol.Optional("illuminance_sensor"): _optional(cv.entity_id),
        vol.Optional("dim_below"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(min=0))
        ),
        vol.Optional("dim_brightness"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(1, 100))
        ),
        vol.Optional("dim_continuously", default=True): cv.boolean,
        # How a highlighted notification shows: ``blink`` or an effect of
        # the light.
        vol.Optional("effect", default=EFFECT_BLINK): cv.string,
        # The light's own RGB for the system colours (only what differs).
        vol.Optional("colors", default=dict): vol.Schema({cv.string: _rgb}),
    }
)

SPEAKER_SCHEMA = _with_id(
    {
        vol.Required("entity_id"): cv.entity_domain("media_player"),
        # Empty: the volume is not changed.
        vol.Optional("volume"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(0, 1))
        ),
    }
)

SIREN_SCHEMA = _with_id(
    {
        # A siren, a switch, or a select (an option turns the siren on).
        vol.Required("entity_id"): cv.entity_domain(["siren", "switch", "select"]),
        vol.Optional("tone"): _optional(cv.string),
        vol.Optional("volume"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(0, 1))
        ),
        vol.Optional("duration"): vol.Any(
            None, vol.All(vol.Coerce(int), vol.Range(min=1))
        ),
        # A select: the option that sounds, and the one that stops it.
        vol.Optional("option"): _optional(cv.string),
        vol.Optional("stop_option"): _optional(cv.string),
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

# Every key is optional so that a step can store only what it changes. A
# channel sends after its delay (none: at once); in a step, ``delay: null``
# overrides the category's delay with "at once".
_CHANNEL_COMMON = {
    vol.Optional("modes"): vol.All(cv.ensure_list, [_id]),
    vol.Optional("delay"): _optional(DURATION),
}
_CHANNEL_EXTRA: dict[str, dict[Any, Any]] = {
    CHANNEL_DASHBOARD: {},
    "light": {},
    "siren": {},
    "speaker": {
        vol.Optional("chime"): _optional(_id),
        vol.Optional("repeat"): REPEAT_SCHEMA,
        vol.Optional("read_the_message"): cv.boolean,
        # What is read besides the message: the notification's name and
        # the Info line.
        vol.Optional("read_name"): cv.boolean,
        vol.Optional("read_info"): cv.boolean,
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
    if key in (CHANNEL_DASHBOARD, CHANNEL_PUSH):
        return key
    if key.startswith(CHANNEL_LIGHT_PREFIX):
        return "light"
    if key.startswith(CHANNEL_SPEAKER_PREFIX):
        return "speaker"
    if key.startswith(CHANNEL_SIREN_PREFIX):
        return "siren"
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
                f"unknown channel '{key}': use dashboard, push, "
                "light:<id>, speaker:<id> or siren:<id>"
            )
        schema = vol.Schema({**_CHANNEL_COMMON, **_CHANNEL_EXTRA[kind]})
        try:
            result[str(key)] = schema(settings or {})
        except vol.Invalid as err:
            raise vol.Invalid(f"channel '{key}': {err}") from err
    return result


# ---------------------------------------------------------------------------
# Audience

# The states of a person a notification can be for: at home and awake,
# asleep (at home, with the person's Sleep entity on) and away.
AUDIENCE_STATES: Final = ("home", "sleep", "away")

AUDIENCE_ENTRY_SCHEMA = vol.Schema(
    {vol.Optional(state, default=False): cv.boolean for state in AUDIENCE_STATES}
)


def _audience(value: Any) -> dict[str, dict[str, bool]]:
    """Validate an audience: the states each person gets the notification in.

    In a category it is the default; a person left out gets what every
    listed person has in common. In a step it holds only the people whose
    states differ from the category's.
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise vol.Invalid("expected a mapping of people to their states")
    result: dict[str, dict[str, bool]] = {}
    for person, states in value.items():
        result[cv.entity_domain("person")(person)] = AUDIENCE_ENTRY_SCHEMA(states or {})
    return result


# ---------------------------------------------------------------------------
# Categories


def _category_buttons_late(value: Any) -> list[dict[str, Any]]:
    # Defined below, with the buttons of the steps.
    return _category_buttons(value)


CATEGORY_SCHEMA = _with_id(
    {
        vol.Required("name"): cv.string,
        vol.Optional("icon"): _optional(cv.icon),
        # A system colour by name, or a custom colour (#rrggbb) with the
        # light's own ``light_color`` (empty: the card colour).
        vol.Optional("card_color"): _optional(cv.string),
        vol.Optional("light_color"): _optional(_rgb),
        # The lights blink (or show their effect) for its notifications.
        vol.Optional("highlight", default=False): cv.boolean,
        vol.Optional("chime"): _optional(_id),
        vol.Optional("buttons", default=list): _category_buttons_late,
        vol.Optional("audience", default=dict): _audience,
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

ACTIVATION_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("type"): "triggers",
            # No triggers: the step starts only with the trigger action.
            vol.Optional("triggers", default=list): TRIGGERS,
        }
    ),
    vol.Schema(
        {
            vol.Required("type"): "schedule",
            vol.Required("schedule"): SCHEDULE_SCHEMA,
        }
    ),
)

# Conditions: one set of conditions, used at the activation (a card is
# activated only while they are met; a scheduled card waits for them) and
# while a card is active (it is hidden while they are not met), as switched on.
STEP_CONDITIONS_SCHEMA = vol.Schema(
    {
        vol.Optional("activate_only_while_met", default=True): cv.boolean,
        vol.Optional("hide_while_not_met", default=True): cv.boolean,
        vol.Optional("conditions", default=list): CONDITIONS,
    }
)

DONE_WHEN_SCHEMA = vol.Schema(
    {
        vol.Optional("triggers", default=list): TRIGGERS,
        # Close a card when what activated it is no longer true: its entity
        # no longer matches Notification entities, or the Conditions (with
        # Activate only while conditions are met) are no longer met.
        vol.Optional("activation_conditions_no_longer_true", default=False): cv.boolean,
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
    # Stop the lights, speakers and sirens; the card stays.
    vol.Schema({vol.Required("type"): "silence"}),
)

# A button of a step. The buttons of the step's category (the four built-in
# ones and the category's custom buttons) are inherited: the step stores
# their action and only what it changes. A custom button of the category is
# linked by its id; a custom button with an id of its own is the step's.
BUTTON_SCHEMA = _with_id(
    {
        vol.Required("type"): vol.In(BUTTON_TYPES),
        # Left out: the category's setting.
        vol.Optional("enabled"): cv.boolean,
        # A category button's label is changed in YAML only.
        vol.Optional("label"): _optional(cv.string),
        vol.Optional("icon"): _optional(cv.icon),
        vol.Optional("action", default={"type": "nothing"}): BUTTON_ACTION_SCHEMA,
        # The Snooze button's times: one snoozes at once, more are offered.
        vol.Optional("snooze"): _optional(
            vol.All(cv.ensure_list, [vol.In(SNOOZE_CHOICES)])
        ),
        # Shown in the push notification (it takes effect with the push).
        vol.Optional("show_in_push"): _optional(cv.boolean),
        vol.Optional("confirm", default=False): cv.boolean,
        # Tap on the card: also when the push notification is tapped.
        vol.Optional("push_tap"): _optional(cv.boolean),
    }
)

# A button of a category: what its notifications inherit. No action: that
# belongs to each notification.
CATEGORY_BUTTON_SCHEMA = _with_id(
    {
        vol.Required("type"): vol.In(BUTTON_TYPES),
        vol.Optional("enabled"): cv.boolean,
        vol.Optional("label"): _optional(cv.string),
        vol.Optional("icon"): _optional(cv.icon),
        vol.Optional("snooze"): _optional(
            vol.All(cv.ensure_list, [vol.In(SNOOZE_CHOICES)])
        ),
        vol.Optional("show_in_push"): _optional(cv.boolean),
        vol.Optional("push_tap"): _optional(cv.boolean),
    }
)

# The built-in buttons of a new category: only Done is switched on.
CATEGORY_BUTTON_DEFAULTS: Final[dict[str, bool]] = {
    "tap": False,
    "done": True,
    "dismiss": False,
    "snooze": False,
}
# The action of a built-in button a step has not stored yet.
BUILTIN_ACTION_DEFAULTS: Final[dict[str, dict[str, Any]]] = {
    "tap": {"type": "more_info"},
    "done": {"type": "nothing"},
    "dismiss": {"type": "nothing"},
    "snooze": {"type": "nothing"},
}


def _check_builtins_once(buttons: list[dict[str, Any]]) -> set[str]:
    seen: set[str] = set()
    for button in buttons:
        kind = button["type"]
        if kind != "custom":
            if kind in seen:
                raise vol.Invalid(f"the {kind} button is listed twice")
            seen.add(kind)
    return seen


def _sorted_snooze(choices: Iterable[str]) -> list[str]:
    chosen = set(choices)
    return [item for item in SNOOZE_CHOICES if item in chosen]


def _buttons(value: Any) -> list[dict[str, Any]]:
    """Validate the buttons of a step.

    Every built-in button (tap, done, snooze, dismiss) is listed, so that it
    has an id an entity action can point to. What is left out of a button
    comes from the category.
    """
    buttons: list[dict[str, Any]] = vol.All(cv.ensure_list, [BUTTON_SCHEMA])(
        value or []
    )
    seen = _check_builtins_once(buttons)
    missing = [
        BUTTON_SCHEMA({"type": kind, "action": BUILTIN_ACTION_DEFAULTS[kind]})
        for kind in BUILTIN_BUTTONS
        if kind not in seen
    ]
    buttons = missing + buttons if missing else buttons
    for button in buttons:
        if button["type"] != "snooze" or not button.get("snooze"):
            button.pop("snooze", None)
        else:
            button["snooze"] = _sorted_snooze(button["snooze"])
        for key in ("label", "icon", "show_in_push", "push_tap"):
            if button.get(key) is None:
                button.pop(key, None)
        if button["type"] == "tap":
            button.pop("show_in_push", None)
        else:
            button.pop("push_tap", None)
    return buttons


def _category_buttons(value: Any) -> list[dict[str, Any]]:
    """Validate a category's buttons and fill in every setting.

    A built-in button's id is its type.
    """
    items = [
        {**item, "id": item.get("id") or item["type"]}
        if isinstance(item, dict) and item.get("type") in BUILTIN_BUTTONS
        else item
        for item in cv.ensure_list(value or [])
    ]
    buttons: list[dict[str, Any]] = vol.All(cv.ensure_list, [CATEGORY_BUTTON_SCHEMA])(
        items
    )
    seen = _check_builtins_once(buttons)
    missing = [
        CATEGORY_BUTTON_SCHEMA({"type": kind, "id": kind})
        for kind in BUILTIN_BUTTONS
        if kind not in seen
    ]
    buttons = missing + buttons if missing else buttons
    # The built-in buttons first, in the order of the editor.
    buttons.sort(key=lambda button: INTERACTION_ORDER.index(button["type"]))
    for button in buttons:
        kind = button["type"]
        button.setdefault("enabled", CATEGORY_BUTTON_DEFAULTS.get(kind, True))
        if kind == "snooze":
            button["snooze"] = _sorted_snooze(
                button.get("snooze") or DEFAULT_SNOOZE_CHOICES
            )
        else:
            button.pop("snooze", None)
        if kind == "tap":
            button.pop("show_in_push", None)
            if button.get("push_tap") is None:
                button["push_tap"] = True
        else:
            button.pop("push_tap", None)
            if button.get("show_in_push") is None:
                button["show_in_push"] = True
    return buttons


def category_custom_ids(category: dict[str, Any] | None) -> set[str]:
    """Return the ids of a category's custom buttons."""
    return {
        button["id"]
        for button in (category or {}).get("buttons", [])
        if button["type"] == "custom"
    }


def effective_buttons(
    category: dict[str, Any] | None, step: dict[str, Any]
) -> list[dict[str, Any]]:
    """Return a step's buttons with what they inherit from the category.

    The order: the built-in buttons, the category's custom buttons, then
    the step's own custom buttons. ``category`` is true on the inherited
    ones.
    """
    own = list(step.get("buttons") or [])
    category_buttons = (
        list(category["buttons"])
        if category and category.get("buttons")
        else _category_buttons([])
    )
    linked = {button["id"] for button in category_buttons if button["type"] == "custom"}
    result: list[dict[str, Any]] = []
    for base in category_buttons:
        entry: dict[str, Any]
        if base["type"] == "custom":
            entry = next(
                (b for b in own if b["type"] == "custom" and b["id"] == base["id"]),
                {},
            )
        else:
            entry = next((b for b in own if b["type"] == base["type"]), {})
        result.append(_merge_button(base, entry))
    for entry in own:
        if entry["type"] == "custom" and entry["id"] not in linked:
            button = {
                "enabled": True,
                "show_in_push": True,
                **entry,
                "category": False,
            }
            result.append(button)
    return result


def detach_category_buttons(
    notification: dict[str, Any], category: dict[str, Any], ids: set[str]
) -> None:
    """Make the given custom buttons of a category the steps' own ones.

    Used when the category's button is deleted, or the notification moves
    to another category: where a step has the button, it keeps it with the
    label and icon it showed.
    """
    sources = {
        button["id"]: button
        for button in category.get("buttons", [])
        if button["id"] in ids
    }
    for step in notification.get("steps", []):
        buttons = step.get("buttons", [])
        present = {button["id"] for button in buttons if button["type"] == "custom"}
        for button_id, source in sources.items():
            if button_id not in present:
                # Not stored in the step: it showed as the category set it.
                if not source.get("enabled", True):
                    continue
                buttons.append({"id": button_id, "type": "custom"})
        for button in buttons:
            source = sources.get(button["id"])
            if button["type"] != "custom" or source is None:
                continue
            button.setdefault("enabled", source.get("enabled", True))
            if not button.get("label"):
                button["label"] = source.get("label") or "Button"
            if not button.get("icon") and source.get("icon"):
                button["icon"] = source["icon"]
            if button.get("show_in_push") is None:
                button["show_in_push"] = source.get("show_in_push", True)
            button.setdefault("action", {"type": "nothing"})
        step["buttons"] = buttons


def _merge_button(base: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    kind = base["type"]
    button: dict[str, Any] = {
        "id": entry.get("id") or base["id"],
        "type": kind,
        "enabled": entry.get("enabled", base.get("enabled", True)),
        "label": entry.get("label") or base.get("label"),
        "icon": entry.get("icon") or base.get("icon"),
        "action": entry.get("action")
        or BUILTIN_ACTION_DEFAULTS.get(kind, {"type": "nothing"}),
        "confirm": entry.get("confirm", False),
        "category": True,
    }
    if kind == "snooze":
        button["snooze"] = (
            entry.get("snooze") or base.get("snooze") or list(DEFAULT_SNOOZE_CHOICES)
        )
    if kind == "tap":
        value = entry.get("push_tap")
        button["push_tap"] = base.get("push_tap", True) if value is None else value
    else:
        value = entry.get("show_in_push")
        button["show_in_push"] = (
            base.get("show_in_push", True) if value is None else value
        )
    return button


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
        # Custom actions of single members, per button: they replace the
        # group's action for that member.
        vol.Optional("member_actions", default=dict): {cv.entity_id: {_id: ACTIONS}},
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
    "last_done",
    "state",
    "attribute",
    "last_changed",
    "last_updated",
    "custom",
)
DATA_FORMATS: Final = ("relative", "duration", "time", "date", "datetime")


def _old_data_type(value: Any) -> Any:
    """Read the data types of 0.4.1 and before: Due is now Active since."""
    return "active_since" if value == "due" else value


# The text after the label of a card.
DATA_SCHEMA = vol.Schema(
    {
        vol.Required("type"): vol.All(_old_data_type, vol.In(DATA_TYPES)),
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
        vol.Optional("activation", default={"type": "triggers"}): ACTIVATION_SCHEMA,
        vol.Optional("conditions", default=dict): STEP_CONDITIONS_SCHEMA,
        vol.Optional("done_when", default=dict): DONE_WHEN_SCHEMA,
        vol.Optional("buttons", default=list): _buttons,
        # The people whose states differ from the category's audience.
        vol.Optional("audience", default=dict): _audience,
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
        vol.Optional("card_color"): _optional(cv.string),
        vol.Optional("light_color"): _optional(_rgb),
        vol.Optional("highlight"): _optional(cv.boolean),
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
    "sirens": SIREN_SCHEMA,
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
        vol.Optional("sirens", default=list): vol.All(cv.ensure_list, [SIREN_SCHEMA]),
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
                    "channels": {CHANNEL_DASHBOARD: {"modes": [HOME_MODE_ID]}},
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
    for mode in config["modes"]:
        if mode["id"] != HOME_MODE_ID and not mode.get("condition"):
            raise ConfigValidationError(
                _path("modes", mode["name"], "condition") + ": required"
            )

    channels = {CHANNEL_DASHBOARD, CHANNEL_PUSH}
    for section, prefix in DEVICE_PREFIXES.items():
        channels.update(prefix + item["id"] for item in config[section])
    chimes = {chime["id"] for chime in config["chimes"]} | set(BUILTIN_CHIMES)
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
                kind = trigger.get("trigger")
                if (kind == TRIGGER_NOTIFICATION_STATE or kind in ENTITIES_KINDS) and (
                    trigger["notification"] not in notification_ids
                ):
                    raise ConfigValidationError(
                        _path(
                            step_where,
                            "notification state"
                            if kind == TRIGGER_NOTIFICATION_STATE
                            else "notification entities",
                        )
                        + f": no notification '{trigger['notification']}'"
                    )


# ---------------------------------------------------------------------------
# Triggers and conditions inside steps


def _for(value: Any) -> Any:
    """Validate a ``for`` time: a duration, or a template giving one."""
    if isinstance(value, str) and "{" in value:
        return cv.string(value)
    if isinstance(value, dict):
        cv.positive_time_period_dict(value)
        return value
    cv.positive_time_period(value)
    return value


def _threshold(value: Any) -> Any:
    """Validate a limit: a number, or an entity whose state is the number."""
    if isinstance(value, str) and "." in value and not _is_number(value):
        return cv.entity_id(value)
    return vol.Coerce(float)(value)


def _is_number(value: str) -> bool:
    try:
        float(value)
    except ValueError:
        return False
    return True


ENTITIES_STATE_FIELDS: dict[vol.Marker, Any] = {
    vol.Optional("attribute"): cv.string,
    vol.Optional("to"): vol.Any(cv.string, [cv.string]),
    vol.Optional("not_to"): vol.Any(cv.string, [cv.string]),
    vol.Optional("for"): _for,
}

ENTITIES_NUMERIC_FIELDS: dict[vol.Marker, Any] = {
    vol.Optional("attribute"): cv.string,
    vol.Optional("above"): _threshold,
    vol.Optional("below"): _threshold,
    vol.Optional("value_template"): cv.string,
    vol.Optional("for"): _for,
}

# The notification whose entities are watched; inside a notification its
# own id when empty.
_ENTITIES_NOTIFICATION: dict[vol.Marker, Any] = {vol.Required("notification"): _id}


def upgrade_listed(notification: dict[str, Any]) -> None:
    """Turn earlier Listed entities triggers and conditions into the new kinds.

    With a limit (above or below) the item becomes Notification entities
    numeric state, otherwise Notification entities state. It points to the
    notification itself, as the earlier kind always did.
    """
    for step in notification.get("steps") or []:
        if not isinstance(step, dict):
            continue
        start = step.get("activation") or step.get("start") or {}
        done_when = step.get("done_when") or {}
        conditions = step.get("conditions")
        conditions = conditions if isinstance(conditions, dict) else {}
        for items, key in (
            (start.get("triggers"), "trigger"),
            (done_when.get("triggers"), "trigger"),
            (start.get("conditions"), "condition"),
            (step.get("hide_while"), "condition"),
            ((step.get("show_when") or {}).get("conditions"), "condition"),
            (conditions.get("conditions"), "condition"),
        ):
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get(key) == TRIGGER_LISTED_ENTITIES:
                    _upgrade_listed_item(item, key, notification.get("id"))


def _snooze_choice(duration: Any) -> str:
    """Return the snooze choice nearest to an earlier fixed duration."""
    try:
        minutes = cv.time_period(duration).total_seconds() / 60
    except vol.Invalid:
        return "1h"
    lengths = {
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "3h": 180,
        "6h": 360,
        "12h": 720,
        "tomorrow": 1440,
        "2d": 2880,
        "3d": 4320,
        "1w": 10080,
        "2w": 20160,
        "1mo": 43200,
    }
    return min(lengths, key=lambda key: abs(lengths[key] - minutes))


def upgrade_buttons(notification: dict[str, Any]) -> None:
    """Turn earlier buttons and the notification's Snooze into the new ones.

    A button no longer chooses what happens to the card: Done marks it done,
    Dismiss dismisses it, Snooze snoozes it, and the others only run their
    action. An earlier Dismiss that kept the card silently (Mute) becomes a
    button of its own (with its id, so its entity actions stay), so it does
    not start dismissing. The notification's
    Snooze moves to its Snooze button: not allowed switches it off, a fixed
    time becomes its one choice.
    """
    snooze = notification.pop("snooze", None)
    snooze = snooze if isinstance(snooze, dict) else {}
    for step in notification.get("steps") or []:
        buttons = step.get("buttons") if isinstance(step, dict) else None
        if not isinstance(buttons, list):
            if isinstance(step, dict) and snooze.get("type") in (
                "not_allowed",
                "fixed",
            ):
                step["buttons"] = buttons = []
            else:
                continue
        found = False
        for button in buttons:
            if not isinstance(button, dict):
                continue
            effect = button.pop("card", None)
            if button.get("type") == "dismiss" and effect == "keep_silent":
                button["type"] = "custom"
                button.setdefault("label", "Mute")
                button.setdefault("icon", "mdi:volume-off")
            if button.get("type") != "snooze":
                continue
            found = True
            own = button.get("snooze")
            if isinstance(own, list):
                continue
            if isinstance(own, dict):
                button["snooze"] = [_snooze_choice(own)]
            elif own != "ask" and snooze.get("type") == "fixed":
                button["snooze"] = [_snooze_choice(snooze.get("duration"))]
            else:
                button.pop("snooze", None)
            if snooze.get("type") == "not_allowed" and own is None:
                button["enabled"] = False
        if not found and snooze.get("type") in ("not_allowed", "fixed"):
            button = {"type": "snooze", "enabled": snooze["type"] == "fixed"}
            if snooze["type"] == "fixed":
                button["snooze"] = [_snooze_choice(snooze.get("duration"))]
            buttons.insert(0, button)


def upgrade_category_buttons(data: dict[str, Any]) -> None:
    """Give categories of 0.4 and before their buttons.

    A category's Snooze becomes its Snooze button. The steps then keep only
    what differs from the category: the snooze times, the push settings and
    the icons that were the defaults are left out, so they are inherited.
    Runs once: afterwards every category has its buttons.
    """
    categories = data.get("categories")
    if not isinstance(categories, list) or all(
        not isinstance(category, dict) or "buttons" in category
        for category in categories
    ):
        return
    for category in categories:
        if not isinstance(category, dict) or "buttons" in category:
            continue
        snooze = category.pop("snooze", None)
        snooze = snooze if isinstance(snooze, dict) else {}
        button: dict[str, Any] = {"type": "snooze"}
        if snooze.get("type") == "fixed":
            button["snooze"] = [_snooze_choice(snooze.get("duration"))]
        category["buttons"] = [button]
    defaults = list(DEFAULT_SNOOZE_CHOICES)
    for notification in data.get("notifications") or []:
        if not isinstance(notification, dict):
            continue
        for step in notification.get("steps") or []:
            buttons = step.get("buttons") if isinstance(step, dict) else None
            for button in buttons if isinstance(buttons, list) else []:
                kind = button.get("type") if isinstance(button, dict) else None
                if kind is None:
                    continue
                if kind == "snooze" and list(button.get("snooze") or []) == defaults:
                    button.pop("snooze", None)
                if button.get("show_in_push") is True:
                    button.pop("show_in_push", None)
                if button.get("push_tap") is True:
                    button.pop("push_tap", None)
                for key in ("icon", "label"):
                    if not button.get(key):
                        button.pop(key, None)


def upgrade_devices(data: dict[str, Any]) -> None:
    """Drop the device settings of the first plan that 0.6.2 left out.

    A light's transition and highlight effect (the effect is now chosen by
    the light's Effect and the notification's Highlight), and a speaker's
    resume playback (it follows the speaker).
    """
    for light in data.get("lights") or []:
        if isinstance(light, dict):
            light.pop("transition", None)
            light.pop("highlight_effect", None)
            for key in ("brightness", "dim_brightness"):
                if light.get(key) == 0:
                    light[key] = None
    for speaker in data.get("speakers") or []:
        if isinstance(speaker, dict):
            speaker.pop("resume_playback", None)


def upgrade_channels(data: dict[str, Any], people: Iterable[str]) -> None:
    """Bring the channels and audiences of 0.5 and before to the 0.6 form.

    - The Notification center channel is now called Dashboard.
    - ``when`` becomes ``delay``: After X keeps its time, Immediately and On
      arrival send at once (arriving is now part of the audience: a person
      away gets it when they are home again).
    - A category gets an audience (everyone, in every state), and, once, the
      Dashboard in every mode, so that nothing disappears after the update.
    - A step's audience, a list of people (empty: everyone), becomes the
      people it leaves out, with no state.
    - A person's Sleep entity becomes a Sleep condition (the entity is on).
    """
    categories = data.get("categories")
    categories = categories if isinstance(categories, list) else []
    modes = [
        mode["id"]
        for mode in data.get("modes") or []
        if isinstance(mode, dict) and mode.get("id")
    ]
    first = any(
        isinstance(category, dict) and "audience" not in category
        for category in categories
    )
    for category in categories:
        if not isinstance(category, dict):
            continue
        channels = category.get("channels")
        if isinstance(channels, dict):
            _upgrade_channel_settings(channels, category=True)
        if first and "audience" not in category:
            category["audience"] = {}
            channels = category.setdefault("channels", {})
            if isinstance(channels, dict) and CHANNEL_DASHBOARD not in channels:
                channels[CHANNEL_DASHBOARD] = {"modes": list(modes)}
    for person in data.get("people") or []:
        if isinstance(person, dict) and "sleep_entity" in person:
            entity = person.pop("sleep_entity")
            if entity and "sleep" not in person:
                person["sleep"] = {"type": "state", "entity_id": entity, "state": "on"}
    everyone = set(people)
    for notification in data.get("notifications") or []:
        if not isinstance(notification, dict):
            continue
        for step in notification.get("steps") or []:
            if not isinstance(step, dict):
                continue
            channels = step.get("channels")
            if isinstance(channels, dict):
                _upgrade_channel_settings(channels, category=False)
            audience = step.get("audience")
            if isinstance(audience, list):
                chosen = {str(person) for person in audience}
                step["audience"] = (
                    {
                        person: dict.fromkeys(AUDIENCE_STATES, False)
                        for person in sorted(everyone - chosen)
                    }
                    if chosen
                    else {}
                )


def _upgrade_channel_settings(channels: dict[str, Any], *, category: bool) -> None:
    if CHANNEL_NOTIFICATION_CENTER in channels:
        old = channels.pop(CHANNEL_NOTIFICATION_CENTER)
        channels.setdefault(CHANNEL_DASHBOARD, old)
    for channel in channels.values():
        if not isinstance(channel, dict) or "when" not in channel:
            continue
        when = channel.pop("when")
        delay = (
            when.get("delay")
            if isinstance(when, dict) and when.get("type") == "after"
            else None
        )
        if delay or not category:
            channel["delay"] = delay or None


def upgrade_show_when(notification: dict[str, Any]) -> None:
    """Turn the Start conditions and Hide while of earlier steps into Show when.

    Start conditions alone are used at the start only; Hide while alone
    becomes its opposite (Not), used while a card is open. With both, the
    card needs the Start conditions and not Hide while, at the start and
    while it is open.
    """
    for step in notification.get("steps") or []:
        if not isinstance(step, dict):
            continue
        start = step.get("start")
        conditions = start.pop("conditions", None) if isinstance(start, dict) else None
        hide_while = step.pop("hide_while", None)
        conditions = conditions if isinstance(conditions, list) else []
        hide_while = hide_while if isinstance(hide_while, list) else []
        if "show_when" in step or not (conditions or hide_while):
            continue
        items = list(conditions)
        if hide_while:
            items.append({"condition": "not", "conditions": hide_while})
        step["show_when"] = {
            "start": bool(conditions),
            "hide": bool(hide_while),
            "conditions": items,
        }


def upgrade_terms(notification: dict[str, Any]) -> None:
    """Rename the step fields of earlier versions (0.4.11 and before).

    start -> activation; show_when -> conditions, with start ->
    activate_only_while_met and hide -> hide_while_not_met; Done when's
    start_no_longer_true -> activation_conditions_no_longer_true.
    """
    for step in notification.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if "start" in step and "activation" not in step:
            step["activation"] = step.pop("start")
        show_when = step.pop("show_when", None)
        if isinstance(show_when, dict) and not isinstance(step.get("conditions"), dict):
            step["conditions"] = {
                "activate_only_while_met": show_when.get("start", True),
                "hide_while_not_met": show_when.get("hide", True),
                "conditions": show_when.get("conditions") or [],
            }
        done_when = step.get("done_when")
        if isinstance(done_when, dict) and "start_no_longer_true" in done_when:
            done_when.setdefault(
                "activation_conditions_no_longer_true",
                done_when.pop("start_no_longer_true"),
            )


def _upgrade_listed_item(item: dict[str, Any], key: str, own_id: Any) -> None:
    options = item.pop("options", None)
    if isinstance(options, dict):
        item.update(options)
    numeric = "above" in item or "below" in item
    item[key] = TRIGGER_ENTITIES_NUMERIC if numeric else TRIGGER_ENTITIES_STATE
    for name in ("to", "not_to") if numeric else ("above", "below"):
        item.pop(name, None)
    if not item.get("notification") and own_id:
        item["notification"] = own_id


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
    TRIGGER_ENTITIES_STATE: vol.Schema(
        {
            vol.Required("trigger"): TRIGGER_ENTITIES_STATE,
            **_ENTITIES_NOTIFICATION,
            **ENTITIES_STATE_FIELDS,
        }
    ),
    TRIGGER_ENTITIES_NUMERIC: vol.Schema(
        {
            vol.Required("trigger"): TRIGGER_ENTITIES_NUMERIC,
            **_ENTITIES_NOTIFICATION,
            **ENTITIES_NUMERIC_FIELDS,
        }
    ),
    TRIGGER_NOTIFICATION_STATE: vol.Schema(
        {
            vol.Required("trigger"): TRIGGER_NOTIFICATION_STATE,
            **_NOTIFICATION_STATE_FIELDS,
        }
    ),
}
OWN_CONDITION_SCHEMAS: Final[dict[str, vol.Schema]] = {
    TRIGGER_ENTITIES_STATE: vol.Schema(
        {
            vol.Required("condition"): TRIGGER_ENTITIES_STATE,
            **_ENTITIES_NOTIFICATION,
            **ENTITIES_STATE_FIELDS,
        }
    ),
    TRIGGER_ENTITIES_NUMERIC: vol.Schema(
        {
            vol.Required("condition"): TRIGGER_ENTITIES_NUMERIC,
            **_ENTITIES_NOTIFICATION,
            **ENTITIES_NUMERIC_FIELDS,
        }
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
    if step["activation"]["type"] == "triggers":
        lists.append(step["activation"]["triggers"])
    return lists


def _condition_lists(step: dict[str, Any]) -> list[list[dict[str, Any]]]:
    return [step["conditions"]["conditions"]]


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
    start = step["activation"]
    if start["type"] == "triggers":
        await _validate_triggers(hass, start["triggers"], _path(where, "activation"))
    await _validate_conditions(
        hass, step["conditions"]["conditions"], _path(where, "conditions")
    )
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
    upgrade_category_buttons(data)
    upgrade_channels(data, _known_people(hass, data))
    upgrade_devices(data)
    for notification in data.get("notifications") or []:
        # Before the structure check: the earlier fields are not in it.
        if isinstance(notification, dict):
            upgrade_show_when(notification)
            upgrade_terms(notification)
            upgrade_buttons(notification)
    config: ConfigData = _structure(CONFIG_SCHEMA, data, "configuration")
    for notification in config["notifications"]:
        upgrade_listed(notification)
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
        for number, group in enumerate(notification["entity_groups"], start=1):
            where = _path(
                "notifications", notification["name"], f"entity group {number}"
            )
            for button, actions in group["actions"].items():
                _validate_actions(actions, _path(where, button))
            for entity_id, buttons in group["member_actions"].items():
                for button, actions in buttons.items():
                    _validate_actions(actions, _path(where, entity_id, button))
    for category in config["categories"]:
        _check_category_channels_complete(category)
    order_modes(config["modes"])
    _check_references(config)
    return config


def _known_people(hass: HomeAssistant, data: dict[str, Any]) -> list[str]:
    """Return the person entities of Home Assistant and of the settings."""
    people = {state.entity_id for state in hass.states.async_all("person")}
    for person in data.get("people") or []:
        if isinstance(person, dict) and isinstance(person.get("person"), str):
            people.add(person["person"])
    return sorted(people)


def order_modes(modes: list[dict[str, Any]]) -> None:
    """Put Home last when it has no condition: then it is always true.

    Home with a condition is ordered like any other mode.
    """
    modes.sort(
        key=lambda mode: mode["id"] == HOME_MODE_ID and not mode.get("condition")
    )


def _check_category_channels_complete(category: dict[str, Any]) -> None:
    """Fill in the modes of a category's channels.

    A step stores only what it changes, but a category is the full setting.
    """
    for channel in category["channels"].values():
        channel.setdefault("modes", [])


def validate_item(section: str, data: Any) -> dict[str, Any]:
    """Check the structure of one item of a collection."""
    if section not in ITEM_SCHEMAS:
        raise ConfigValidationError(f"unknown section '{section}'")
    item: dict[str, Any] = _structure(ITEM_SCHEMAS[section], data, section)
    return item


def entities_references(notification: dict[str, Any]) -> set[str]:
    """Return the other notifications whose entities this one watches."""
    result: set[str] = set()
    for step in notification.get("steps") or []:
        for kind in ("trigger", "condition"):
            for item in _own_items(step, kind):
                if item.get(kind) in ENTITIES_KINDS:
                    reference = item.get("notification")
                    if reference and reference != notification.get("id"):
                        result.add(str(reference))
    return result
