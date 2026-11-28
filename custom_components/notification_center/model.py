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

from collections.abc import Callable, Iterable, Mapping
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
    "colors",
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
    "colors",
    "categories",
    "notifications",
)

HOME_MODE_ID: Final = "home"
GENERAL_CATEGORY_ID: Final = "general"

# Channel keys: the Dashboard (the panel and the dashboard cards) and Push
# are single channels, every light, speaker and siren is its own channel,
# keyed by its id.
CHANNEL_DASHBOARD: Final = "dashboard"
CHANNEL_PUSH: Final = "push"
CHANNEL_LIGHT_PREFIX: Final = "light:"
CHANNEL_SPEAKER_PREFIX: Final = "speaker:"
CHANNEL_SIREN_PREFIX: Final = "siren:"
# How a push notification alerts: silently, normally, through Focus
# (time-sensitive), or through mute and Do Not Disturb (critical).
PUSH_PRIORITIES: Final = ("silent", "normal", "time_sensitive", "critical")
PUSH_PRIORITY_DEFAULT: Final = "normal"
# The phones a person gets push notifications on.
DEVICE_TYPES: Final = ("ios", "android", "other")
# The device sections and the prefix of their channel keys.
DEVICE_PREFIXES: Final = {
    "lights": CHANNEL_LIGHT_PREFIX,
    "speakers": CHANNEL_SPEAKER_PREFIX,
    "sirens": CHANNEL_SIREN_PREFIX,
}

# The RGB of Home Assistant's system colours (its default theme), by name: a
# category's or notification's colour is one of them or an own colour (the
# Colors list) by its id.
SYSTEM_COLORS: Final[dict[str, tuple[int, int, int]]] = {
    "primary": (3, 169, 244),
    "accent": (255, 152, 0),
    "red": (244, 67, 54),
    "pink": (233, 30, 99),
    "purple": (146, 107, 199),
    "deep-purple": (110, 65, 171),
    "indigo": (63, 81, 181),
    "blue": (33, 150, 243),
    "light-blue": (3, 169, 244),
    "cyan": (0, 188, 212),
    "teal": (0, 150, 136),
    "green": (76, 175, 80),
    "light-green": (139, 195, 74),
    "lime": (205, 220, 57),
    "yellow": (255, 235, 59),
    "amber": (255, 193, 7),
    "orange": (255, 152, 0),
    "deep-orange": (255, 111, 34),
    "brown": (121, 85, 72),
    "light-grey": (189, 189, 189),
    "grey": (158, 158, 158),
    "dark-grey": (96, 96, 96),
    "blue-grey": (96, 125, 139),
    "black": (0, 0, 0),
    "white": (255, 255, 255),
}

# A notification's chime that plays nothing, even when its category has one.
CHIME_NONE: Final = "none"
# What a category without a chime of its own plays.
CHIME_DEFAULT: Final = "nc_chime"

# The sounds that come with the integration, by chime id: their file and
# name. A chime of the Chimes list can be any other media.
BUILTIN_CHIMES: Final = {
    "nc_chime": ("chime.mp3", "Chime"),
    "nc_attention": ("attention.mp3", "Attention"),
    "nc_doorbell": ("doorbell.mp3", "Doorbell"),
    "nc_alarm": ("alarm.mp3", "Alarm"),
    "nc_alarm_indoor": ("alarm-indoor.mp3", "Indoor alarm"),
}
# How a light shows that a notification is highlighted: its own pulse
# (Notification Pulse), or one of the light's effects (by name).
EFFECT_PULSE: Final = "notification_pulse"

BUILTIN_BUTTONS: Final = ("tap", "done", "snooze", "dismiss", "mute")
BUTTON_TYPES: Final = (*BUILTIN_BUTTONS, "custom")
# The order of the buttons in the editors.
INTERACTION_ORDER: Final = ("tap", "done", "dismiss", "snooze", "mute", "custom")
# What a built-in button does to the card; the others only run their action.
# Mute keeps the card and stops its lights, speakers and sirens.
BUTTON_EFFECTS: Final = {
    "done": "done",
    "dismiss": "dismiss",
    "snooze": "snooze",
    "mute": "mute",
}
# The notification state an own button or the Tap can set (unchanged: none).
BUTTON_STATES: Final = ("unchanged", "done", "dismiss", "snooze", "mute")
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
DEFAULT_SNOOZE_CHOICES: Final = ("3h", "tomorrow")
# How long a Snooze button, or an own button with the Snooze state, snoozes
# when nothing else is chosen (its Snooze for).
DEFAULT_SNOOZE_FOR: Final = "1h"
DEFAULT_STATE_SNOOZE: Final = DEFAULT_SNOOZE_FOR
WEEKDAYS: Final = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
INTERVAL_UNITS: Final = ("days", "weeks", "months", "years")

