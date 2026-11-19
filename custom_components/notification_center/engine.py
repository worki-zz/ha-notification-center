"""The engine: it decides when a notification shows and when it goes away.

Every step of a notification has cards. A step has one card, or, with the
Listed entities trigger, one card per entity. A card is:

- **open**: it shows (state ``active``), or it is hidden while the step's
  Hide while is true (state ``hidden``);
- **snoozed** until a time;
- **closed**: done, dismissed or expired. A done card stays until the end of
  the day, so it can be shown as done today.

The cards and the time each step last reached each state (the last done
time among them) are saved in ``.storage/notification_center.runtime``, so
they survive a restart.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
import logging
from typing import Any, Final, cast

from homeassistant.core import (
    CALLBACK_TYPE,
    Context,
    HomeAssistant,
    State,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.condition import (
    ConditionsChecker,
    async_conditions_from_config,
    async_extract_entities,
    async_validate_conditions_config,
)
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_state_change_event,
    async_track_time_change,
)
from homeassistant.helpers.script import Script, async_validate_actions_config
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.helpers.trigger import (
    async_extract_entities as async_extract_trigger_entities,
    async_initialize_triggers,
    async_validate_trigger_config,
)
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey
import voluptuous as vol

from .const import (
    CLOSED_DISMISSED,
    CLOSED_DONE,
    CLOSED_EXPIRED,
    DOMAIN,
    EVENT_ACTIVE,
    EVENT_DISMISSED,
    EVENT_DONE,
    EVENT_EXPIRED,
    EVENT_SNOOZED,
    SOURCE_ACTION,
    SOURCE_BUTTON,
    SOURCE_DONE_WHEN,
    SOURCE_ENTITY,
    SOURCE_SCHEDULE,
    SOURCE_SNOOZE_END,
    SOURCE_TRIGGER,
    STATE_ACTIVE,
    STATE_DISABLED,
    STATE_DONE,
    STATE_HIDDEN,
    STATE_IDLE,
    STATE_SNOOZED,
    STATE_UPCOMING,
    UNIQUE_ID_NOTIFICATION_PREFIX,
)
from .issues import IssueTracker
from .listed import EntityList, ListedMatcher, ListedTracker, matching_entities
from .model import (
    ENTITIES_KINDS,
    TRIGGER_NOTIFICATION_STATE,
    ConfigData,
    entities_references,
)
from .modes import ModeTracker
from .render import TextTracker, render_text
from .schedule import calendar_between
from .scheduler import HISTORY_SKIPPED, StepSchedule
from .store import RUNTIME_KEY, ConfigManager

_LOGGER = logging.getLogger(__name__)

RUNTIME_VERSION: Final = 1
SAVE_DELAY: Final = 1

PHASE_OPEN: Final = "open"
PHASE_SNOOZED: Final = "snoozed"
PHASE_CLOSED: Final = "closed"

# The Notification state triggers, of the engine and of automations. They
# live outside the engine so that an automation keeps its trigger when the
# integration is reloaded.
DATA_WATCHES: HassKey[list[StateWatch]] = HassKey(f"{DOMAIN}_watches")


@callback
def async_get_engine(hass: HomeAssistant) -> Engine | None:
    """Return the engine of the loaded integration."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        return None
    engine: Engine = entries[0].runtime_data.engine
    return engine


@callback
def async_add_state_watch(hass: HomeAssistant, watch: StateWatch) -> CALLBACK_TYPE:
    """Report a Notification state trigger until the returned call."""
    watches = hass.data.setdefault(DATA_WATCHES, [])
    watches.append(watch)

    @callback
    def remove() -> None:
        watch.cancel_all()
        if watch in watches:
            watches.remove(watch)

    return remove


# Conditions that change with time, not with an entity: a Hide while that
# holds one of them is checked again every minute.
_TIMED_CONDITIONS: Final = frozenset({"time", "sun", "template", "trigger"})

type CardKey = tuple[str, str, str]
type ChangeListener = Callable[[], None]
type EventListener = Callable[[str, dict[str, Any]], None]


def _jsonable(value: Any) -> Any:
    """Return a value that can be stored as JSON and used in templates."""
    if isinstance(value, State):
        return {
            "entity_id": value.entity_id,
            "state": value.state,
            "name": value.name,
            "attributes": _jsonable(dict(value.attributes)),
            "last_changed": value.last_changed.isoformat(),
        }
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _period(value: Any) -> timedelta | None:
    """Return a time given as a duration dict or a timedelta."""
    if not value:
        return None
    if isinstance(value, timedelta):
        return value
    period: timedelta = cv.positive_time_period_dict(value)
    return period


def _parse_time(value: str | None) -> datetime | None:
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
            "snoozed_until": _iso(self.snoozed_until),
            "closed_reason": self.closed_reason,
            "closed_at": _iso(self.closed_at),
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
            "expires_at": _iso(self.expires_at),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Card:
        """Return a card read from storage."""
        since = _parse_time(data.get("since")) or dt_util.utcnow()
        return cls(
            notification_id=data["notification_id"],
            step_id=data["step_id"],
            entity_id=data.get("entity_id"),
            phase=data["phase"],
            since=since,
            state_since=_parse_time(data.get("state_since")) or since,
            source=data.get("source", SOURCE_TRIGGER),
            hidden=bool(data.get("hidden", False)),
            snoozed_until=_parse_time(data.get("snoozed_until")),
            closed_reason=data.get("closed_reason"),
            closed_at=_parse_time(data.get("closed_at")),
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
            expires_at=_parse_time(data.get("expires_at")),
        )


def _custom_data(step: Mapping[str, Any]) -> str | None:
    """Return the custom data text of a step, if it has one."""
    data = step.get("data") or {}
    return data.get("text") if data.get("type") == "custom" else None


def _iso(value: datetime | None) -> str | None:
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


def trigger_context(trigger: dict[str, Any], context: Context | None) -> Context | None:
    """Return the context behind a trigger: the one given, or its state's."""
    if context is not None:
        return context
    if trigger.get("initial"):
        # The entity already matched when the notification was loaded.
        return None
    state = trigger.get("to_state")
    return state.context if isinstance(state, State) else None


class _Conditions:
    """Home Assistant conditions together with the integration's own ones."""

    def __init__(
        self,
        engine: Engine,
        notification: NotificationRunner,
        own: list[dict[str, Any]],
        checker: ConditionsChecker | None,
    ) -> None:
        self._engine = engine
        self._notification = notification
        self._own = own
        self._checker = checker

    @property
    def empty(self) -> bool:
        return not self._own and self._checker is None

    def check(self, variables: Mapping[str, Any]) -> bool:
        """Return whether every condition is true."""
        for condition in self._own:
            if not self._engine.check_own_condition(
                condition, self._notification, variables
            ):
                return False
        if self._checker is not None:
            return self._checker(dict(variables))
        return True

    def unload(self) -> None:
        if self._checker is not None:
            self._checker.async_unload()


