"""The cards of the engine: a card, what a trigger overrides, and a state watch."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
from typing import TYPE_CHECKING, Any, Final

from homeassistant.core import (
    CALLBACK_TYPE,
    Context,
)
import homeassistant.helpers.config_validation as cv
from homeassistant.util import dt as dt_util

from .const import (
    CLOSED_DISMISSED,
    SOURCE_TRIGGER,
    STATE_ACTIVE,
    STATE_HIDDEN,
    STATE_SNOOZED,
)

if TYPE_CHECKING:
    pass

if TYPE_CHECKING:
    from .engine import Engine


_LOGGER = logging.getLogger(__name__)


PHASE_OPEN: Final = "open"
PHASE_SNOOZED: Final = "snoozed"
PHASE_CLOSED: Final = "closed"

type CardKey = tuple[str, str, str]


def as_period(value: Any) -> timedelta | None:
    """Return a time given as a duration dict or a timedelta."""
    if not value:
        return None
    if isinstance(value, timedelta):
        return value
    period: timedelta = cv.positive_time_period_dict(value)
    return period


def parse_iso(value: str | None) -> datetime | None:
    """Return a stored time as a datetime, or None."""
    return dt_util.parse_datetime(value) if value else None


@dataclass(slots=True)
class Card:
    """One card of a step: the step itself, or one entity of it."""

    notification_id: str
    step_id: str
    entity_id: str | None
    phase: str
    since: datetime
    state_since: datetime
    source: str = SOURCE_TRIGGER
    hidden: bool = False
    snoozed_until: datetime | None = None
    closed_reason: str | None = None
    closed_at: datetime | None = None
    # A listed entity's closed card blocks a new one until the entity stops
    # matching: a dismissed or done card does not come back by itself.
    blocked: bool = False
    # The channels were silenced (Keep it, stop light, speaker and push).
    silenced: bool = False
    # Closed because the entity stopped matching (a status): the card does
    # not stay as done today, the notification just goes back to idle.
    transient: bool = False
    trigger: dict[str, Any] | None = None
    data: dict[str, Any] = field(default_factory=dict)
    message_override: str | None = None
    info_override: str | None = None
    attachments: list[dict[str, Any]] | None = None
    message: str | None = None
    info: str | None = None
    # The step's custom data text (after the label), rendered.
    data_text: str | None = None
    # A scheduled card closes as expired at this time.
    expires_at: datetime | None = None
    # When the card last opened (or came back from a snooze): the channels
    # count their delay from here.
    active_since: datetime | None = None

    @property
    def key(self) -> CardKey:
        """Return the key of the card."""
        return (self.notification_id, self.step_id, self.entity_id or "")

    @property
    def status(self) -> str:
        """Return the state of the card, including how it closed."""
        if self.phase == PHASE_OPEN:
            return STATE_HIDDEN if self.hidden else STATE_ACTIVE
        if self.phase == PHASE_SNOOZED:
            return STATE_SNOOZED
        return self.closed_reason or CLOSED_DISMISSED

    @property
    def is_open(self) -> bool:
        """Return whether the card is open or snoozed (not closed)."""
        return self.phase != PHASE_CLOSED

    def as_dict(self) -> dict[str, Any]:
        """Return the card for storage and the websocket API."""
        return {
            "notification_id": self.notification_id,
            "step_id": self.step_id,
            "entity_id": self.entity_id,
            "phase": self.phase,
            "status": self.status,
            "since": self.since.isoformat(),
            "state_since": self.state_since.isoformat(),
            "source": self.source,
            "hidden": self.hidden,
            "snoozed_until": to_iso(self.snoozed_until),
            "closed_reason": self.closed_reason,
            "closed_at": to_iso(self.closed_at),
            "blocked": self.blocked,
            "silenced": self.silenced,
            "trigger": self.trigger,
            "data": self.data,
            "message_override": self.message_override,
            "info_override": self.info_override,
            "attachments": self.attachments,
            "message": self.message,
            "info": self.info,
            "data_text": self.data_text,
            "expires_at": to_iso(self.expires_at),
            "active_since": to_iso(self.active_since),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Card:
        """Return a card read from storage."""
        since = parse_iso(data.get("since")) or dt_util.utcnow()
        return cls(
            notification_id=data["notification_id"],
            step_id=data["step_id"],
            entity_id=data.get("entity_id"),
            phase=data["phase"],
            since=since,
            state_since=parse_iso(data.get("state_since")) or since,
            source=data.get("source", SOURCE_TRIGGER),
            hidden=bool(data.get("hidden", False)),
            snoozed_until=parse_iso(data.get("snoozed_until")),
            closed_reason=data.get("closed_reason"),
            closed_at=parse_iso(data.get("closed_at")),
            blocked=bool(data.get("blocked", False)),
            silenced=bool(data.get("silenced", False)),
            trigger=data.get("trigger"),
            data=dict(data.get("data") or {}),
            message_override=data.get("message_override"),
            info_override=data.get("info_override"),
            attachments=data.get("attachments"),
            message=data.get("message"),
            info=data.get("info"),
            data_text=data.get("data_text"),
            expires_at=parse_iso(data.get("expires_at")),
            active_since=parse_iso(data.get("active_since")),
        )


def custom_data_text(step: Mapping[str, Any]) -> str | None:
    """Return the custom data text of a step, if it has one."""
    data = step.get("data") or {}
    return data.get("text") if data.get("type") == "custom" else None


def to_iso(value: datetime | None) -> str | None:
    """Return a time as text for storing, or None."""
    return value.isoformat() if value is not None else None


@dataclass(slots=True)
class Overrides:
    """What the trigger action gives a card instead of the step's own."""

    message: str | None = None
    info: str | None = None
    attachments: list[dict[str, Any]] | None = None
    data: dict[str, Any] | None = None


@dataclass(slots=True)
class StateWatch:
    """A Notification state trigger: report when a step reaches a state.

    ``notification`` is a notification's id or its sensor's entity id;
    ``step`` is a step's id or its number.
    """

    notification: str
    step: str | int | None
    state: str
    for_: timedelta | None
    action: Callable[[dict[str, Any], Context | None], None]
    timers: dict[CardKey, CALLBACK_TYPE] = field(default_factory=dict)

    def applies_to(self, engine: Engine, card: Card) -> bool:
        """Return whether the watch is about a card."""
        if engine.resolve_notification(self.notification) != card.notification_id:
            return False
        if self.step is None:
            return True
        if isinstance(self.step, int):
            return engine.step_number(card.notification_id, card.step_id) == self.step
        return card.step_id == self.step

    def cancel_all(self) -> None:
        """Cancel the waiting ``for`` timers."""
        for cancel in self.timers.values():
            cancel()
        self.timers.clear()
