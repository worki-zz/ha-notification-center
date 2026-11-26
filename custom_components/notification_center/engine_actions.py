"""What the engine does for buttons and actions."""

from __future__ import annotations

from collections.abc import Coroutine, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
import logging
from typing import TYPE_CHECKING, Any

from homeassistant.core import (
    Context,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.script import Script, async_validate_actions_config
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .cards import (
    PHASE_CLOSED,
    PHASE_SNOOZED,
    Card,
    Overrides,
)
from .const import (
    CLOSED_DISMISSED,
    CLOSED_DONE,
    DOMAIN,
    SOURCE_ACTION,
    SOURCE_BUTTON,
    SOURCE_DISMISS_WHEN,
    SOURCE_DONE_WHEN,
    SOURCE_ENTITY,
    SOURCE_EXPIRES,
    SOURCE_MUTE_WHEN,
    SOURCE_SCHEDULE,
    SOURCE_SNOOZE_END,
    SOURCE_SNOOZE_WHEN,
    SOURCE_TRIGGER,
)
from .model import (
    DEFAULT_SNOOZE_FOR,
    STATUS_BLOCKS,
    button_state,
    effective_buttons,
    run_button_of,
    snooze_options,
)
from .scheduler import HISTORY_SKIPPED

if TYPE_CHECKING:
    from .engine import Engine
    from .runner import StepRunner


_LOGGER = logging.getLogger(__name__)

# The ``cause.source`` of status actions, by what changed the card.
CAUSE_SOURCES: dict[str, str] = {
    SOURCE_TRIGGER: "trigger",
    SOURCE_ENTITY: "trigger",
    SOURCE_DONE_WHEN: "trigger",
    SOURCE_DISMISS_WHEN: "trigger",
    SOURCE_SNOOZE_WHEN: "trigger",
    SOURCE_MUTE_WHEN: "trigger",
    SOURCE_SCHEDULE: "schedule",
    SOURCE_EXPIRES: "expiration",
    SOURCE_ACTION: "action",
    SOURCE_BUTTON: "button",
    SOURCE_SNOOZE_END: "snooze_end",
}
# The built-in button whose entity action a status block runs.
_BLOCK_BUTTONS: dict[str, str] = {
    "done": "done",
    "dismissed": "dismiss",
    "snoozed": "snooze",
    "muted": "mute",
}


@dataclass
class PressRun:
    """A button being pressed: what its state change runs afterwards."""

    card: Card
    button: str
    origin: str
    run_state_actions: bool
    jobs: list[Coroutine[Any, Any, None]] = field(default_factory=list)


def status_reached(
    old_phase: str, card: Card, changed: bool, *, opened: bool, muted: bool
) -> str | None:
    """Return the status whose actions a change of a card runs, if any.

    Hiding and showing an active card is no new status.
    """
    if opened:
        return "active"
    if changed and card.phase == PHASE_SNOOZED and old_phase != PHASE_SNOOZED:
        return "snoozed"
    if changed and card.phase == PHASE_CLOSED:
        return card.closed_reason
    if muted:
        return "muted"
    return None


class EngineActions:
    """Methods of the engine, kept in their own module."""

    _press: PressRun | None

    # -- Actions ------------------------------------------------------------

    def _step(self: Engine, notification_id: str, step_id: str) -> StepRunner:
        runner = self.runners.get(notification_id)
        step = runner.steps.get(step_id) if runner else None
        if step is None:
            raise ServiceValidationError(
                "The notification or the step is switched off, or not started yet"
            )
        return step

    @callback
    def trigger(
        self: Engine,
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
        self: Engine,
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
        self: Engine,
        cards: Iterable[Card],
        reason: str,
        source: str,
        context: Context | None = None,
    ) -> None:
        """Close several cards."""
        for card in list(cards):
            self.close(card, reason, source, context)

    def mute_cards(
        self: Engine,
        cards: Iterable[Card],
        source: str,
        context: Context | None = None,
    ) -> None:
        """Keep cards open but stop their channels (Mute)."""
        for card in list(cards):
            if card.is_open and not card.muted:
                self._change(card, source=source, context=context, muted=True)

    def snooze_cards(
        self: Engine,
        cards: Iterable[Card],
        until: datetime | None,
        source: str,
        context: Context | None = None,
    ) -> None:
        """Snooze several cards; without a time, until "Tomorrow"."""
        for card in list(cards):
            self.snooze(card, until or self.snooze_tomorrow(card), source, context)

    # -- Buttons ------------------------------------------------------------

    def button_of(self: Engine, card: Card, button_id: str) -> dict[str, Any] | None:
        """Return a switched on button of a card's step.

        A Tap that runs another button gives that button.
        """
        buttons = self.buttons_of(card)
        button = next(
            (
                button
                for button in buttons
                if button["id"] == button_id and button.get("enabled", True)
            ),
            None,
        )
        if button is not None and button["type"] == "tap":
            return run_button_of(buttons, button) or button
        return button

    def buttons_of(self: Engine, card: Card) -> list[dict[str, Any]]:
        """Return the buttons of a card's step, with what they inherit."""
        step = self._step_config(card.notification_id, card.step_id) or {}
        notification = self.notification_config(card.notification_id) or {}
        return effective_buttons(self.category_of(notification), step)

    def snooze_until(
        self: Engine, card: Card, button: Mapping[str, Any], choice: str | None = None
    ) -> datetime:
        """Return until when a Snooze button snoozes a card.

        The chosen time when the button offers it, otherwise its Snooze for.
        """
        choices = snooze_options(button)
        if choice is None or choice not in choices:
            choice = choices[0]
        return self.snooze_choice(card, choice)

    def entity_actions(
        self: Engine, card: Card, button_id: str
    ) -> list[dict[str, Any]]:
        """Return the entity action of a card's entity for a button.

        The entity's own action, else its custom action in a group, else
        the group's action.
        """
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
                # A member's custom action replaces the group's, even when
                # it is empty.
                custom = group.get("member_actions", {}).get(card.entity_id, {})
                if button_id in custom:
                    return list(custom[button_id])
                actions = group.get("actions", {}).get(button_id)
                if actions:
                    return list(actions)
        return []

    async def async_press(
        self: Engine,
        card: Card,
        button_id: str,
        until: datetime | None,
        context: Context | None = None,
        choice: str | None = None,
        origin: str = SOURCE_BUTTON,
    ) -> None:
        """Press a button of a card.

        One after the other: the button's own actions (a custom button and
        the Tap: the entity action, then the Home Assistant actions), the
        notification state it sets (Done, Dismiss, Snooze: until the given
        time, or for the chosen time or its Snooze for; Mute), then the
        actions of that state's block, unless its Run ... actions switch is
        off. The navigation happens where the button was pressed. An action
        that cannot run is skipped and the others still run. A Tap that runs
        another button does what that button does.
        """
        button = self.button_of(card, button_id)
        if button is None:
            raise ServiceValidationError("The button is not there")
        actions: Mapping[str, Any] = button.get("actions") or {}
        variables = self.variables(card)
        name = self._button_name(card, button)
        if actions.get("entity_action"):
            entity_actions = self.entity_actions(card, button["id"])
            if entity_actions:
                await self._async_run_actions(name, entity_actions, variables, context)
        if actions.get("ha_actions"):
            await self._async_run_actions(
                name, list(actions["ha_actions"]), variables, context
            )
        press = PressRun(
            card=card,
            button=button["id"] if button["type"] == "custom" else button["type"],
            origin=origin,
            run_state_actions=button.get("run_state_actions", True),
        )
        self._press = press
        try:
            self._press_state(card, button, until, context, choice)
        finally:
            self._press = None
        for job in press.jobs:
            await job

    def _press_state(
        self: Engine,
        card: Card,
        button: Mapping[str, Any],
        until: datetime | None,
        context: Context | None,
        choice: str | None,
    ) -> None:
        """Set the notification state a pressed button sets, if any."""
        state = button_state(button)
        if state == "done":
            self.close(card, CLOSED_DONE, SOURCE_BUTTON, context)
        elif state == "dismiss":
            self.close(card, CLOSED_DISMISSED, SOURCE_BUTTON, context)
        elif state == "mute":
            self.mute_cards([card], SOURCE_BUTTON, context)
        elif state == "snooze":
            if until is None:
                until = (
                    self.snooze_until(card, button, choice)
                    if button["type"] == "snooze"
                    else self.snooze_choice(
                        card, button.get("snooze_for") or DEFAULT_SNOOZE_FOR
                    )
                )
            self.snooze(card, until, SOURCE_BUTTON, context)

    def _button_name(self: Engine, card: Card, button: Mapping[str, Any]) -> str:
        notification = self.notification_config(card.notification_id) or {}
        label = button.get("label") or button["type"]
        return f"{notification.get('name', card.notification_id)}: {label}"

    async def _async_run_actions(
        self: Engine,
        name: str,
        actions: list[dict[str, Any]],
        variables: dict[str, Any],
        context: Context | None,
    ) -> None:
        """Run a list of Home Assistant actions; skip it when it is not valid."""
        try:
            sequence = await async_validate_actions_config(
                self.hass, cv.SCRIPT_SCHEMA(actions)
            )
        except (vol.Invalid, HomeAssistantError) as err:
            _LOGGER.warning("%s: the action is skipped: %s", name, err)
            return
        script = Script(self.hass, sequence, name, DOMAIN, script_mode="parallel")
        # Wait for it: the next action starts when this one is done.
        try:
            await script.async_run(variables, context)
        except HomeAssistantError as err:
            _LOGGER.warning("%s: the action failed: %s", name, err)

    # -- Status actions -----------------------------------------------------

    def queue_status_actions(
        self: Engine,
        card: Card,
        status: str,
        source: str,
        context: Context | None,
        old_phase: str,
    ) -> None:
        """Run the actions of the status block a card reached.

        A pressed button's state change runs them after the press (or not,
        with its Run ... actions switch off); any other change runs them in
        the background. The Activation actions run again at the end of a
        snooze only when Snooze when asks for it.
        """
        step = self._step_config(card.notification_id, card.step_id)
        if step is None:
            return
        block = step.get(STATUS_BLOCKS[status]) or {}
        if status in ("snoozed", "muted") and not block.get("enabled"):
            return
        if status == "active" and old_phase == PHASE_SNOOZED:
            snooze_when = step.get("snooze_when") or {}
            if source == SOURCE_SNOOZE_END and not (
                snooze_when.get("enabled") and snooze_when.get("rerun_activation")
            ):
                return
        actions = block.get("actions") or {}
        if not actions.get("entity_action") and not actions.get("ha_actions"):
            return
        press = self._press
        if press is not None and press.card is not card:
            press = None
        if press is not None and not press.run_state_actions:
            return
        cause: dict[str, Any] = {
            "source": press.origin if press else CAUSE_SOURCES.get(source, source),
            "button": press.button if press else None,
            "user_id": context.user_id if context else None,
            "person": self.person_of(context),
        }
        job = self._async_status_actions(card, status, dict(actions), cause, context)
        if press is not None:
            press.jobs.append(job)
        else:
            self.hass.async_create_task(
                job, f"{DOMAIN} {card.notification_id} {status} actions"
            )

    async def _async_status_actions(
        self: Engine,
        card: Card,
        status: str,
        actions: dict[str, Any],
        cause: dict[str, Any],
        context: Context | None,
    ) -> None:
        notification = self.notification_config(card.notification_id) or {}
        name = (
            f"{notification.get('name', card.notification_id)}: "
            f"{STATUS_BLOCKS[status].replace('_', ' ')}"
        )
        variables = self.variables(card, status, cause)
        if actions.get("entity_action"):
            entity_actions = self.entity_actions(
                card, self.status_action_key(card, status)
            )
            if entity_actions:
                await self._async_run_actions(name, entity_actions, variables, context)
        if actions.get("ha_actions"):
            await self._async_run_actions(
                name, list(actions["ha_actions"]), variables, context
            )

    def status_action_key(self: Engine, card: Card, status: str) -> str:
        """Return the key of a status block's action in the Entities block.

        Done when, Dismiss when, Snooze when and Mute when use the step's
        built-in button of that state (as its entity action did before);
        Activation has a key of its own.
        """
        kind = _BLOCK_BUTTONS.get(status)
        if kind is not None:
            for button in self.buttons_of(card):
                if button["type"] == kind:
                    return str(button["id"])
        return f"{card.step_id}.activation"

    @callback
    def done_early(
        self: Engine, notification_id: str, step_id: str, context: Context | None = None
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
            raise ServiceValidationError("The step has an open notification")
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
