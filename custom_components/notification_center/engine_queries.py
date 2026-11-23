"""What the engine says about the cards: states, summaries and the calendar."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta
import logging
from typing import TYPE_CHECKING, Any

from homeassistant.util import dt as dt_util

from .cards import (
    PHASE_SNOOZED,
    Card,
    as_period,
    to_iso,
)
from .const import (
    CLOSED_DONE,
    STATE_ACTIVE,
    STATE_DISABLED,
    STATE_DONE,
    STATE_HIDDEN,
    STATE_IDLE,
    STATE_SNOOZED,
    STATE_UPCOMING,
)
from .listed import ListedMatcher, matching_entities
from .model import (
    ENTITIES_KINDS,
)
from .render import render_text
from .schedule import calendar_between

if TYPE_CHECKING:
    pass

if TYPE_CHECKING:
    from .engine import Engine
    from .runner import NotificationRunner


_LOGGER = logging.getLogger(__name__)


class EngineQueries:
    """Methods of the engine, kept in their own module."""

    # -- Own conditions -----------------------------------------------------

    def check_own_condition(
        self: Engine,
        condition: Mapping[str, Any],
        notification: NotificationRunner,
        variables: Mapping[str, Any],
    ) -> bool:
        """Check a Notification entities or Notification state condition."""
        kind = condition["condition"]
        if kind in ENTITIES_KINDS:
            entities = notification.entities_of(condition.get("notification"))
            entity_id = variables.get("entity")
            if isinstance(entity_id, str) and entities.contains(entity_id):
                return ListedMatcher(condition, self.hass).matches(
                    self.hass.states.get(entity_id)
                )
            return any(True for _ in matching_entities(self.hass, entities, condition))
        return self.check_notification_state(condition)

    def check_notification_state(self: Engine, condition: Mapping[str, Any]) -> bool:
        """Check a Notification state condition."""
        notification_id = self.resolve_notification(condition["notification"])
        if notification_id is None:
            return False
        step = condition.get("step")
        step_id: str | None
        if isinstance(step, int):
            notification = self.notification_config(notification_id) or {"steps": []}
            if not 1 <= step <= len(notification["steps"]):
                return False
            step_id = notification["steps"][step - 1]["id"]
        else:
            step_id = step
        state: str = condition["state"]
        if (within := as_period(condition.get("within"))) is not None:
            reached = self.last_reached(notification_id, step_id, state)
            return reached is not None and dt_util.utcnow() - reached <= within
        needed = as_period(condition.get("for")) or timedelta()
        now = dt_util.utcnow()
        start = dt_util.start_of_local_day()
        for card in self.cards_of(notification_id, step_id):
            if card.status != state:
                continue
            if state == CLOSED_DONE and (
                card.closed_at is None or card.closed_at < start
            ):
                continue
            if now - card.state_since >= needed:
                return True
        return False

    # -- Views for entities and the websocket API ---------------------------

    def notification_state(self: Engine, notification_id: str) -> str:
        """Return the state of a notification's sensor."""
        notification = self.notification_config(notification_id)
        if notification is None or not notification.get("enabled", True):
            return STATE_DISABLED
        statuses = {card.status for card in self._visible_cards(notification_id)}
        next_due = self.next_due(notification_id)
        if next_due is not None and next_due < dt_util.start_of_local_day() + timedelta(
            days=1
        ):
            statuses.add(STATE_UPCOMING)
        for state in (
            STATE_ACTIVE,
            STATE_HIDDEN,
            STATE_SNOOZED,
            STATE_UPCOMING,
            STATE_DONE,
        ):
            if state in statuses:
                return state
        return STATE_IDLE

    def next_due(self: Engine, notification_id: str) -> datetime | None:
        """Return when a scheduled step of a notification is next due."""
        runner = self.runners.get(notification_id)
        if runner is None:
            return None
        times = [
            step.schedule.next
            for step in runner.steps.values()
            if step.schedule is not None and step.schedule.next is not None
        ]
        return min(times) if times else None

    def upcoming(self: Engine, notification_id: str) -> list[dict[str, str]]:
        """Return when each scheduled step of a notification is next due."""
        runner = self.runners.get(notification_id)
        if runner is None:
            return []
        return [
            {
                "step_id": step.step_id,
                "due": dt_util.as_utc(step.schedule.next).isoformat(),
            }
            for step in runner.steps.values()
            if step.schedule is not None and step.schedule.next is not None
        ]

    def _visible_cards(self: Engine, notification_id: str) -> list[Card]:
        """Return the open cards and the ones done today, in step order."""
        notification = self.notification_config(notification_id) or {"steps": []}
        order = {step["id"]: index for index, step in enumerate(notification["steps"])}
        start = dt_util.start_of_local_day()
        cards = [
            card
            for card in self.cards_of(notification_id)
            if card.is_open
            or (
                card.closed_reason == CLOSED_DONE
                and not card.transient
                and card.closed_at is not None
                and card.closed_at >= start
            )
        ]
        return sorted(cards, key=lambda card: (order.get(card.step_id, 0), card.since))

    def top_card(self: Engine, notification_id: str) -> Card | None:
        """Return the card a notification shows first."""
        cards = self._visible_cards(notification_id)
        for state in (STATE_ACTIVE, STATE_HIDDEN, STATE_SNOOZED, STATE_DONE):
            for card in cards:
                if card.status == state:
                    return card
        return None

    def notification_attributes(self: Engine, notification_id: str) -> dict[str, Any]:
        """Return the attributes of a notification's sensor."""
        cards = self._visible_cards(notification_id)
        top = self.top_card(notification_id)
        snoozed = [
            card.snoozed_until
            for card in cards
            if card.phase == PHASE_SNOOZED and card.snoozed_until
        ]
        notification = self.notification_config(notification_id) or {}
        category = next(
            (
                item["name"]
                for item in self._config["categories"]
                if item["id"] == notification.get("category")
            ),
            None,
        )
        last_done = self.last_reached(notification_id, None, CLOSED_DONE)
        return {
            "active_count": sum(card.status == STATE_ACTIVE for card in cards),
            "active_step": (
                self.step_number(notification_id, top.step_id)
                if top is not None and top.is_open
                else None
            ),
            "active_since": (
                top.since.isoformat() if top is not None and top.is_open else None
            ),
            "entities": [
                card.entity_id for card in cards if card.is_open and card.entity_id
            ],
            "message": top.message if top is not None else None,
            "snoozed_until": min(snoozed).isoformat() if snoozed else None,
            "next_due": to_iso(self.next_due(notification_id)),
            "last_done": last_done.isoformat() if last_done else None,
            "category": category,
        }

    def summary(self: Engine) -> dict[str, Any]:
        """Return the state and attributes of the summary sensor."""
        counts: dict[str, int] = {}
        categories = {item["id"]: item["name"] for item in self._config["categories"]}
        total = 0
        top: dict[str, Any] | None = None
        for notification in self._config["notifications"]:
            if not notification.get("enabled", True):
                continue
            active = [
                card
                for card in self._visible_cards(notification["id"])
                if card.status == STATE_ACTIVE
            ]
            if not active:
                continue
            total += len(active)
            name = categories.get(notification["category"], notification["category"])
            counts[name] = counts.get(name, 0) + len(active)
            if top is None:
                top = {
                    "notification": self.entity_id_of(notification["id"]),
                    "message": active[0].message,
                }
        return {
            "state": total,
            "mode": self.modes.current["name"] if self.modes.current else None,
            "categories": counts,
            "top_notification": top["notification"] if top else None,
            "top_message": top["message"] if top else None,
        }

    def _card_state(self: Engine, card: Card) -> dict[str, Any]:
        data = card.as_dict()
        # For a card not active, only who it is for counts (``audience``).
        data["dashboard"] = self.channel_view(card).as_dict()
        return data

    def snapshot(self: Engine) -> dict[str, Any]:
        """Return every notification's state and cards for the websocket API."""
        return {
            "mode": self.modes.current["id"] if self.modes.current else None,
            "people": self.person_states,
            "notifications": {
                notification["id"]: {
                    "state": self.notification_state(notification["id"]),
                    "entity_id": self.entity_id_of(notification["id"]),
                    "cards": [
                        self._card_state(card)
                        for card in self._visible_cards(notification["id"])
                    ],
                    "last_done": to_iso(
                        self.last_reached(notification["id"], None, CLOSED_DONE)
                    ),
                    "next_due": to_iso(self.next_due(notification["id"])),
                    "upcoming": self.upcoming(notification["id"]),
                }
                for notification in self._config["notifications"]
            },
        }

    # -- Calendar -----------------------------------------------------------

    def calendar_events(
        self: Engine, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """Return the occurrences of the scheduled steps between two times.

        A calendar schedule lists every occurrence; an after-last-done one
        only the next, because the later ones depend on when it is done.
        """
        events: list[dict[str, Any]] = []
        for runner in self.runners.values():
            for step in runner.steps.values():
                schedule = step.schedule
                if schedule is None or schedule.n == 0:
                    continue
                if schedule.is_calendar:
                    times = list(
                        calendar_between(schedule.config, schedule.n, start, end)
                    )
                else:
                    due = schedule.next
                    times = [due] if due is not None and start <= due < end else []
                message, _ = render_text(
                    self.hass,
                    step.step["message"],
                    {"entity": None, "trigger": {}, "data": {}},
                    None,
                )
                events.extend(
                    {
                        "notification_id": runner.id,
                        "step_id": step.step_id,
                        "summary": runner.name,
                        "description": message,
                        "start": when,
                        "end": when + timedelta(days=1),
                        "all_day": True,
                    }
                    for when in times
                )
        return sorted(events, key=lambda event: event["start"])
