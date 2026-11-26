"""Running a step and a notification: triggers, conditions and the cards they make."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from contextlib import suppress
from datetime import datetime
import logging
from typing import TYPE_CHECKING, Any, Final, cast

from homeassistant.core import (
    CALLBACK_TYPE,
    Context,
    State,
    callback,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.condition import (
    ConditionsChecker,
    async_conditions_from_config,
    async_extract_entities,
    async_validate_conditions_config,
)
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.event import (
    async_track_state_change_event,
)
from homeassistant.helpers.trigger import (
    async_extract_entities as async_extract_trigger_entities,
    async_initialize_triggers,
    async_validate_trigger_config,
)

from .cards import (
    PHASE_OPEN,
    Card,
    StateWatch,
    as_period,
)
from .const import (
    CLOSED_DISMISSED,
    CLOSED_DONE,
    DOMAIN,
    SOURCE_DISMISS_WHEN,
    SOURCE_DONE_WHEN,
    SOURCE_ENTITY,
    SOURCE_TRIGGER,
)
from .listed import EntityList, ListedTracker
from .model import (
    ENTITIES_KINDS,
    TRIGGER_NOTIFICATION_STATE,
    entities_references,
)
from .scheduler import StepSchedule

if TYPE_CHECKING:
    from .engine import Engine


_LOGGER = logging.getLogger(__name__)


# Conditions that change with time, not with an entity: a Conditions block that
# holds one of them is checked again every minute.
_TIMED_CONDITIONS: Final = frozenset({"time", "sun", "template", "trigger"})


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
        untimed: ConditionsChecker | None = None,
    ) -> None:
        self._engine = engine
        self._notification = notification
        self._own = own
        self._checker = checker
        # The Home Assistant conditions that do not change with time.
        self._untimed = untimed

    @property
    def empty(self) -> bool:
        return not self._own and self._checker is None

    @property
    def has_own(self) -> bool:
        """Return whether a Notification state or entities condition is in."""
        return bool(self._own)

    @property
    def has_own_entities(self) -> bool:
        """Return whether a Notification entities condition is in."""
        return any(c["condition"] in ENTITIES_KINDS for c in self._own)

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

    def check_untimed(self, variables: Mapping[str, Any], at: datetime) -> bool:
        """Return whether the conditions hold at a later time, as far as known.

        For a step that is due at ``at``: a Notification state's time window
        is checked for that time; entity states as they are now; a time of
        day, the sun or a template only when it is due (left out here).
        """
        for condition in self._own:
            if not self._engine.check_own_condition(
                condition, self._notification, variables, at
            ):
                return False
        if self._untimed is not None:
            return self._untimed(dict(variables))
        return True

    def unload(self) -> None:
        if self._checker is not None:
            self._checker.async_unload()
        if self._untimed is not None and self._untimed is not self._checker:
            self._untimed.async_unload()


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
    untimed: ConditionsChecker | None = None
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
        if timed and (steady := [c for c in validated if not _is_timed(c)]):
            untimed = await async_conditions_from_config(
                engine.hass,
                cast(list[dict[str, Any]], steady),
                _LOGGER,
                f"{name} (without time)",
            )
        elif not timed:
            untimed = checker
    return (
        _Conditions(engine, notification, own, checker, untimed),
        entities,
        timed,
    )


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
        # Conditions: its conditions, used at the start and to hide open cards.
        self.show_when: _Conditions | None = None
        self.start_conditions: _Conditions | None = None
        self._hides = False
        self._closes = False
        self.hide_timed = False
        self._hide_entities: set[str] = set()
        self.schedule: StepSchedule | None = None
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
        start = self.step["activation"]
        show_when = self.step.get("conditions") or {}
        self.show_when, entities, timed = await _async_conditions(
            self.engine,
            self.notification,
            show_when.get("conditions", []),
            f"{self.name} conditions",
        )
        self.referenced |= entities
        if start["type"] == "schedule":
            self.schedule = StepSchedule(self, start["schedule"])
        if show_when.get("activate_only_while_met", True):
            self.start_conditions = self.show_when
        # Hidden while they are not met; a scheduled card that needs them to
        # start waits for them, hidden, until it expires.
        self._hides = bool(show_when.get("hide_while_not_met", True)) or (
            self.schedule is not None and self.start_conditions is not None
        )
        # When the activation is no longer true also closes an
        # active card when the Conditions it was activated with are not met.
        self._closes = (
            bool(self.step["done_when"].get("activation_conditions_no_longer_true"))
            and self.start_conditions is not None
            and not self.start_conditions.empty
            and self.schedule is None
        )
        if self._hides or self._closes:
            self._hide_entities = entities
            self.hide_timed = timed
            # Own conditions follow the cards (see ``watches_own``); the
            # states of listed entities are only checked again every minute.
            if self.show_when.has_own_entities:
                self.hide_timed = True
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
        await self._async_setup_triggers(
            self.step.get("dismiss_when", {}).get("triggers", []),
            self._dismiss_fired,
            (self._dismiss_listed, self._done_unmatched),
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
        if self.show_when is not None:
            self.show_when.unload()

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
        if self.step["done_when"].get("activation_conditions_no_longer_true"):
            for card in self.engine.cards_of(self.notification.id, self.step_id):
                if (
                    card.entity_id is not None
                    and card.is_open
                    and not self.start_matching(card.entity_id)
                ):
                    self.engine.close(card, CLOSED_DONE, SOURCE_ENTITY, transient=True)
        if self._closes:
            self.refresh_hidden()

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
            for_=as_period(period),
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
        if card.is_open and self.step["done_when"].get(
            "activation_conditions_no_longer_true"
        ):
            self.engine.close(
                card, CLOSED_DONE, SOURCE_ENTITY, context=context, transient=True
            )
            self.engine.forget_block(card)

    # -- Done when ----------------------------------------------------------

    @callback
    def _done_fired(self, trigger: dict[str, Any], context: Context | None) -> None:
        self._close_fired(trigger, context, CLOSED_DONE, SOURCE_DONE_WHEN)

    @callback
    def _dismiss_fired(self, trigger: dict[str, Any], context: Context | None) -> None:
        self._close_fired(trigger, context, CLOSED_DISMISSED, SOURCE_DISMISS_WHEN)

    @callback
    def _dismiss_listed(self, entity_id: str, trigger: dict[str, Any]) -> None:
        self._dismiss_fired(trigger, None)

    def _close_fired(
        self,
        trigger: dict[str, Any],
        context: Context | None,
        closed: str,
        source: str,
    ) -> None:
        """Close the open cards of the step (the trigger entity's own first)."""
        cards = [
            card
            for card in self.engine.cards_of(self.notification.id, self.step_id)
            if card.is_open
        ]
        entity_id = trigger.get("entity_id")
        own = [card for card in cards if card.entity_id == entity_id]
        context = trigger_context(trigger, context)
        for card in own or cards:
            self.engine.close(card, closed, source, context=context)

    @callback
    def _done_listed(self, entity_id: str, trigger: dict[str, Any]) -> None:
        self._done_fired(trigger, None)

    @callback
    def _done_unmatched(self, entity_id: str, context: Context | None) -> None:
        """Do nothing: an entity of a Done when trigger stopped matching."""

    def start_matching(self, entity_id: str) -> bool:
        """Return whether an entity matches a Listed entities start trigger."""
        return any(tracker.is_matching(entity_id) for tracker in self._start_trackers)

    # -- Conditions ---------------------------------------------------------

    @callback
    def _hide_changed(self, *_: Any) -> None:
        self.refresh_hidden()
        if self.schedule is not None and self.schedule.next is not None:
            # Upcoming shows the step only while its Conditions are met.
            self.engine.async_changed()

    @callback
    def refresh_hidden(self) -> None:
        """Check Conditions again for the open cards of the step.

        With When the activation is no longer true, a card whose
        activation conditions are no longer met closes as done; otherwise it
        may be hidden.
        """
        start = self.start_conditions if self._closes else None
        for card in self.engine.cards_of(self.notification.id, self.step_id):
            if card.phase != PHASE_OPEN:
                continue
            if start is not None and not start.check(self.engine.variables(card)):
                self.engine.close(card, CLOSED_DONE, SOURCE_DONE_WHEN, transient=True)
                continue
            self.engine.set_hidden(card, self.is_hidden(card))

    @property
    def watches_own(self) -> bool:
        """Return whether Conditions on other cards decide hiding or closing."""
        if not (self._hides or self._closes):
            return False
        return any(
            conditions is not None and conditions.has_own
            for conditions in (self.show_when, self.start_conditions)
        )

    def waits_for_conditions(self, variables: Mapping[str, Any], due: datetime) -> bool:
        """Return whether a step due later would be held back by its Conditions.

        See ``_Conditions.check_untimed`` for what is checked for that time.
        """
        if not self._hides or self.show_when is None or self.show_when.empty:
            return False
        return not self.show_when.check_untimed(variables, due)

    def is_hidden(self, card: Card) -> bool:
        """Return whether a card is hidden: the Conditions are not met for it."""
        if not self._hides or self.show_when is None or self.show_when.empty:
            return False
        return not self.show_when.check(self.engine.variables(card))

    @property
    def has_listed_start(self) -> bool:
        """Return whether a Notification entities trigger starts the step."""
        return any(
            trigger.get("trigger", trigger.get("platform")) in ENTITIES_KINDS
            for trigger in self.step["activation"].get("triggers", [])
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
