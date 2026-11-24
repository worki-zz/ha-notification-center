"""What the engine does for buttons and actions."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
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
    Card,
    Overrides,
)
from .const import (
    CLOSED_DISMISSED,
    CLOSED_DONE,
    DOMAIN,
    SOURCE_ACTION,
    SOURCE_BUTTON,
)
from .model import (
    BUTTON_EFFECTS,
    DEFAULT_SNOOZE_CHOICES,
    DEFAULT_STATE_SNOOZE,
    effective_buttons,
    run_button_of,
)
from .scheduler import HISTORY_SKIPPED

if TYPE_CHECKING:
    from .engine import Engine
    from .runner import StepRunner


_LOGGER = logging.getLogger(__name__)


class EngineActions:
    """Methods of the engine, kept in their own module."""

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

        The chosen time when it is one of the button's, otherwise its first.
        """
        choices: list[str] = list(button.get("snooze") or DEFAULT_SNOOZE_CHOICES)
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
    ) -> None:
        """Press a button of a card: run its actions in their fixed order.

        Each action finishes before the next one starts, in the order of
        the button's Actions list: the entity action, Mute, then the
        notification state (Done marks the card done,
        Dismiss dismisses it and Snooze snoozes it: until the given time, or
        for the chosen or first of its times), then the Home Assistant actions.
        The navigation (More info or Navigate) happens where the button was
        pressed. An action that cannot run is skipped
        and the others still run. A Tap that runs another button runs that
        button's actions.
        """
        button = self.button_of(card, button_id)
        if button is None:
            raise ServiceValidationError("The button is not there")
        actions: Mapping[str, Any] = button.get("actions") or {}
        variables = self.variables(card)
        if actions.get("entity_action"):
            entity_actions = self.entity_actions(card, button["id"])
            if entity_actions:
                await self._async_run_actions(
                    card, button, entity_actions, variables, context
                )
        if actions.get("mute") or button["type"] == "mute":
            self.mute_cards([card], SOURCE_BUTTON, context)
        self._press_state(card, button, actions, until, context, choice)
        if actions.get("ha_actions"):
            await self._async_run_actions(
                card, button, list(actions["ha_actions"]), variables, context
            )

    def _press_state(
        self: Engine,
        card: Card,
        button: Mapping[str, Any],
        actions: Mapping[str, Any],
        until: datetime | None,
        context: Context | None,
        choice: str | None,
    ) -> None:
        """Set the notification state a pressed button sets, if any.

        A built-in Done, Dismiss or Snooze button sets its own; an own
        button or the Tap the one of its actions.
        """
        effect = BUTTON_EFFECTS.get(button["type"])
        state = actions.get("notification_state") or {}
        if effect is None:
            effect = state.get("type")
        if effect == CLOSED_DONE:
            self.close(card, CLOSED_DONE, SOURCE_BUTTON, context)
        elif effect == CLOSED_DISMISSED:
            self.close(card, CLOSED_DISMISSED, SOURCE_BUTTON, context)
        elif effect == "snooze":
            if until is None:
                until = (
                    self.snooze_until(card, button, choice)
                    if button["type"] == "snooze"
                    else self.snooze_choice(
                        card, state.get("snooze") or DEFAULT_STATE_SNOOZE
                    )
                )
            self.snooze(card, until, SOURCE_BUTTON, context)

    async def _async_run_actions(
        self: Engine,
        card: Card,
        button: Mapping[str, Any],
        actions: list[dict[str, Any]],
        variables: dict[str, Any],
        context: Context | None,
    ) -> None:
        """Run a list of Home Assistant actions; skip it when it is not valid."""
        notification = self.notification_config(card.notification_id) or {}
        label = button.get("label") or button["type"]
        name = f"{notification.get('name', card.notification_id)}: {label}"
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