# Triggers and conditions of the integration itself. Their full behaviour
# comes with the engine; the schema is checked here already.
TRIGGER_ENTITIES_STATE: Final = f"{DOMAIN}.entities_state"
TRIGGER_ENTITIES_NUMERIC: Final = f"{DOMAIN}.entities_numeric_state"
# Both watch the entities a notification lists (its Entities block).
ENTITIES_KINDS: Final = (TRIGGER_ENTITIES_STATE, TRIGGER_ENTITIES_NUMERIC)
TRIGGER_NOTIFICATION_STATE: Final = f"{DOMAIN}.notification_state"
NOTIFICATION_STATES: Final = ("active", "done", "snoozed", "dismissed")


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


# How a card stands out: Normal (none) or one of the card's highlights. Any
# highlight also makes the lights show their effect.
HIGHLIGHTS = ("none", "pulse", "glow", "alert")


def _highlight(value: Any) -> str:
    """Validate a highlight."""
    return str(vol.In(HIGHLIGHTS)(value))


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

# A push device of a person: a notify action and how it shows a push. A
# switched-off device (``enabled: false``) gets no push; there is no switch
# for it in the UI yet.
PUSH_DEVICE_SCHEMA = _with_id(
    {
        vol.Required("notify"): cv.string,
        vol.Optional("device_type", default="other"): vol.In(DEVICE_TYPES),
        vol.Optional("enabled", default=True): cv.boolean,
    }
)

PERSON_SCHEMA = vol.Schema(
    {
        vol.Required("person"): cv.entity_domain("person"),
        vol.Optional("push_devices", default=list): vol.All(
            cv.ensure_list, [PUSH_DEVICE_SCHEMA]
        ),
        # When the person is asleep (only counted at home), set like the
        # condition of a mode.
        vol.Optional("sleep"): _optional(MODE_CONDITION_SCHEMA),
    }
)

LIGHT_SCHEMA = _with_id(
    {
        # A light, or a switch (a lamp on a plug): on, or pulsing.
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
        # How a highlighted notification shows: ``notification_pulse`` (own)
        # or an effect of the light.
        vol.Optional("effect", default=EFFECT_PULSE): cv.string,
        # The light's own RGB for the system and own colours (only what
        # differs).
        vol.Optional("colors", default=dict): vol.Schema({cv.string: _rgb}),
    }
)

# An own colour of the Colors list: a name and its RGB, on the cards and on
# the lights (a light can show it with its own RGB, see its ``colors``).
COLOR_SCHEMA = _with_id(
    {
        vol.Required("name"): cv.string,
        vol.Required("rgb"): _rgb,
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

# A speaker's repeat until done or muted: Once, Loop (again and again,
# without a pause) or Recurring (every so often). ``times`` is how many
# times it plays in all (empty: until done or muted).
_TIMES = vol.Any(None, vol.All(vol.Coerce(int), vol.Range(1, 1000)))
_REPEAT_TYPES = vol.Any(
    vol.Schema({vol.Required("type"): "once"}),
    vol.Schema({vol.Required("type"): "loop", vol.Optional("times"): _TIMES}),
    vol.Schema(
        {
            vol.Required("type"): "recurring",
            vol.Required("every"): DURATION,
            vol.Optional("times"): _TIMES,
        }
    ),
)


def _repeat(value: Any) -> dict[str, Any]:
    """Validate a repeat (an empty ``times`` is not stored)."""
    repeat = dict(_REPEAT_TYPES(value))
    if repeat.get("times") is None:
        repeat.pop("times", None)
    return repeat


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
        vol.Optional("repeat"): _repeat,
        # Empty: the speaker's own volume.
        vol.Optional("volume"): vol.Any(
            None, vol.All(vol.Coerce(float), vol.Range(0, 1))
        ),
        # Off: only the message is read (default on).
        vol.Optional("play_chime"): cv.boolean,
        vol.Optional("read_the_message"): cv.boolean,
        # What is read besides the message: the notification's name and
        # the Info line.
        vol.Optional("read_name"): cv.boolean,
        vol.Optional("read_info"): cv.boolean,
    },
    CHANNEL_PUSH: {
        vol.Optional("priority"): vol.In(PUSH_PRIORITIES),
        # On: when the card closes, the push stays on the phone, silently
        # replaced by one with a closing line (default off: it goes away).
        vol.Optional("keep_when_closed"): cv.boolean,
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
    for key, given in value.items():
        kind = channel_kind(str(key))
        if kind is None:
            raise vol.Invalid(
                f"unknown channel '{key}': use dashboard, push, "
                "light:<id>, speaker:<id> or siren:<id>"
            )
        schema = vol.Schema({**_CHANNEL_COMMON, **_CHANNEL_EXTRA[kind]})
        try:
            result[str(key)] = schema(dict(given or {}))
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
        # A system colour by name, or an own colour by its id.
        vol.Optional("color"): _optional(cv.string),
        # How its cards stand out; any highlight also makes the lights pulse
        # (or show their effect).
        vol.Optional("highlight", default="none"): _highlight,
        # What the speakers play.
        vol.Optional("chime"): _optional(_id),
        vol.Optional("buttons", default=list): _category_buttons_late,
        vol.Optional("audience", default=dict): _audience,
        vol.Optional("channels", default=dict): _channels,
    }
)

