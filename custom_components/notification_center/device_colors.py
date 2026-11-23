"""Colours, chimes and highlights: what a light shows and a speaker plays."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import logging
from typing import Any, Final

from .model import (
    CHIME_DEFAULT,
    CHIME_NONE,
    SYSTEM_COLORS,
)

_LOGGER = logging.getLogger(__name__)


# A light shows the greys white (a lamp has no grey): their defaults on a light.
LIGHT_DEFAULTS: Final[dict[str, tuple[int, int, int]]] = {
    **SYSTEM_COLORS,
    "light-grey": (255, 255, 255),
    "grey": (255, 255, 255),
    "dark-grey": (255, 255, 255),
}
DEFAULT_COLOR: Final = "primary"
DEFAULT_BRIGHTNESS: Final = 70

# The settings of a light, as a light takes them from a colour.
type Rgb = tuple[int, int, int]


def parse_color(value: Any) -> Rgb | None:
    """Return the RGB of a colour given as a list, ``#rrggbb`` or ``r, g, b``."""
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return (int(value[0]), int(value[1]), int(value[2]))
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.startswith("#") and len(text) == 7:
        try:
            return (int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16))
        except ValueError:
            return None
    parts = [part.strip() for part in text.split(",")]
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    return None


def color_of(
    notification: Mapping[str, Any] | None,
    category: Mapping[str, Any] | None,
) -> str:
    """Return a notification's colour: a system colour's name or an own colour's id.

    The notification's own colour wins over its category's.
    """
    for item in (notification or {}, category or {}):
        color = item.get("color")
        if color:
            text = str(color).strip()
            name = text.lower().replace("_", "-")
            return name if name in SYSTEM_COLORS else text
    return DEFAULT_COLOR


def chime_of(
    notification: Mapping[str, Any] | None, category: Mapping[str, Any] | None
) -> str | None:
    """Return what the speakers play for a notification (None: nothing).

    The notification's own chime wins over its category's; ``none`` is no
    chime even when the category has one. A category without a chime plays
    the default one.
    """
    own = (notification or {}).get("chime")
    chime = own if own is not None else (category or {}).get("chime") or CHIME_DEFAULT
    return None if chime in (None, CHIME_NONE) else str(chime)


def highlight_of(
    notification: Mapping[str, Any] | None, category: Mapping[str, Any] | None
) -> bool:
    """Return whether a notification is highlighted on the lights.

    Every highlight of the card (Pulse, Glow, Alert) counts; Normal does not.
    """
    own = (notification or {}).get("highlight")
    if own is None:
        own = (category or {}).get("highlight")
    return own not in (None, False, "none")


def light_rgb(
    light: Mapping[str, Any],
    color: str | None,
    colors: Sequence[Mapping[str, Any]] | None = None,
) -> Rgb:
    """Return what a light shows for a colour: its own RGB, or the colour's.

    ``color`` is a system colour's name or an own colour's id (from
    ``colors``, the Colors list); an RGB given as text also works (a test).
    """
    color = color or DEFAULT_COLOR
    own = parse_color((light.get("colors") or {}).get(color))
    if own:
        return own
    if color in LIGHT_DEFAULTS:
        return LIGHT_DEFAULTS[color]
    for item in colors or []:
        if item.get("id") == color:
            rgb = parse_color(item.get("rgb"))
            if rgb:
                return rgb
    return parse_color(color) or LIGHT_DEFAULTS[DEFAULT_COLOR]


@dataclass(slots=True)
class Look:
    """What a light shows: colour, brightness and highlight."""

    rgb: Rgb
    highlight: bool
    notification_id: str | None = None
