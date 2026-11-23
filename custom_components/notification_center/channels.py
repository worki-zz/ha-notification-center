"""The rules every channel follows before it sends.

A channel of an active card sends when three things are true:

- **Modes:** the current mode is ticked for the channel. When no mode is
  active, a channel sends if it is ticked in any mode (a channel with no
  tick at all is off).
- **Delay:** the card has been active for the channel's delay.
- **Audience:** a person gets it while they are in a state ticked for them
  (At home: at home and awake, Asleep: at home and asleep, Not home). The
  home mode and the audience must both allow it; neither overrides the
  other. A channel tied to a person (the Dashboard, as each viewer is a
  person, and Push) asks each person; a channel tied to the house (a light,
  a speaker) sends when at least one person of the audience is in a ticked
  state.

When a rule becomes true later (the mode changes, the delay ends, someone
arrives home or wakes up) the channel sends then, as long as the card is
still active.

The settings of a channel come from the category; a step stores only what
it changes. The audience works the same way, person by person.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Final

from homeassistant.core import HomeAssistant

from .model import AUDIENCE_STATES, CHANNEL_DASHBOARD

PERSON_HOME: Final = "home"
PERSON_SLEEP: Final = "sleep"
PERSON_AWAY: Final = "away"

# Why a channel is not sending a card now.
REASON_OFF: Final = "off"
REASON_MODE: Final = "mode"
REASON_DELAY: Final = "delay"
REASON_AUDIENCE: Final = "audience"

_EVERY_STATE: Final = dict.fromkeys(AUDIENCE_STATES, True)


def channel_settings(
    category: dict[str, Any] | None, step: dict[str, Any] | None, key: str
) -> dict[str, Any] | None:
    """Return a channel's settings for a step: the category's, then the step's.

    None when neither the category nor the step has the channel (it is off).
    """
    base = ((category or {}).get("channels") or {}).get(key)
    own = ((step or {}).get("channels") or {}).get(key)
    if base is None and own is None:
        return None
    result: dict[str, Any] = {"modes": [], "delay": None}
    result.update(base or {})
    result.update(own or {})
    return result


def mode_allows(settings: dict[str, Any], mode_id: str | None) -> bool:
    """Return whether the channel sends in the current mode."""
    modes = settings.get("modes") or []
    if mode_id is None:
        return bool(modes)
    return mode_id in modes


def delay_of(settings: dict[str, Any]) -> timedelta:
    """Return the channel's delay (zero: at once)."""
    delay = settings.get("delay") or {}
    return timedelta(**{unit: int(amount) for unit, amount in delay.items()})


def audience_of(
    category: dict[str, Any] | None,
    step: dict[str, Any] | None,
    people: list[str],
) -> dict[str, dict[str, bool]]:
    """Return the states each person gets a step in.

    A person the category does not list gets what every listed person has
    in common (with nobody listed: every state). A person the step does not
    list gets the category's states.
    """
    base = (category or {}).get("audience") or {}
    own = (step or {}).get("audience") or {}
    common = (
        {
            state: all(entry.get(state, False) for entry in base.values())
            for state in AUDIENCE_STATES
        }
        if base
        else dict(_EVERY_STATE)
    )
    return {
        person: dict(own.get(person) or base.get(person) or common) for person in people
    }


def person_state(hass: HomeAssistant, person: str, asleep: bool) -> str:
    """Return whether a person is at home and awake, asleep, or away.

    Asleep counts only at home: a person away is away.
    """
    state = hass.states.get(person)
    if state is None or state.state != PERSON_HOME:
        return PERSON_AWAY
    return PERSON_SLEEP if asleep else PERSON_HOME


@dataclass(slots=True)
class ChannelView:
    """Whether a channel sends a card now, and to whom."""

    # The people it goes to now.
    people: list[str] = field(default_factory=list)
    # The people of the audience (in at least one state).
    audience: list[str] = field(default_factory=list)
    # Why it does not send now; None when it sends (to ``people``).
    reason: str | None = None
    # The end of the delay.
    until: datetime | None = None

    @property
    def sends(self) -> bool:
        """Return whether the channel sends to anyone now."""
        return self.reason is None

    def as_dict(self) -> dict[str, Any]:
        """Return the view for the websocket API."""
        return {
            "people": self.people,
            "audience": self.audience,
            "reason": self.reason,
            "until": self.until.isoformat() if self.until else None,
        }


def channel_view(
    settings: dict[str, Any] | None,
    *,
    mode_id: str | None,
    active_since: datetime,
    now: datetime,
    audience: dict[str, dict[str, bool]],
    states: dict[str, str],
) -> ChannelView:
    """Work out whether a channel sends an active card now.

    ``states`` holds the state of every person; with no person in Home
    Assistant the audience does not hold anything back.
    """
    members = [person for person, ticks in audience.items() if any(ticks.values())]
    view = ChannelView(audience=members)
    if settings is None or not settings.get("modes"):
        view.reason = REASON_OFF
        return view
    if not mode_allows(settings, mode_id):
        view.reason = REASON_MODE
        return view
    delay = delay_of(settings)
    if delay and now < active_since + delay:
        view.reason = REASON_DELAY
        view.until = active_since + delay
        return view
    view.people = [
        person
        for person in members
        if audience[person].get(states.get(person, PERSON_AWAY), False)
    ]
    if states and not view.people:
        view.reason = REASON_AUDIENCE
    return view


__all__ = [
    "CHANNEL_DASHBOARD",
    "PERSON_AWAY",
    "PERSON_HOME",
    "PERSON_SLEEP",
    "REASON_AUDIENCE",
    "REASON_DELAY",
    "REASON_MODE",
    "REASON_OFF",
    "ChannelView",
    "audience_of",
    "channel_settings",
    "channel_view",
    "delay_of",
    "mode_allows",
    "person_state",
]