# ---------------------------------------------------------------------------
# Notifications and steps

# The Expires row of Done when and Dismiss when: a card closes after a
# duration from when it became active, or on a later day at a time (``day: 0``
# is the day it became active, ``day: 1`` the next one, and so on).
EXPIRES_ON_DAY = vol.Schema(
    {
        vol.Required("day"): vol.All(vol.Coerce(int), vol.Range(0, 366)),
        vol.Required("at"): _time,
    }
)


def EXPIRES(value: Any) -> dict[str, Any]:  # noqa: N802 - used like a schema
    """Validate when a card closes by itself."""
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
        }
    ),
    vol.Schema(
        {
            vol.Required("type"): "after_last_done",
            vol.Required("every"): _non_negative_or_entity,
            vol.Required("unit"): vol.In(INTERVAL_UNITS),
            vol.Optional("at"): _optional(_time),
        }
    ),
)

# The Actions of a status block (Activation, Done when, Dismiss when, Snooze
# when, Mute when): they run when a card reaches that status, whatever
# caused it. The entity action is the card's entity's action of the block,
# set in the Entities block.
STATUS_ACTIONS_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_action", default=False): cv.boolean,
        vol.Optional("ha_actions", default=list): ACTIONS,
    }
)

ACTIVATION_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("type"): "triggers",
            # No triggers: the step starts only with the trigger action.
            vol.Optional("triggers", default=list): TRIGGERS,
            vol.Optional("actions", default=dict): STATUS_ACTIONS_SCHEMA,
        }
    ),
    vol.Schema(
        {
            vol.Required("type"): "schedule",
            vol.Required("schedule"): SCHEDULE_SCHEMA,
            vol.Optional("actions", default=dict): STATUS_ACTIONS_SCHEMA,
        }
    ),
)

# Conditions: one set of conditions. If they are not met: *Wait until they
# are met* (hide_while_not_met: the card is activated hidden and shows while
# they are met) or *Don't activate* (activate_only_while_met: no card, a
# scheduled step skips the occurrence; once active, it stays). Both on is
# kept for a later "If they are no longer met later: Hide it".
STEP_CONDITIONS_SCHEMA = vol.Schema(
    {
        vol.Optional("activate_only_while_met", default=False): cv.boolean,
        vol.Optional("hide_while_not_met", default=True): cv.boolean,
        vol.Optional("conditions", default=list): CONDITIONS,
    }
)

DONE_WHEN_SCHEMA = vol.Schema(
    {
        vol.Optional("triggers", default=list): TRIGGERS,
        # Close a card when what activated it is no longer true: its entity
        # no longer matches Notification entities, or the Conditions (with
        # Don't activate) are no longer met.
        vol.Optional("activation_conditions_no_longer_true", default=False): cv.boolean,
        # Close a card as done at a time after it became active.
        vol.Optional("expires"): _optional(EXPIRES),
        vol.Optional("actions", default=dict): STATUS_ACTIONS_SCHEMA,
    }
)

# Dismiss when: triggers that close a card as dismissed, and the time after
# it became active when it is dismissed.
DISMISS_WHEN_SCHEMA = vol.Schema(
    {
        vol.Optional("triggers", default=list): TRIGGERS,
        vol.Optional("expires"): _optional(EXPIRES),
        vol.Optional("actions", default=dict): STATUS_ACTIONS_SCHEMA,
    }
)

# Snooze when: an optional block, switched on in the step's menu. Its
# triggers snooze a card for the Snooze for of the step's Snooze button; its
# actions run whenever a card is snoozed. Switched off, it keeps its content
# but neither its triggers nor its actions run.
SNOOZE_WHEN_SCHEMA = vol.Schema(
    {
        vol.Optional("enabled", default=False): cv.boolean,
        vol.Optional("triggers", default=list): TRIGGERS,
        vol.Optional("actions", default=dict): STATUS_ACTIONS_SCHEMA,
        # Run the Activation actions again when a snooze ends.
        vol.Optional("rerun_activation", default=False): cv.boolean,
    }
)