async def _async_conditions(
    engine: Engine,
    notification: NotificationRunner,
    configs: list[dict[str, Any]],
    name: str,
) -> tuple[_Conditions, set[str], bool]:
    """Compile conditions; return them, their entities and if time matters."""
    own = [c for c in configs if str(c.get("condition", "")).startswith(f"{DOMAIN}.")]
    others = [c for c in configs if c not in own]
    checker: ConditionsChecker | None = None
    entities: set[str] = set()
    timed = False
    if others:
        validated = await async_validate_conditions_config(
            engine.hass, cv.CONDITIONS_SCHEMA(others)
        )
        checker = await async_conditions_from_config(
            engine.hass,
            cast(list[dict[str, Any]], validated),
            _LOGGER,
            name,
        )
        for condition in validated:
            entities |= async_extract_entities(condition)
            timed |= _is_timed(condition)
    return _Conditions(engine, notification, own, checker), entities, timed


def _is_timed(condition: Any) -> bool:
    if not isinstance(condition, Mapping):
        return True  # a template shorthand
    if condition.get("condition") in _TIMED_CONDITIONS:
        return True
    return any(_is_timed(item) for item in condition.get("conditions", []))


class StepRunner:
    """Run one step: start it, hide it and close it."""

    def __init__(
        self,
        engine: Engine,
        notification: NotificationRunner,
        step: dict[str, Any],
        number: int,
    ) -> None:
        """Set up the step; call ``async_start`` to begin."""
        self.engine = engine
        self.hass = engine.hass
        self.notification = notification
        self.step = step
        self.number = number
        self.step_id: str = step["id"]
        self._unsubs: list[CALLBACK_TYPE] = []
        self._trackers: list[ListedTracker] = []
        self._watches: list[StateWatch] = []
        self._start_trackers: list[ListedTracker] = []
        self.start_conditions: _Conditions | None = None
        self.hide_while: _Conditions | None = None
        self.hide_timed = False
        self._hide_entities: set[str] = set()
        self.schedule: StepSchedule | None = None
        self._start_timed = False
        # For Repairs: what failed to set up, and the entities it uses.
        self.errors: list[str] = []
        self.referenced: set[str] = set()

    @property
    def name(self) -> str:
        """Return a name for logs."""
        return f"{self.notification.name} step {self.number}"

    @property
    def is_listed(self) -> bool:
        """Return whether the step starts with Listed entities."""
        return bool(self._start_trackers)

    async def async_start(self) -> None:
        """Set up the triggers and conditions of the step."""
        start = self.step["start"]
        (
            self.start_conditions,
            start_entities,
            self._start_timed,
        ) = await _async_conditions(
            self.engine,
            self.notification,
            start.get("conditions", []),
            f"{self.name} conditions",
        )
        self.hide_while, self._hide_entities, self.hide_timed = await _async_conditions(
            self.engine,
            self.notification,
            self.step.get("hide_while", []),
            f"{self.name} hide while",
        )
        self.referenced |= start_entities | self._hide_entities
        if start["type"] == "schedule":
            self.schedule = StepSchedule(self, start["schedule"])
            # A due card is hidden while the Start conditions are not true.
            self._hide_entities |= start_entities
            self.hide_timed |= self._start_timed
        if self._hide_entities:
            self._unsubs.append(
                async_track_state_change_event(
                    self.hass, sorted(self._hide_entities), self._hide_changed
                )
            )
        if start["type"] == "triggers":
            await self._async_setup_triggers(
                start.get("triggers", []),
                self._start_fired,
                (self._start_listed, self._start_unmatched),
                start=True,
            )
        await self._async_setup_triggers(
            self.step["done_when"].get("triggers", []),
            self._done_fired,
            (self._done_listed, self._done_unmatched),
        )

    @callback
    def async_stop(self) -> None:
        """Remove every listener of the step."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for tracker in self._trackers:
            tracker.async_stop()
        self._trackers.clear()
        self._start_trackers.clear()
        for watch in self._watches:
            self.engine.remove_watch(watch)
        self._watches.clear()
        if self.schedule is not None:
            self.schedule.async_stop()
        for conditions in (self.start_conditions, self.hide_while):
            if conditions is not None:
                conditions.unload()

    async def _async_setup_triggers(
        self,
        triggers: list[dict[str, Any]],
        fired: Callable[[dict[str, Any], Context | None], None],
        listed: tuple[
            Callable[[str, dict[str, Any]], None],
            Callable[[str, Context | None], None],
        ],
        *,
        start: bool = False,
    ) -> None:
        others: list[dict[str, Any]] = []
        for trigger in triggers:
            kind = trigger.get("trigger", trigger.get("platform"))
            if kind in ENTITIES_KINDS:
                tracker = ListedTracker(
                    self.hass,
                    self.notification.entities_of(trigger.get("notification")),
                    trigger,
                    *listed,
                )
                self._trackers.append(tracker)
                if start:
                    self._start_trackers.append(tracker)
            elif kind == TRIGGER_NOTIFICATION_STATE:
                self._add_watch(trigger, fired)
            else:
                others.append(trigger)
        if others:
            try:
                validated = await async_validate_trigger_config(
                    self.hass, cv.TRIGGER_SCHEMA(others)
                )
            except (HomeAssistantError, ValueError) as err:
                _LOGGER.error("Invalid trigger in %s: %s", self.name, err)
                self.errors.append(str(err))
                return
            for conf in validated:
                with suppress(Exception):
                    self.referenced |= set(async_extract_trigger_entities(conf))
            unsub = await async_initialize_triggers(
                self.hass,
                validated,
                self._ha_trigger_action(fired),
                DOMAIN,
                self.name,
                self._log,
            )
            if unsub is not None:
                self._unsubs.append(unsub)

    def _ha_trigger_action(
        self, fired: Callable[[dict[str, Any], Context | None], None]
    ) -> Callable[[dict[str, Any], Context | None], None]:
        @callback
        def action(
            run_variables: dict[str, Any], context: Context | None = None
        ) -> None:
            fired(dict(run_variables.get("trigger", {})), context)

        return action

    @callback
    def _log(self, level: int, msg: str, **kwargs: Any) -> None:
        _LOGGER.log(level, "%s %s", msg, self.name, **kwargs)

    @callback
    def start_listed_trackers(self) -> None:
        """Start the Listed entities and the schedule (after cards are restored)."""
        for tracker in self._trackers:
            tracker.async_start()
        if self.schedule is not None:
            self.schedule.async_start()
        if self.step["done_when"].get("start_no_longer_true"):
            for card in self.engine.cards_of(self.notification.id, self.step_id):
                if (
                    card.entity_id is not None
                    and card.is_open
                    and not self.start_matching(card.entity_id)
                ):
                    self.engine.close(card, CLOSED_DONE, SOURCE_ENTITY, transient=True)

    def _add_watch(
        self,
        trigger: dict[str, Any],
        fired: Callable[[dict[str, Any], Context | None], None],
    ) -> None:
        period = trigger.get("for")

        @callback
        def action(variables: dict[str, Any], context: Context | None) -> None:
            fired(variables, context)

        watch = StateWatch(
            notification=trigger["notification"],
            step=trigger.get("step"),
            state=trigger["state"],
            for_=_period(period),
            action=action,
        )
        self._watches.append(watch)
        self.engine.add_watch(watch)

    # -- Start --------------------------------------------------------------

    @callback
    def _start_fired(self, trigger: dict[str, Any], context: Context | None) -> None:
        entity_id = trigger.get("entity_id") if self.is_listed else None
        variables = {
            "trigger": trigger,
            "entity": entity_id or trigger.get("entity_id"),
        }
        if self.start_conditions is not None and not self.start_conditions.check(
            variables
        ):
            return
        self.engine.open(
            self,
            entity_id if isinstance(entity_id, str) else None,
            trigger,
            SOURCE_TRIGGER,
            context=trigger_context(trigger, context),
        )

    @callback
    def _start_listed(self, entity_id: str, trigger: dict[str, Any]) -> None:
        variables = {"trigger": trigger, "entity": entity_id}
        if self.start_conditions is not None and not self.start_conditions.check(
            variables
        ):
            return
        self.engine.open(
            self,
            entity_id,
            trigger,
            SOURCE_ENTITY,
            context=trigger_context(trigger, None),
        )

    @callback
    def _start_unmatched(self, entity_id: str, context: Context | None) -> None:
        key = (self.notification.id, self.step_id, entity_id)
        card = self.engine.cards.get(key)
        if card is None:
            return
        if not card.is_open:
            # A done card stays until midnight; the entity may open a new one.
            self.engine.forget_block(card)
            return
        if card.is_open and self.step["done_when"].get("start_no_longer_true"):
            self.engine.close(
                card, CLOSED_DONE, SOURCE_ENTITY, context=context, transient=True
            )
            self.engine.forget_block(card)

    # -- Done when ----------------------------------------------------------

    @callback
    def _done_fired(self, trigger: dict[str, Any], context: Context | None) -> None:
        cards = [
            card
            for card in self.engine.cards_of(self.notification.id, self.step_id)
            if card.is_open
        ]
        entity_id = trigger.get("entity_id")
        own = [card for card in cards if card.entity_id == entity_id]
        context = trigger_context(trigger, context)
        for card in own or cards:
            self.engine.close(card, CLOSED_DONE, SOURCE_DONE_WHEN, context=context)

    @callback
    def _done_listed(self, entity_id: str, trigger: dict[str, Any]) -> None:
        self._done_fired(trigger, None)

    @callback
    def _done_unmatched(self, entity_id: str, context: Context | None) -> None:
        """Do nothing: an entity of a Done when trigger stopped matching."""

    def start_matching(self, entity_id: str) -> bool:
        """Return whether an entity matches a Listed entities start trigger."""
        return any(tracker.is_matching(entity_id) for tracker in self._start_trackers)

    # -- Hide while ---------------------------------------------------------

    @callback
    def _hide_changed(self, *_: Any) -> None:
        self.refresh_hidden()

    @callback
    def refresh_hidden(self) -> None:
        """Check Hide while again for the open cards of the step."""
        for card in self.engine.cards_of(self.notification.id, self.step_id):
            if card.phase == PHASE_OPEN:
                self.engine.set_hidden(card, self.is_hidden(card))

    def is_hidden(self, card: Card) -> bool:
        """Return whether Hide while is true for a card.

        A scheduled card is also hidden while its Start conditions are not
        true: it waits for them until it expires.
        """
        variables = self.engine.variables(card)
        if (
            self.schedule is not None
            and self.start_conditions is not None
            and not self.start_conditions.empty
            and not self.start_conditions.check(variables)
        ):
            return True
        if self.hide_while is None or self.hide_while.empty:
            return False
        return self.hide_while.check(variables)

    @property
    def has_listed_start(self) -> bool:
        """Return whether a Notification entities trigger starts the step."""
        return any(
            trigger.get("trigger", trigger.get("platform")) in ENTITIES_KINDS
            for trigger in self.step["start"].get("triggers", [])
        )


class NotificationRunner:
    """Run the steps of one notification."""

    def __init__(self, engine: Engine, notification: dict[str, Any]) -> None:
        """Set up the notification; call ``async_start`` to begin."""
        self.engine = engine
        self.config = notification
        self.id: str = notification["id"]
        self.name: str = notification["name"]
        self.entities = EntityList(engine.hass, notification)
        # The other notifications whose entities its steps watch.
        self.references = entities_references(notification)
        self.steps: dict[str, StepRunner] = {}
        for number, step in enumerate(notification["steps"], start=1):
            if step.get("enabled", True):
                self.steps[step["id"]] = StepRunner(engine, self, step, number)

    def entities_of(self, reference: Any) -> EntityList:
        """Return the entity list of this or another notification."""
        if not reference or reference == self.id:
            return self.entities
        other_id = self.engine.resolve_notification(str(reference))
        other = self.engine.notification_config(other_id) if other_id else None
        return EntityList(self.engine.hass, other or {})

    async def async_start(self) -> None:
        """Set up every step."""
        for step in self.steps.values():
            try:
                await step.async_start()
            except Exception as err:
                _LOGGER.exception("Error setting up %s", step.name)
                step.errors.append(str(err))

    @callback
    def start_trackers(self) -> None:
        """Start the Listed entities trackers of every step."""
        for step in self.steps.values():
            step.start_listed_trackers()

    @callback
    def async_stop(self) -> None:
        """Stop every step."""
        for step in self.steps.values():
            step.async_stop()


class Engine:
    """Hold every card and run the notifications."""

    def __init__(self, hass: HomeAssistant, manager: ConfigManager) -> None:
        """Set up the engine; call ``async_load`` and ``async_start``."""
        self.hass = hass
        self.manager = manager
        self.cards: dict[CardKey, Card] = {}
        # notification id -> step id -> state -> ISO time it was last reached
        self.history: dict[str, dict[str, dict[str, str]]] = {}
        self.runners: dict[str, NotificationRunner] = {}
        self.modes = ModeTracker(hass, manager.config["modes"], self._mode_changed)
        self._store = Store[dict[str, Any]](hass, RUNTIME_VERSION, RUNTIME_KEY)
        self._listeners: list[ChangeListener] = []
        self._late_listeners: list[ChangeListener] = []
        self._event_listeners: list[EventListener] = []
        # For the Activity log the causes chain up: the entity that started
        # the change, the notification's sensor, then the summary sensor.
        # ``contexts`` is what the notification's sensor writes in;
        # ``summary_context`` (a child of it) is what the summary sensor
        # writes in during that change.
        self.contexts: dict[str, Context] = {}
        self.summary_context: Context | None = None
        self._watches = hass.data.setdefault(DATA_WATCHES, [])
        self._snooze_timers: dict[CardKey, CALLBACK_TYPE] = {}
        self._expiry_timers: dict[CardKey, CALLBACK_TYPE] = {}
        self.template_errors: dict[tuple[str, str], str] = {}
        self.issues = IssueTracker(self)
        self._text_trackers: dict[CardKey, TextTracker] = {}
        self._unsubs: list[CALLBACK_TYPE] = []
        self._started = False
        self._config = manager.config

    # -- Life cycle ---------------------------------------------------------

    async def async_load(self) -> None:
        """Read the saved cards; start the timers that do not need triggers."""
        stored = await self._store.async_load() or {}
        self.history = {
            str(nid): {str(sid): dict(states) for sid, states in steps.items()}
            for nid, steps in (stored.get("history") or {}).items()
        }
        for item in stored.get("cards") or []:
            try:
                card = Card.from_dict(item)
            except KeyError, TypeError, ValueError:
                continue
            if self._step_config(card.notification_id, card.step_id) is None:
                continue
            self.cards[card.key] = card
        self._prune()
        for card in self.cards.values():
            if card.phase == PHASE_SNOOZED:
                self._schedule_unsnooze(card)
        self._unsubs.append(self.manager.async_add_listener(self._config_changed))
        self._unsubs.append(
            async_track_time_change(
                self.hass, self._midnight, hour=0, minute=0, second=0
            )
        )
        self._unsubs.append(async_track_time_change(self.hass, self._minute, second=0))
        self._unsubs.append(async_at_started(self.hass, self._async_started))

    async def _async_started(self, _hass: HomeAssistant) -> None:
        self._started = True
        self.modes.async_start()
        for notification in self._config["notifications"]:
            await self._async_start_notification(notification)
        for card in list(self.cards.values()):
            if card.is_open:
                self._start_text(card)
        self.issues.async_start()
        self._notify()

    async def _async_start_notification(self, notification: dict[str, Any]) -> None:
        if not notification.get("enabled", True):
            return
        runner = NotificationRunner(self, notification)
        self.runners[runner.id] = runner
        await runner.async_start()
        if self.runners.get(runner.id) is not runner:
            runner.async_stop()
            return
        for step in runner.steps.values():
            for card in self.cards_of(runner.id, step.step_id):
                if card.phase == PHASE_OPEN:
                    self.set_hidden(card, step.is_hidden(card))
                if card.is_open:
                    self._schedule_expiry(card)
        runner.start_trackers()
        self.issues.refresh()
        self._notify()

    async def async_unload(self) -> None:
        """Stop everything and save the cards."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self.issues.async_stop()
        for runner in self.runners.values():
            runner.async_stop()
        self.runners.clear()
        self.modes.async_stop()
        for timers in (self._snooze_timers, self._expiry_timers):
            for cancel in timers.values():
                cancel()
            timers.clear()
        for tracker in self._text_trackers.values():
            tracker.async_stop()
        self._text_trackers.clear()
        await self._store.async_save(self._data_to_save())

    @callback
    def _config_changed(self, config: ConfigData) -> None:
        old = {item["id"]: item for item in self._config["notifications"]}
        self._config = config
        if config["modes"] != self.modes.modes:
            self.modes.async_stop()
            self.modes = ModeTracker(self.hass, config["modes"], self._mode_changed)
            if self._started:
                self.modes.async_start()
        new = {item["id"]: item for item in config["notifications"]}
        changed = {nid for nid in set(old) | set(new) if new.get(nid) != old.get(nid)}
        for nid in list(self.runners):
            # A notification watching another one's entities follows its list.
            if nid in changed or self.runners[nid].references & changed:
                self.runners.pop(nid).async_stop()
        for card in list(self.cards.values()):
            notification = new.get(card.notification_id)
            step = self._step_config(card.notification_id, card.step_id)
            if (
                notification is None
                or not notification.get("enabled", True)
                or step is None
                or not step.get("enabled", True)
            ):
                self.forget(card)
        if self._started:
            for nid, notification in new.items():
                if nid not in self.runners:
                    self.hass.async_create_task(
                        self._async_start_notification(notification),
                        eager_start=True,
                    )
        self.issues.refresh()
        self._save()
        self._notify()

    # -- Listeners ----------------------------------------------------------

    @callback
    def async_add_listener(
        self, listener: ChangeListener, *, late: bool = False
    ) -> CALLBACK_TYPE:
        """Call the listener after every change of a card or the mode.

        A late listener is called after the others: the summary sensor is
        caused by the sensor of the notification, so it changes after it.
        """
        listeners = self._late_listeners if late else self._listeners
        listeners.append(listener)

        @callback
        def remove() -> None:
            listeners.remove(listener)

        return remove

    @callback
    def async_add_event_listener(self, listener: EventListener) -> CALLBACK_TYPE:
        """Call the listener with every event (active, done, ...)."""
        self._event_listeners.append(listener)

        @callback
        def remove() -> None:
            self._event_listeners.remove(listener)

        return remove

    @callback
    def _notify(self) -> None:
        for listener in [*self._listeners, *self._late_listeners]:
            listener()

    @callback
    def _mode_changed(self) -> None:
        self._notify()

    def add_watch(self, watch: StateWatch) -> None:
        """Start reporting a Notification state trigger."""
        self._watches.append(watch)

    def remove_watch(self, watch: StateWatch) -> None:
        """Stop reporting a Notification state trigger."""
        watch.cancel_all()
        if watch in self._watches:
            self._watches.remove(watch)

    # -- Config lookups -----------------------------------------------------

    def notification_config(self, notification_id: str) -> dict[str, Any] | None:
        """Return the configuration of a notification."""
        for item in self._config["notifications"]:
            if item["id"] == notification_id:
                return dict(item)
        return None

    def _step_config(self, notification_id: str, step_id: str) -> dict[str, Any] | None:
        notification = self.notification_config(notification_id)
        if notification is None:
            return None
        for step in notification["steps"]:
            if step["id"] == step_id:
                return dict(step)
        return None

    def step_number(self, notification_id: str, step_id: str) -> int | None:
        """Return the number of a step (1 is the first)."""
        notification = self.notification_config(notification_id)
        if notification is None:
            return None
        for number, step in enumerate(notification["steps"], start=1):
            if step["id"] == step_id:
                return number
        return None

    def step_id_of(self, notification_id: str, number: int) -> str:
        """Return the id of a step by its number, or raise an error."""
        notification = self.notification_config(notification_id)
        if notification is None:
            raise ServiceValidationError(f"No notification {notification_id}")
        steps = notification["steps"]
        if not 1 <= number <= len(steps):
            raise ServiceValidationError(
                f"{notification['name']} has {len(steps)} step(s), not {number}"
            )
        return str(steps[number - 1]["id"])

    def entity_id_of(self, notification_id: str) -> str | None:
        """Return the entity id of a notification's sensor."""
        return er.async_get(self.hass).async_get_entity_id(
            "sensor", DOMAIN, UNIQUE_ID_NOTIFICATION_PREFIX + notification_id
        )

    def resolve_notification(self, reference: str) -> str | None:
        """Return a notification id from an id or its sensor's entity id."""
        if self.notification_config(reference) is not None:
            return reference
        entry = er.async_get(self.hass).async_get(reference)
        if (
            entry is not None
            and entry.platform == DOMAIN
            and entry.unique_id.startswith(UNIQUE_ID_NOTIFICATION_PREFIX)
        ):
            return entry.unique_id.removeprefix(UNIQUE_ID_NOTIFICATION_PREFIX)
        return None

    # -- Cards --------------------------------------------------------------

    def cards_of(self, notification_id: str, step_id: str | None = None) -> list[Card]:
        """Return the cards of a notification or of one of its steps."""
        return [
            card
            for card in self.cards.values()
            if card.notification_id == notification_id
            and (step_id is None or card.step_id == step_id)
        ]

    def variables(self, card: Card) -> dict[str, Any]:
        """Return the template variables of a card."""
        notification = self.notification_config(card.notification_id) or {}
        return {
            "entity": card.entity_id,
            "trigger": card.trigger or {},
            "data": card.data,
            "notification": {
                "id": card.notification_id,
                "name": notification.get("name"),
                "entity_id": self.entity_id_of(card.notification_id),
            },
        }

    @callback
    def open(
        self,
        step: StepRunner,
        entity_id: str | None,
        trigger: dict[str, Any] | None,
        source: str,
        overrides: Overrides | None = None,
        context: Context | None = None,
        *,
        since: datetime | None = None,
        expires_at: datetime | None = None,
    ) -> Card | None:
        """Open a card of a step, or refresh it if it is already open."""
        now = dt_util.utcnow()
        key = (step.notification.id, step.step_id, entity_id or "")
        card = self.cards.get(key)
        trigger_data = _jsonable(trigger) if trigger else None
        if card is not None and card.is_open:
            self._refresh(card, trigger_data, overrides)
            if expires_at is not None:
                card.expires_at = expires_at
                self._schedule_expiry(card)
            if card.phase == PHASE_SNOOZED:
                self._cancel_unsnooze(card)
                self._change(
                    card,
                    source=source,
                    context=context,
                    phase=PHASE_OPEN,
                    snoozed_until=None,
                    hidden=step.is_hidden(card),
                )
            else:
                self._render(card)
                self._save()
                self._notify()
            return card
        if card is not None and card.blocked and source == SOURCE_ENTITY:
            return None
        if card is not None:
            # No state change in between: the new card follows at once.
            self.forget(card, notify=False)
        card = Card(
            notification_id=step.notification.id,
            step_id=step.step_id,
            entity_id=entity_id,
            phase=PHASE_CLOSED,
            since=since or now,
            state_since=now,
            source=source,
            closed_reason=CLOSED_DISMISSED,
            trigger=trigger_data,
            expires_at=expires_at,
        )
        self._refresh(card, trigger_data, overrides)
        self.cards[card.key] = card
        self._render(card)
        self._change(
            card,
            source=source,
            context=context,
            phase=PHASE_OPEN,
            closed_reason=None,
            hidden=step.is_hidden(card),
        )
        self._start_text(card)
        self._schedule_expiry(card)
        return card

    def _refresh(
        self,
        card: Card,
        trigger: dict[str, Any] | None,
        overrides: Overrides | None,
    ) -> None:
        if trigger is not None:
            card.trigger = trigger
        if overrides is None:
            return
        if overrides.message is not None:
            card.message_override = overrides.message
        if overrides.info is not None:
            card.info_override = overrides.info
        if overrides.attachments is not None:
            card.attachments = overrides.attachments
        if overrides.data is not None:
            card.data = overrides.data

    @callback
    def close(
        self,
        card: Card,
        reason: str,
        source: str,
        context: Context | None = None,
        *,
        transient: bool = False,
    ) -> None:
        """Close a card: done, dismissed or expired.

        A transient card goes at once instead of staying as done today.
        """
        if not card.is_open:
            return
        card.transient = transient
        self._cancel_unsnooze(card)
        self._cancel_expiry(card)
        self._stop_text(card)
        runner = self.runners.get(card.notification_id)
        step = runner.steps.get(card.step_id) if runner else None
        blocked = (
            card.entity_id is not None
            and step is not None
            and step.has_listed_start
            and step.start_matching(card.entity_id)
        )
        self._change(
            card,
            source=source,
            context=context,
            phase=PHASE_CLOSED,
            closed_reason=reason,
            closed_at=dt_util.utcnow(),
            snoozed_until=None,
            hidden=False,
            blocked=blocked,
        )
        if transient or (reason != CLOSED_DONE and not card.blocked):
            self.cards.pop(card.key, None)
            self._save()
            self._notify()

    @callback
    def snooze(
        self,
        card: Card,
        until: datetime,
        source: str,
        context: Context | None = None,
    ) -> None:
        """Snooze a card until a time."""
        if not card.is_open:
            return
        self._cancel_unsnooze(card)
        self._change(
            card,
            source=source,
            context=context,
            phase=PHASE_SNOOZED,
            snoozed_until=dt_util.as_utc(until),
        )
        self._schedule_unsnooze(card)

    @callback
    def set_hidden(self, card: Card, hidden: bool) -> None:
        """Hide or show an open card."""
        if card.phase == PHASE_OPEN and card.hidden != hidden:
            self._change(card, source=SOURCE_TRIGGER, hidden=hidden)

    @callback
    def forget(self, card: Card, *, notify: bool = True) -> None:
        """Remove a card without any event (its notification changed)."""
        self._cancel_unsnooze(card)
        self._cancel_expiry(card)
        self._stop_text(card)
        for watch in self._watches:
            if (cancel := watch.timers.pop(card.key, None)) is not None:
                cancel()
        if self.cards.get(card.key) is card:
            del self.cards[card.key]
        self._save()
        if notify:
            self._notify()

    @callback
    def forget_block(self, card: Card) -> None:
        """Let a listed entity's card open again: the entity stopped matching."""
        if card.blocked:
            card.blocked = False
            if card.closed_reason != CLOSED_DONE:
                self.forget(card)
            else:
                self._save()

    def snooze_tomorrow(self, card: Card) -> datetime:
        """Return when a card snoozed until "Tomorrow" comes back."""
        step = self._step_config(card.notification_id, card.step_id) or {}
        tomorrow = dt_util.now().date() + timedelta(days=1)
        if step.get("start", {}).get("type") == "schedule":
            at = dt_util.as_local(card.since).time()
        else:
            at = dt_util.parse_time(
                self._config["general"].get("snooze_tomorrow_at", "08:00")
            ) or time(8)
        return dt_util.as_utc(
            datetime.combine(tomorrow, at, tzinfo=dt_util.get_default_time_zone())
        )

    def set_last_done(self, notification_id: str, step_id: str, when: datetime) -> None:
        """Set when a step was last done."""
        self._record(notification_id, step_id, CLOSED_DONE, when)
        self._done_recorded(notification_id, step_id)
        self._save()
        self._notify()

    def _done_recorded(self, notification_id: str, step_id: str) -> None:
        """Work out an after-last-done schedule again."""
        runner = self.runners.get(notification_id)
        step = runner.steps.get(step_id) if runner else None
        if (
            step is not None
            and step.schedule is not None
            and not step.schedule.is_calendar
        ):
            step.schedule.reschedule()

    def record(
        self, notification_id: str, step_id: str, state: str, when: datetime
    ) -> None:
        """Remember when a step reached a state (or was due)."""
        self._record(notification_id, step_id, state, when)
        self._save()

    @callback
    def schedule_changed(self) -> None:
        """Tell the listeners that a next due time changed."""
        self.issues.refresh()
        self._notify()

    def last_reached(
        self, notification_id: str, step_id: str | None, state: str
    ) -> datetime | None:
        """Return when a step (or any step) last reached a state."""
        steps = self.history.get(notification_id, {})
        times = [
            parsed
            for sid, states in steps.items()
            if step_id is None or sid == step_id
            if (parsed := _parse_time(states.get(state))) is not None
        ]
        return max(times) if times else None

    # -- Changing a card ----------------------------------------------------

    def _change(
        self,
        card: Card,
        *,
        source: str,
        context: Context | None = None,
        **changes: Any,
    ) -> None:
        old = card.status
        for name, value in changes.items():
            setattr(card, name, value)
        new = card.status
        changed = new != old
        previous = self.summary_context
        if changed:
            now = dt_util.utcnow()
            card.state_since = now
            self._record(card.notification_id, card.step_id, new, now)
            if new == CLOSED_DONE:
                self._done_recorded(card.notification_id, card.step_id)
            # The notification's sensor is caused by the context behind the
            # change; a time driven change (a schedule, an expiry, the end of
            # a snooze) has none, the sensor just changes by itself. Either
            # way the summary sensor and the event are caused by the sensor,
            # so they are written after it.
            # The user stays on it, so the Activity log names who did it.
            cause = (
                Context(user_id=context.user_id, parent_id=context.id)
                if context
                else Context()
            )
            self.contexts[card.notification_id] = cause
            self.summary_context = Context(parent_id=cause.id)
            self._state_reached(card, old, new)
        self._save()
        try:
            self._notify()
            if changed:
                self._fire_event(card, new, source, context)
        finally:
            self.summary_context = previous

    def _record(
        self, notification_id: str, step_id: str, state: str, when: datetime
    ) -> None:
        self.history.setdefault(notification_id, {}).setdefault(step_id, {})[state] = (
            dt_util.as_utc(when).isoformat()
        )

    def _state_reached(self, card: Card, old: str, new: str) -> None:
        for watch in list(self._watches):
            if not watch.applies_to(self, card):
                continue
            if (
                old == watch.state
                and (cancel := watch.timers.pop(card.key, None)) is not None
            ):
                cancel()
            if new != watch.state:
                continue
            variables = {
                "platform": TRIGGER_NOTIFICATION_STATE,
                "notification": self.entity_id_of(card.notification_id),
                "step": self.step_number(card.notification_id, card.step_id),
                "entity_id": card.entity_id,
                "from_state": old,
                "to_state": new,
            }
            # The cause is the state of the notification's sensor.
            cause = self.contexts.get(card.notification_id)
            if watch.for_ is None:
                watch.action(variables, cause)
                continue
            watch.timers[card.key] = async_track_point_in_utc_time(
                self.hass,
                self._watch_timer(watch, card, variables, cause),
                dt_util.utcnow() + watch.for_,
            )

    def _watch_timer(
        self,
        watch: StateWatch,
        card: Card,
        variables: dict[str, Any],
        cause: Context | None,
    ) -> Callable[[datetime], None]:
        @callback
        def fire(_now: datetime) -> None:
            watch.timers.pop(card.key, None)
            if self.cards.get(card.key) is card and card.status == watch.state:
                watch.action(variables, cause)

        return fire

    def _fire_event(
        self, card: Card, state: str, source: str, context: Context | None
    ) -> None:
        event_type = {
            STATE_ACTIVE: EVENT_ACTIVE,
            STATE_SNOOZED: EVENT_SNOOZED,
            CLOSED_DONE: EVENT_DONE,
            CLOSED_DISMISSED: EVENT_DISMISSED,
            CLOSED_EXPIRED: EVENT_EXPIRED,
        }.get(state)
        if event_type is None:
            return
        data = {
            "notification": self.entity_id_of(card.notification_id),
            "step": self.step_number(card.notification_id, card.step_id),
            "entity": card.entity_id,
            "source": source,
            "person": self.person_of(context),
            "message": card.message,
        }
        for listener in list(self._event_listeners):
            listener(event_type, data)

    def person_of(self, context: Context | None) -> str | None:
        """Return the person entity of the user behind a context."""
        if context is None or context.user_id is None:
            return None
        for state in self.hass.states.async_all("person"):
            if state.attributes.get("user_id") == context.user_id:
                return state.entity_id
        return None

    # -- Text ---------------------------------------------------------------

    def _render(self, card: Card) -> bool:
        step = self._step_config(card.notification_id, card.step_id)
        if step is None:
            return False
        variables = self.variables(card)
        message, message_error = render_text(
            self.hass,
            card.message_override or step["message"],
            variables,
            card.entity_id,
        )
        info, info_error = render_text(
            self.hass, card.info_override or step.get("info"), variables, card.entity_id
        )
        data_text, data_error = render_text(
            self.hass, _custom_data(step), variables, card.entity_id
        )
        error = message_error or info_error or data_error
        key = (card.notification_id, card.step_id)
        if error != self.template_errors.get(key):
            if error is None:
                self.template_errors.pop(key, None)
            else:
                self.template_errors[key] = error
            self.issues.refresh()
        changed = (message, info, data_text) != (
            card.message,
            card.info,
            card.data_text,
        )
        card.message, card.info, card.data_text = message, info, data_text
        return changed

    def _start_text(self, card: Card) -> None:
        self._stop_text(card)
        step = self._step_config(card.notification_id, card.step_id)
        if step is None:
            return
        texts = [
            text
            for text in (
                card.message_override or step["message"],
                card.info_override or step.get("info"),
                _custom_data(step),
            )
            if text
        ]
        entity_id = card.entity_id or (card.trigger or {}).get("entity_id")

        @callback
        def changed() -> None:
            if self.cards.get(card.key) is card and self._render(card):
                self._save()
                self._notify()

        tracker = TextTracker(
            self.hass,
            texts,
            self.variables(card),
            entity_id if isinstance(entity_id, str) else None,
            changed,
        )
        self._text_trackers[card.key] = tracker
        tracker.async_start()
        if self._render(card):
            self._save()
            self._notify()

    def _stop_text(self, card: Card) -> None:
        if (tracker := self._text_trackers.pop(card.key, None)) is not None:
            tracker.async_stop()

    # -- Timers -------------------------------------------------------------

    def _schedule_unsnooze(self, card: Card) -> None:
        if card.snoozed_until is None:
            return

        @callback
        def wake(_now: datetime) -> None:
            self._snooze_timers.pop(card.key, None)
            if self.cards.get(card.key) is not card or card.phase != PHASE_SNOOZED:
                return
            runner = self.runners.get(card.notification_id)
            step = runner.steps.get(card.step_id) if runner else None
            self._change(
                card,
                source=SOURCE_SNOOZE_END,
                phase=PHASE_OPEN,
                snoozed_until=None,
                hidden=step.is_hidden(card) if step else False,
            )
            self._start_text(card)

        self._snooze_timers[card.key] = async_track_point_in_utc_time(
            self.hass, wake, card.snoozed_until
        )

    def _schedule_expiry(self, card: Card) -> None:
        self._cancel_expiry(card)
        if card.expires_at is None or not self._started:
            return

        @callback
        def expire(_now: datetime) -> None:
            self._expiry_timers.pop(card.key, None)
            if self.cards.get(card.key) is card and card.is_open:
                self.close(card, CLOSED_EXPIRED, SOURCE_SCHEDULE)

        self._expiry_timers[card.key] = async_track_point_in_utc_time(
            self.hass, expire, card.expires_at
        )

    def _cancel_expiry(self, card: Card) -> None:
        if (cancel := self._expiry_timers.pop(card.key, None)) is not None:
            cancel()

    def _cancel_unsnooze(self, card: Card) -> None:
        if (cancel := self._snooze_timers.pop(card.key, None)) is not None:
            cancel()

    @callback
    def _midnight(self, _now: datetime) -> None:
        self._prune()
        self._save()
        self._notify()

    @callback
    def _minute(self, _now: datetime) -> None:
        """Check the time-dependent Hide while and Start conditions again."""
        for runner in self.runners.values():
            for step in runner.steps.values():
                if step.hide_timed:
                    step.refresh_hidden()

    def _prune(self) -> None:
        """Forget the cards closed before today (except blocking ones)."""
        start = dt_util.start_of_local_day()
        for card in list(self.cards.values()):
            if (
                not card.is_open
                and not card.blocked
                and (card.closed_at is None or card.closed_at < start)
            ):
                del self.cards[card.key]

    # -- Storage ------------------------------------------------------------

    def _save(self) -> None:
        self._store.async_delay_save(self._data_to_save, SAVE_DELAY)

    def _data_to_save(self) -> dict[str, Any]:
        return {
            "cards": [card.as_dict() for card in self.cards.values()],
            "history": self.history,
        }

    # -- Own conditions -----------------------------------------------------

    def check_own_condition(
        self,
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

    def check_notification_state(self, condition: Mapping[str, Any]) -> bool:
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
        if (within := _period(condition.get("within"))) is not None:
            reached = self.last_reached(notification_id, step_id, state)
            return reached is not None and dt_util.utcnow() - reached <= within
        needed = _period(condition.get("for")) or timedelta()
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

    def notification_state(self, notification_id: str) -> str:
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

    def next_due(self, notification_id: str) -> datetime | None:
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

    def upcoming(self, notification_id: str) -> list[dict[str, str]]:
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

    def _visible_cards(self, notification_id: str) -> list[Card]:
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

    def top_card(self, notification_id: str) -> Card | None:
        """Return the card a notification shows first."""
        cards = self._visible_cards(notification_id)
        for state in (STATE_ACTIVE, STATE_HIDDEN, STATE_SNOOZED, STATE_DONE):
            for card in cards:
                if card.status == state:
                    return card
        return None

    def notification_attributes(self, notification_id: str) -> dict[str, Any]:
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
            "next_due": _iso(self.next_due(notification_id)),
            "last_done": last_done.isoformat() if last_done else None,
            "category": category,
        }

    def summary(self) -> dict[str, Any]:
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
            "mode": self.modes.current.get("name"),
            "categories": counts,
            "top_notification": top["notification"] if top else None,
            "top_message": top["message"] if top else None,
        }

    def snapshot(self) -> dict[str, Any]:
        """Return every notification's state and cards for the websocket API."""
        return {
            "mode": self.modes.current.get("id"),
            "notifications": {
                notification["id"]: {
                    "state": self.notification_state(notification["id"]),
                    "entity_id": self.entity_id_of(notification["id"]),
                    "cards": [
                        card.as_dict()
                        for card in self._visible_cards(notification["id"])
                    ],
                    "last_done": _iso(
                        self.last_reached(notification["id"], None, CLOSED_DONE)
                    ),
                    "next_due": _iso(self.next_due(notification["id"])),
                    "upcoming": self.upcoming(notification["id"]),
                }
                for notification in self._config["notifications"]
            },
        }

    # -- Calendar -----------------------------------------------------------

    def calendar_events(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
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

    # -- Actions ------------------------------------------------------------

    def _step(self, notification_id: str, step_id: str) -> StepRunner:
        runner = self.runners.get(notification_id)
        step = runner.steps.get(step_id) if runner else None
        if step is None:
            raise ServiceValidationError(
                "The notification or the step is switched off, or not started yet"
            )
        return step

    @callback
    def trigger(
        self,
        notification_id: str,
        step_id: str,
        entity_id: str | None,
        overrides: Overrides,
        context: Context | None = None,
    ) -> None:
        """Open a card from the trigger action, without checking conditions."""
        step = self._step(notification_id, step_id)
        trigger = {"platform": "action", "entity_id": entity_id}
        self.open(step, entity_id, trigger, SOURCE_ACTION, overrides, context)

    def select(
        self,
        notification_id: str,
        step_id: str | None,
        entity_id: str | None,
    ) -> list[Card]:
        """Return the open and snoozed cards an action is about."""
        return [
            card
            for card in self.cards_of(notification_id, step_id)
            if card.is_open and (entity_id is None or card.entity_id == entity_id)
        ]

    def close_cards(
        self,
        cards: Iterable[Card],
        reason: str,
        source: str,
        context: Context | None = None,
    ) -> None:
        """Close several cards."""
        for card in list(cards):
            self.close(card, reason, source, context)

    def silence_cards(
        self,
        cards: Iterable[Card],
        source: str,
        context: Context | None = None,
    ) -> None:
        """Keep cards open but stop their channels (Keep it silently)."""
        for card in list(cards):
            if card.is_open and not card.silenced:
                self._change(card, source=source, context=context, silenced=True)

    def snooze_cards(
        self,
        cards: Iterable[Card],
        until: datetime | None,
        source: str,
        context: Context | None = None,
    ) -> None:
        """Snooze several cards; without a time, until "Tomorrow"."""
        for card in list(cards):
            self.snooze(card, until or self.snooze_tomorrow(card), source, context)

    # -- Buttons ------------------------------------------------------------

    def button_of(self, card: Card, button_id: str) -> dict[str, Any] | None:
        """Return a switched on button of a card's step."""
        step = self._step_config(card.notification_id, card.step_id) or {}
        return next(
            (
                button
                for button in step.get("buttons", [])
                if button["id"] == button_id and button.get("enabled", True)
            ),
            None,
        )

    def snooze_until(self, card: Card, button: Mapping[str, Any]) -> datetime:
        """Return until when a button snoozes a card it does not ask about.

        The button's own time comes first, then the notification's and the
        category's; when they ask, the card comes back "Tomorrow".
        """
        own = button.get("snooze")
        if isinstance(own, Mapping):
            return dt_util.utcnow() + timedelta(**own)
        if own != "ask":
            notification = self.notification_config(card.notification_id) or {}
            snooze = notification.get("snooze") or next(
                (
                    item.get("snooze")
                    for item in self._config["categories"]
                    if item["id"] == notification.get("category")
                ),
                None,
            )
            if snooze and snooze.get("type") == "not_allowed":
                raise ServiceValidationError("This notification cannot be snoozed")
            if snooze and snooze.get("type") == "fixed":
                return dt_util.utcnow() + timedelta(**snooze["duration"])
        return self.snooze_tomorrow(card)

    def entity_actions(self, card: Card, button_id: str) -> list[dict[str, Any]]:
        """Return the entity action of a card's entity for a button."""
        if card.entity_id is None:
            return []
        notification = self.notification_config(card.notification_id) or {}
        for entity in notification.get("entities", []):
            if entity["entity_id"] == card.entity_id:
                actions = entity.get("actions", {}).get(button_id)
                if actions:
                    return list(actions)
        runner = self.runners.get(card.notification_id)
        if runner is not None:
            for group in runner.entities.groups_of(card.entity_id):
                actions = group.get("actions", {}).get(button_id)
                if actions:
                    return list(actions)
        return []

    async def async_press(
        self,
        card: Card,
        button_id: str,
        until: datetime | None,
        context: Context | None = None,
    ) -> None:
        """Press a button of a card: change the card, then run its action.

        More info and Navigate happen where the button was pressed; the
        Home Assistant action and the entity action run here.
        """
        button = self.button_of(card, button_id)
        if button is None:
            raise ServiceValidationError("The button is not there")
        action = button.get("action") or {"type": "nothing"}
        actions: list[dict[str, Any]] = []
        if action["type"] == "ha_action":
            actions = list(action["actions"])
        elif action["type"] == "entity_action":
            actions = self.entity_actions(card, button_id)
        variables = self.variables(card)
        effect = button.get("card", "keep")
        if effect == CLOSED_DONE:
            self.close(card, CLOSED_DONE, SOURCE_BUTTON, context)
        elif effect == CLOSED_DISMISSED:
            self.close(card, CLOSED_DISMISSED, SOURCE_BUTTON, context)
        elif effect == "snooze":
            self.snooze(
                card, until or self.snooze_until(card, button), SOURCE_BUTTON, context
            )
        elif effect == "keep_silent":
            self.silence_cards([card], SOURCE_BUTTON, context)
        if actions:
            await self._async_run_actions(card, button, actions, variables, context)

    async def _async_run_actions(
        self,
        card: Card,
        button: Mapping[str, Any],
        actions: list[dict[str, Any]],
        variables: dict[str, Any],
        context: Context | None,
    ) -> None:
        notification = self.notification_config(card.notification_id) or {}
        label = button.get("label") or button["type"]
        name = f"{notification.get('name', card.notification_id)}: {label}"
        try:
            sequence = await async_validate_actions_config(
                self.hass, cv.SCRIPT_SCHEMA(actions)
            )
        except (vol.Invalid, HomeAssistantError) as err:
            raise ServiceValidationError(f"{name}: {err}") from err
        script = Script(self.hass, sequence, name, DOMAIN, script_mode="parallel")
        self.hass.async_create_background_task(
            script.async_run(variables, context),
            f"{DOMAIN} button {name}",
        )

    @callback
    def done_early(
        self, notification_id: str, step_id: str, context: Context | None = None
    ) -> None:
        """Mark a scheduled step done before it is due.

        An after-last-done step counts from now; a calendar step skips its
        next occurrence.
        """
        runner = self.runners.get(notification_id)
        step = runner.steps.get(step_id) if runner else None
        if step is None or step.schedule is None:
            raise ServiceValidationError("The step has no schedule")
        if self.select(notification_id, step_id, None):
            raise ServiceValidationError("The step has an open card")
        schedule = step.schedule
        if schedule.is_calendar and schedule.next is not None:
            self._record(notification_id, step_id, HISTORY_SKIPPED, schedule.next)
        # A done card, as if it had been done on the card: it shows as done
        # today and the Activity log tells who did it.
        now = dt_util.utcnow()
        if (old := self.cards.get((notification_id, step_id, ""))) is not None:
            self.forget(old, notify=False)
        card = Card(
            notification_id=notification_id,
            step_id=step_id,
            entity_id=None,
            phase=PHASE_CLOSED,
            since=now,
            state_since=now,
            source=SOURCE_BUTTON,
            closed_reason=CLOSED_DISMISSED,
        )
        self.cards[card.key] = card
        self._render(card)
        self._change(
            card,
            source=SOURCE_BUTTON,
            context=context,
            closed_reason=CLOSED_DONE,
            closed_at=now,
        )
        if schedule.is_calendar:
            schedule.reschedule()
