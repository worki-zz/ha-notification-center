"""The current mode of the home.

Modes are checked in their order; the first one whose condition is true is
the current mode. Home has no condition and is always last, so it applies
when no other mode does.
"""

from __future__ import annotations

from collections.abc import Callable
import logging
from typing import Any

from homeassistant.const import STATE_ON
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import TemplateError
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResultInfo,
    async_track_state_change_event,
    async_track_template_result,
)
from homeassistant.helpers.template import Template, result_as_boolean

from .model import HOME_MODE_ID

_LOGGER = logging.getLogger(__name__)


class ModeTracker:
    """Work out the current mode and report when it changes."""

    def __init__(
        self,
        hass: HomeAssistant,
        modes: list[dict[str, Any]],
        on_change: Callable[[], None],
    ) -> None:
        """Set up the tracker; call ``async_start`` to begin."""
        self._hass = hass
        self.modes = modes
        self._on_change = on_change
        self._unsub_states: CALLBACK_TYPE | None = None
        self._template_info: TrackTemplateResultInfo | None = None
        self._templates: dict[str, Template] = {}
        self.current: dict[str, Any] = self._home()

    def _home(self) -> dict[str, Any]:
        for mode in self.modes:
            if mode["id"] == HOME_MODE_ID:
                return mode
        return {"id": HOME_MODE_ID, "name": "Home"}

    @callback
    def async_start(self) -> None:
        """Follow the entities and templates of the mode conditions."""
        entities = {
            mode["condition"]["entity_id"]
            for mode in self.modes
            if mode.get("condition") and "entity_id" in mode["condition"]
        }
        if entities:
            self._unsub_states = async_track_state_change_event(
                self._hass, sorted(entities), self._changed
            )
        templates = {
            mode["id"]: Template(mode["condition"]["value_template"], self._hass)
            for mode in self.modes
            if mode.get("condition") and mode["condition"]["type"] == "template"
        }
        self._templates = templates
        if templates:
            self._template_info = async_track_template_result(
                self._hass,
                [TrackTemplate(template, None) for template in templates.values()],
                self._changed,
            )
            self._template_info.async_refresh()
        self.current = self._evaluate()

    @callback
    def async_stop(self) -> None:
        """Stop following changes."""
        if self._unsub_states is not None:
            self._unsub_states()
            self._unsub_states = None
        if self._template_info is not None:
            self._template_info.async_remove()
            self._template_info = None

    @callback
    def _changed(self, *_: Any) -> None:
        mode = self._evaluate()
        if mode["id"] != self.current["id"]:
            self.current = mode
            self._on_change()

    def _evaluate(self) -> dict[str, Any]:
        for mode in self.modes:
            condition = mode.get("condition")
            if condition and self._is_true(mode["id"], condition):
                return mode
        return self._home()

    def _is_true(self, mode_id: str, condition: dict[str, Any]) -> bool:
        kind = condition["type"]
        if kind == "template":
            try:
                return result_as_boolean(
                    self._templates[mode_id].async_render(parse_result=False)
                )
            except TemplateError as err:
                _LOGGER.warning("Error in the condition of mode %s: %s", mode_id, err)
                return False
        state = self._hass.states.get(condition["entity_id"])
        if state is None:
            return False
        if kind == "toggle":
            return state.state == STATE_ON
        return state.state == str(condition["state"])