# Mute when: the same for Mute (the card stays, its lights, speakers and
# sirens stop).
MUTE_WHEN_SCHEMA = vol.Schema(
    {
        vol.Optional("enabled", default=False): cv.boolean,
        vol.Optional("triggers", default=list): TRIGGERS,
        vol.Optional("actions", default=dict): STATUS_ACTIONS_SCHEMA,
    }
)

# Where a button takes the user, on the device it was pressed on: the
# entity's more info dialog (empty: the card's entity), a page, or the
# notification's Notification details. ``none``: Navigation is
# switched off (stored to stop inheriting the category's).
NAVIGATION_SCHEMA = vol.Any(
    vol.Schema({vol.Required("type"): "none"}),
    vol.Schema(
        {
            vol.Required("type"): "more_info",
            vol.Optional("entity_id"): _optional(cv.entity_id),
        }
    ),
    vol.Schema({vol.Required("type"): "navigate", vol.Required("path"): cv.string}),
    vol.Schema({vol.Required("type"): "details"}),
)
NAVIGATION_OFF: Final = {"type": "none"}

# What an own button or the Tap does to the card (unchanged: nothing).
NOTIFICATION_STATE_SCHEMA = vol.Schema({vol.Required("type"): vol.In(BUTTON_STATES)})
STATE_UNCHANGED: Final = {"type": "unchanged"}

# The own actions of a custom button or the Tap: the entity action, then the
# Home Assistant actions, then the notification state. Each key is inherited
# on its own (step, then category, then off). The built-in Done, Dismiss,
# Snooze and Mute buttons have none: their state's block has the actions.
BUTTON_ACTIONS_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_action"): cv.boolean,
        vol.Optional("notification_state"): NOTIFICATION_STATE_SCHEMA,
        vol.Optional("ha_actions"): ACTIONS,
    }
)
# The keys of a button's actions and their value when nothing sets them.
BUTTON_ACTION_DEFAULTS: Final[dict[str, Any]] = {
    "entity_action": False,
    "notification_state": STATE_UNCHANGED,
    "ha_actions": [],
}


def _clean_actions(kind: str, actions: dict[str, Any]) -> dict[str, Any] | None:
    """Return the own actions a button keeps, None when it has none.

    A built-in Done, Dismiss, Snooze or Mute button has no own actions. A
    custom button or the Tap keeps every key it stores, also an off one: an
    off key stops inheriting the category's.
    """
    if kind in BUTTON_EFFECTS:
        return None
    result: dict[str, Any] = {}
    if "entity_action" in actions:
        result["entity_action"] = bool(actions["entity_action"])
    if actions.get("notification_state"):
        result["notification_state"] = {"type": actions["notification_state"]["type"]}
    if "ha_actions" in actions:
        result["ha_actions"] = list(actions["ha_actions"] or [])
    return result


def _clean_navigation(button: dict[str, Any]) -> None:
    """Leave out a Navigate without a page: it goes nowhere."""
    navigation = button.get("navigation")
    if navigation is None or (
        navigation["type"] == "navigate" and not navigation.get("path")
    ):
        button.pop("navigation", None)
    else:
        button["navigation"] = {
            key: value for key, value in navigation.items() if value is not None
        }


# A button of a step. The buttons of the step's category (the five built-in
# ones and the category's custom buttons) are inherited: the step stores
# their action and only what it changes, key by key. A custom button of the
# category is linked by its id; a custom button with an id of its own is the
# step's.
BUTTON_SCHEMA = _with_id(
    {
        vol.Required("type"): vol.In(BUTTON_TYPES),
        # Left out: the category's setting.
        vol.Optional("enabled"): cv.boolean,
        # Left out on a category's button: the category's label.
        vol.Optional("label"): _optional(cv.string),
        vol.Optional("icon"): _optional(cv.icon),
        # Custom buttons and the Tap: their own actions, key by key; left
        # out: the category's, else off.
        vol.Optional("actions"): BUTTON_ACTIONS_SCHEMA,
        # Where the button takes the user (the Tap: also what a tap on the
        # push opens). Left out: the category's, else none.
        vol.Optional("navigation"): _optional(NAVIGATION_SCHEMA),
        # The Snooze button, or a button with the Snooze state: how long it
        # snoozes. Left out: the category's, else 1 hour.
        vol.Optional("snooze_for"): _optional(vol.In(SNOOZE_CHOICES)),
        # The Snooze button: the other times offered on the dashboard.
        vol.Optional("snooze"): _optional(
            vol.All(cv.ensure_list, [vol.In(SNOOZE_CHOICES)])
        ),
        # Run the actions of the status block of the state the button sets
        # (stored only when off: there is nothing to inherit).
        vol.Optional("run_state_actions"): cv.boolean,
        # Shown in the push notification (it takes effect with the push).
        vol.Optional("show_in_push"): _optional(cv.boolean),
        # Tap: run another button instead of its own actions (a built-in
        # button by its type, a custom one by its id). Left out: the
        # category's; empty: its own actions.
        vol.Optional("run_button"): _optional(cv.string),
    }
)

# A button of a category: what its notifications inherit, key by key (an
# Entity action means each notification's own entities).
CATEGORY_BUTTON_SCHEMA = _with_id(
    {
        vol.Required("type"): vol.In(BUTTON_TYPES),
        vol.Optional("enabled"): cv.boolean,
        vol.Optional("label"): _optional(cv.string),
        vol.Optional("icon"): _optional(cv.icon),
        vol.Optional("snooze"): _optional(
            vol.All(cv.ensure_list, [vol.In(SNOOZE_CHOICES)])
        ),
        vol.Optional("snooze_for"): _optional(vol.In(SNOOZE_CHOICES)),
        vol.Optional("show_in_push"): _optional(cv.boolean),
        vol.Optional("navigation"): _optional(NAVIGATION_SCHEMA),
        # The actions its notifications' button runs until they set their
        # own (custom buttons and the Tap).
        vol.Optional("actions"): BUTTON_ACTIONS_SCHEMA,
        # Tap: the button the Tap of its notifications runs instead (empty:
        # the actions).
        vol.Optional("run_button"): _optional(cv.string),
    }
)

# The built-in buttons of a new category: only Done is switched on.
CATEGORY_BUTTON_DEFAULTS: Final[dict[str, bool]] = {
    "tap": False,
    "done": True,
    "dismiss": False,
    "snooze": False,
    "mute": False,
}
# The buttons that can snooze for a time of their own.
SNOOZE_FOR_BUTTONS: Final = ("snooze", "custom", "tap")


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


def _clean_button(button: dict[str, Any], *, category: bool) -> None:
    """Leave out what a button of this kind does not use."""
    kind = button["type"]
    if "actions" in button:
        actions = _clean_actions(kind, button["actions"])
        if actions is None or (category and not actions):
            button.pop("actions")
        else:
            button["actions"] = actions
    _clean_navigation(button)
    if kind not in SNOOZE_FOR_BUTTONS or not button.get("snooze_for"):
        button.pop("snooze_for", None)
    if kind != "tap" or button.get("run_button") is None:
        button.pop("run_button", None)
    elif button.get("run_button"):
        # The Tap runs another button: its own actions are not used.
        button.pop("actions", None)
    if category or button.get("run_state_actions", True):
        # On by default and never inherited: stored only when off.
        button.pop("run_state_actions", None)
    if kind == "tap":
        button.pop("show_in_push", None)


def _buttons(value: Any) -> list[dict[str, Any]]:
    """Validate the buttons of a step.

    Every built-in button (tap, done, snooze, dismiss, mute) is listed, so that it
    has an id an entity action can point to. What is left out of a button
    comes from the category.
    """
    buttons: list[dict[str, Any]] = vol.All(cv.ensure_list, [BUTTON_SCHEMA])(
        value or []
    )
    seen = _check_builtins_once(buttons)
    missing = [
        BUTTON_SCHEMA({"type": kind}) for kind in BUILTIN_BUTTONS if kind not in seen
    ]
    buttons = missing + buttons if missing else buttons
    for button in buttons:
        _clean_button(button, category=False)
        # An empty list is the step's own: only Snooze for (at once).
        if button["type"] != "snooze" or button.get("snooze") is None:
            button.pop("snooze", None)
        else:
            button["snooze"] = _sorted_snooze(button["snooze"])
        for key in ("label", "icon", "show_in_push"):
            if button.get(key) is None:
                button.pop(key, None)
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
        _clean_button(button, category=True)
        if kind == "snooze":
            given = button.get("snooze")
            button["snooze"] = _sorted_snooze(
                DEFAULT_SNOOZE_CHOICES if given is None else given
            )
        else:
            button.pop("snooze", None)
        if kind != "tap" and button.get("show_in_push") is None:
            button["show_in_push"] = True
    return buttons


def category_custom_ids(category: dict[str, Any] | None) -> set[str]:
    """Return the ids of a category's custom buttons."""
    return {
        button["id"]
        for button in (category or {}).get("buttons", [])
        if button["type"] == "custom"
    }


def run_button_of(
    buttons: list[dict[str, Any]], tap: dict[str, Any]
) -> dict[str, Any] | None:
    """Return the switched on button a Tap runs instead of its own actions.

    A built-in button is named by its type, a custom one by its id. None:
    the Tap runs its own actions (also when that button is off or gone).
    """
    ref = tap.get("run_button") if tap.get("type") == "tap" else None
    if not ref:
        return None
    return next(
        (
            button
            for button in buttons
            if button["type"] != "tap"
            and button.get("enabled", True)
            and (button["id"] if button["type"] == "custom" else button["type"]) == ref
        ),
        None,
    )


def effective_buttons(
    category: dict[str, Any] | None, step: dict[str, Any]
) -> list[dict[str, Any]]:
    """Return a step's buttons with what they inherit from the category.

    The order: the built-in buttons, the category's custom buttons, then
    the step's own custom buttons. ``category`` is true on the inherited
    ones. Every key is filled in: ``navigation`` is None when it is off;
    ``actions`` has every key on a custom button and the Tap, and is empty
    on the other built-in buttons.
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
            base = {"id": entry["id"], "type": "custom", "show_in_push": True}
            result.append({**_merge_button(base, entry), "category": False})
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
            # What it inherited, key by key, becomes its own.
            actions = button.setdefault("actions", {})
            for key, value in (source.get("actions") or {}).items():
                actions.setdefault(key, value)
            for key in ("navigation", "snooze_for"):
                if key not in button and source.get(key):
                    button[key] = source[key]
        step["buttons"] = buttons


def _merge_button(base: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    """Merge a step's button over its category's, key by key."""
    kind = base["type"]

    def pick(key: str, default: Any) -> Any:
        if key in entry:
            return entry[key]
        return base.get(key, default)

    button: dict[str, Any] = {
        "id": entry.get("id") or base["id"],
        "type": kind,
        "enabled": entry.get("enabled", base.get("enabled", True)),
        "label": entry.get("label") or base.get("label"),
        "icon": entry.get("icon") or base.get("icon"),
        "actions": {},
        "category": True,
        "run_state_actions": entry.get("run_state_actions", True),
    }
    if kind not in BUTTON_EFFECTS:
        own = entry.get("actions") or {}
        inherited = base.get("actions") or {}
        button["actions"] = {
            key: own[key] if key in own else inherited.get(key, default)
            for key, default in BUTTON_ACTION_DEFAULTS.items()
        }
    navigation = pick("navigation", None)
    button["navigation"] = (
        None if not navigation or navigation["type"] == "none" else dict(navigation)
    )
    if kind in SNOOZE_FOR_BUTTONS:
        button["snooze_for"] = pick("snooze_for", None) or DEFAULT_SNOOZE_FOR
    if kind == "snooze":
        # Left out (None): the category's; an empty list offers only
        # Snooze for.
        own_times = entry.get("snooze")
        base_times = base.get("snooze")
        button["snooze"] = list(
            own_times
            if own_times is not None
            else base_times
            if base_times is not None
            else DEFAULT_SNOOZE_CHOICES
        )
    if kind == "tap":
        button["run_button"] = pick("run_button", None) or None
    else:
        value = entry.get("show_in_push")
        button["show_in_push"] = (
            base.get("show_in_push", True) if value is None else value
        )
    return button


def button_state(button: Mapping[str, Any]) -> str:
    """Return the notification state a button sets ("unchanged": none)."""
    effect = BUTTON_EFFECTS.get(button["type"])
    if effect is not None:
        return effect
    state = (button.get("actions") or {}).get("notification_state") or {}
    return str(state.get("type") or "unchanged")


def snooze_options(button: Mapping[str, Any]) -> list[str]:
    """Return the snooze times a Snooze button offers: Snooze for first."""
    first = button.get("snooze_for") or DEFAULT_SNOOZE_FOR
    others = [item for item in button.get("snooze") or [] if item != first]
    return [first, *others]


ENTITY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("enabled", default=True): cv.boolean,
        # Entity action per button id.
        vol.Optional("actions", default=dict): {_id: ACTIONS},
    }
)


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
ENTITY_GROUP_SCHEMA = _ENTITY_GROUP_FIELDS

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

# Image: a still of a camera or image entity, taken when a card becomes
# active; shown in the Notification details and, with ``push``, attached to
# the push.
IMAGE_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_domain(["camera", "image"]),
        vol.Optional("push", default=True): cv.boolean,
    }
)

STEP_SCHEMA = _with_id(
    {
        vol.Optional("enabled", default=True): cv.boolean,
        vol.Required("message"): cv.string,
        vol.Optional("info"): _optional(cv.string),
        vol.Optional("data"): _optional(DATA_SCHEMA),
        vol.Optional("image"): _optional(IMAGE_SCHEMA),
        vol.Optional("activation", default={"type": "triggers"}): ACTIVATION_SCHEMA,
        vol.Optional("conditions", default=dict): STEP_CONDITIONS_SCHEMA,
        vol.Optional("done_when", default=dict): DONE_WHEN_SCHEMA,
        vol.Optional("dismiss_when", default=dict): DISMISS_WHEN_SCHEMA,
        vol.Optional("snooze_when", default=dict): SNOOZE_WHEN_SCHEMA,
        vol.Optional("mute_when", default=dict): MUTE_WHEN_SCHEMA,
        vol.Optional("buttons", default=list): _buttons,
        # The people whose states differ from the category's audience.
        vol.Optional("audience", default=dict): _audience,
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
        vol.Optional("color"): _optional(cv.string),
        vol.Optional("highlight"): _optional(_highlight),
        vol.Optional("chime"): _optional(_id),
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
    "colors": COLOR_SCHEMA,
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
        vol.Optional("colors", default=list): vol.All(cv.ensure_list, [COLOR_SCHEMA]),
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
                    "color": "blue",
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

    colors = {color["id"] for color in config["colors"]} | set(SYSTEM_COLORS)

    def check_look(item: dict[str, Any], where: str) -> None:
        if item.get("chime") not in (None, CHIME_NONE) and item["chime"] not in chimes:
            raise ConfigValidationError(
                _path(where, "chime") + f": no chime '{item['chime']}'"
            )
        if item.get("color") is not None and item["color"] not in colors:
            raise ConfigValidationError(
                _path(where, "color") + f": no colour '{item['color']}'"
            )

    for category in config["categories"]:
        where = _path("categories", category["name"])
        check_look(category, where)
        check_channels(category["channels"], _path(where, "channels"))

    notifications_by_id = {item["id"]: item for item in config["notifications"]}
    for notification in config["notifications"]:
        where = _path("notifications", notification["name"])
        check_look(notification, where)
        if notification["category"] not in categories:
            raise ConfigValidationError(
                _path(where, "category") + f": no category '{notification['category']}'"
            )
        _check_unique(notification["steps"], "id", _path(where, "steps"))
        for number, step in enumerate(notification["steps"], start=1):
            step_where = _path(where, f"step {number}")
            check_channels(step["channels"], _path(step_where, "channels"))
            _check_unique(step["buttons"], "id", _path(step_where, "buttons"))
            for item_kind in ("trigger", "condition"):
                for item in _own_items(step, item_kind):
                    _check_own_reference(
                        item, item_kind, step_where, notifications_by_id
                    )


def _check_own_reference(
    item: dict[str, Any],
    item_kind: str,
    where: str,
    notifications: dict[str, dict[str, Any]],
) -> None:
    """Check the notification and step an own trigger or condition names."""
    kind = item.get(item_kind)
    reference = item.get("notification")
    label = (
        "notification state"
        if kind == TRIGGER_NOTIFICATION_STATE
        else "notification entities"
    )
    if reference is None:  # an entities condition of the notification itself
        return
    notification = notifications.get(reference)
    if notification is None:
        raise ConfigValidationError(
            _path(where, f"{label} {item_kind}") + f": no notification '{reference}'"
        )
    step = item.get("step")
    if kind != TRIGGER_NOTIFICATION_STATE or step is None:
        return
    steps = notification["steps"]
    if isinstance(step, int) or str(step).isdecimal():
        found = 1 <= int(step) <= len(steps)
    else:
        found = any(candidate["id"] == step for candidate in steps)
    if not found:
        raise ConfigValidationError(
            _path(where, f"{label} {item_kind}")
            + f": no step '{step}' in notification '{notification['name']}'"
        )


def notifications_using(config: ConfigData, notification_id: str) -> list[str]:
    """Return the names of the other notifications that refer to one."""
    users = []
    for notification in config["notifications"]:
        if notification["id"] == notification_id:
            continue
        for step in notification["steps"]:
            if any(
                item.get("notification") == notification_id
                for item_kind in ("trigger", "condition")
                for item in _own_items(step, item_kind)
            ):
                users.append(notification["name"])
                break
    return users


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


def _notification_state(value: Any) -> str:
    """Validate a notification state."""
    return cast(str, vol.In(NOTIFICATION_STATES)(cv.string(value)))


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


# The status blocks of a step, by the status a card reaches.
STATUS_BLOCKS: Final = {
    "active": "activation",
    "done": "done_when",
    "dismissed": "dismiss_when",
    "snoozed": "snooze_when",
    "muted": "mute_when",
}


def _trigger_lists(step: dict[str, Any]) -> list[list[dict[str, Any]]]:
    lists = [step["done_when"]["triggers"]]
    lists.append(step["dismiss_when"]["triggers"])
    lists.append(step["snooze_when"]["triggers"])
    lists.append(step["mute_when"]["triggers"])
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


async def _validate_triggers(
    hass: HomeAssistant, triggers: list[dict[str, Any]], where: str
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for trigger in triggers:
        kind = str(trigger.get("trigger", trigger.get("platform", "")))
        try:
            if kind in OWN_TRIGGER_SCHEMAS:
                result.append(OWN_TRIGGER_SCHEMAS[kind](trigger))
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
                result.append(OWN_CONDITION_SCHEMAS[kind](condition))
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
    await _validate_triggers(
        hass, step["dismiss_when"]["triggers"], _path(where, "dismiss when")
    )
    await _validate_triggers(
        hass, step["snooze_when"]["triggers"], _path(where, "snooze when")
    )
    await _validate_triggers(
        hass, step["mute_when"]["triggers"], _path(where, "mute when")
    )
    for block in STATUS_BLOCKS.values():
        if step[block]["actions"]["ha_actions"]:
            _validate_actions(
                step[block]["actions"]["ha_actions"],
                _path(where, block.replace("_", " "), "actions"),
            )
    for button in step["buttons"]:
        if button.get("actions", {}).get("ha_actions"):
            _validate_actions(
                button["actions"]["ha_actions"],
                _path(where, "buttons", button["type"]),
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
    drop_orphan_entity_actions(config)
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
        for button in category["buttons"]:
            if button.get("actions", {}).get("ha_actions"):
                _validate_actions(
                    button["actions"]["ha_actions"],
                    _path(
                        "categories",
                        category["name"],
                        "buttons",
                        button.get("label") or button["type"],
                    ),
                )
    order_modes(config["modes"])
    _check_references(config)
    return config


def drop_orphan_entity_actions(config: ConfigData) -> None:
    """Drop entity actions of buttons the notification does not have.

    The keys of the Entities block's actions are a button id of one of the
    notification's steps (with what it inherits from its category) or
    ``<step id>.activation``. A key that matches none is left over from a
    deleted button and never runs.
    """
    categories = {category["id"]: category for category in config["categories"]}
    for notification in config["notifications"]:
        category = categories.get(notification["category"])
        keys: set[str] = set()
        for step in notification["steps"]:
            keys.add(f"{step['id']}.activation")
            keys.update(button["id"] for button in effective_buttons(category, step))
        for entity in notification["entities"]:
            _keep_keys(entity["actions"], keys)
        for group in notification["entity_groups"]:
            _keep_keys(group["actions"], keys)
            for entity_id, buttons in list(group["member_actions"].items()):
                _keep_keys(buttons, keys)
                if not buttons:
                    del group["member_actions"][entity_id]


def _keep_keys(actions: dict[str, Any], keys: set[str]) -> None:
    for key in [key for key in actions if key not in keys]:
        del actions[key]


def drop_inherited_values(data: dict[str, Any]) -> None:
    """Leave out what steps' buttons store equal to their category's buttons.

    Run once on data of 0.7.9 and earlier: those versions stored the
    switches and empty actions of every button without being asked, so such
    a value was never chosen. Later, a value chosen equal to the category's
    is kept: it no longer follows the category. What a step does now stays
    the same.
    """
    categories = {
        category.get("id"): category
        for category in data.get("categories") or []
        if isinstance(category, dict)
    }
    for notification in data.get("notifications") or []:
        if not isinstance(notification, dict):
            continue
        category = categories.get(notification.get("category"))
        for step in notification.get("steps") or []:
            if isinstance(step, dict):
                _drop_step_inherited(category, step)


def _drop_step_inherited(category: dict[str, Any] | None, step: dict[str, Any]) -> None:
    if not category:
        return

    def ref(button: dict[str, Any]) -> str:
        kind = button.get("type")
        return str(button.get("id") if kind == "custom" else kind)

    bases = {
        ref(button): button
        for button in category.get("buttons") or []
        if isinstance(button, dict)
    }
    for button in step.get("buttons") or []:
        if not isinstance(button, dict):
            continue
        kind = button.get("type")
        base = bases.get(ref(button))
        if base is None or base.get("type") != kind:
            continue
        for name in ("enabled", "show_in_push", "label", "icon"):
            if name in button and button[name] == base.get(name):
                button.pop(name)
        if kind == "snooze" and button.get("snooze") == base.get("snooze"):
            button.pop("snooze", None)
        # The Tap's actions are its own Tap behavior: they stay.
        if (
            kind != "tap"
            and "actions" in button
            and button["actions"] == base.get("actions", {})
        ):
            button.pop("actions")


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
