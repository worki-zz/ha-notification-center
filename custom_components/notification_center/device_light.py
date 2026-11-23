"""The light channel."""

from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timedelta
import logging
from typing import TYPE_CHECKING, Any, Final

from homeassistant.const import (
    ATTR_ENTITY_ID,
    STATE_ON,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import (
    CALLBACK_TYPE,
    Context,
    Event,
    EventStateChangedData,
    callback,
)
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from .model import (
    EFFECT_BLINK,
)

if TYPE_CHECKING:
    from .cards import Card
    from .devices import DeviceManager

from .device_base import Device
from .device_colors import DEFAULT_BRIGHTNESS, Look, color_of, highlight_of, light_rgb

_LOGGER = logging.getLogger(__name__)


_RGB_MODES: Final = {"hs", "xy", "rgb", "rgbw", "rgbww"}
_DIM_MODES: Final = _RGB_MODES | {"color_temp", "brightness", "white"}

# Own blinking: on and off, a second each.
BLINK_INTERVAL: Final = timedelta(seconds=1)
# A state change this soon after a command is the light following it.
OWN_CHANGE_WINDOW: Final = timedelta(seconds=5)
TEST_SECONDS: Final = 10


class LightDevice(Device):
    """A light (or a switch) that shows the first card it sends."""

    def __init__(
        self,
        manager: DeviceManager,
        key: str,
        settings: dict[str, Any],
        *,
        standalone: bool = False,
    ) -> None:
        """Set up the light."""
        super().__init__(manager, key, settings, standalone=standalone)
        self.look: Look | None = None
        self._applied: tuple[Any, ...] | None = None
        self._blink: CALLBACK_TYPE | None = None
        self._blink_on = True
        self._last_command: datetime | None = None
        self._contexts: deque[str] = deque(maxlen=50)
        # A change by hand: the light is left alone until no card is left.
        self._hand = False
        self._testing = False
        # The tests running one after the other: what to go back to after
        # the last one (the look and the light before the first one).
        self._test_run = 0
        self._test_before: tuple[Look | None, dict[str, Any] | None] | None = None
        self._unsub_state: CALLBACK_TYPE | None = None
        self._unsub_lux: CALLBACK_TYPE | None = None
        if not standalone:
            self._follow()

    # -- What the light can do ----------------------------------------------

    @property
    def is_switch(self) -> bool:
        """Return whether it is a switch (on and off only)."""
        return self.entity_id.startswith("switch.")

    def _modes(self) -> set[str]:
        state = self.hass.states.get(self.entity_id)
        if state is None:
            return set()
        return set(state.attributes.get("supported_color_modes") or [])

    def _effects(self) -> list[str]:
        state = self.hass.states.get(self.entity_id)
        return list(state.attributes.get("effect_list") or []) if state else []

    # -- Following the state ------------------------------------------------

    def _follow(self) -> None:
        self._unsub_state = async_track_state_change_event(
            self.hass, [self.entity_id], self._state_changed
        )
        self._follow_lux()

    def _follow_lux(self) -> None:
        if self._unsub_lux is not None:
            self._unsub_lux()
            self._unsub_lux = None
        sensor = self.settings.get("illuminance_sensor")
        if sensor and self.settings.get("dim_continuously"):
            self._unsub_lux = async_track_state_change_event(
                self.hass, [sensor], self._lux_changed
            )

    def reconfigure(self) -> None:
        """Follow the (maybe new) entity and sensor, and show again."""
        self.stop()
        self._follow()
        # The look follows the settings (colour, brightness): it is made
        # again by the update that follows a change, and shown.
        self.look = None
        self._applied = None

    def stop(self) -> None:
        """Stop following and blinking."""
        self._stop_blink()
        for name in ("_unsub_state", "_unsub_lux"):
            if (unsub := getattr(self, name)) is not None:
                unsub()
                setattr(self, name, None)

    @callback
    def _state_changed(self, event: Event[EventStateChangedData]) -> None:
        new = event.data["new_state"]
        if new is None or self.look is None or self._testing:
            return
        if new.context.id in self._contexts or new.context.parent_id in self._contexts:
            return
        if self._blink is not None:
            # Blinking sends a command every second: nothing to tell apart.
            return
        now = dt_util.utcnow()
        if self._last_command and now - self._last_command < OWN_CHANGE_WINDOW:
            return
        old = event.data["old_state"]
        if (
            old is not None
            and old.state == new.state
            and old.attributes == new.attributes
        ):
            return
        _LOGGER.debug("%s: changed by hand, left as it is", self.entity_id)
        self._hand = True
        self.look = None
        self._applied = None
        self.manager.save(self.key, None)
        self.manager.changed()

    @callback
    def _lux_changed(self, _event: Event[EventStateChangedData]) -> None:
        if self.look is not None and not self._hand:
            self._apply(self.look)

    # -- Showing the cards --------------------------------------------------

    def update(self, cards: list[Card]) -> None:
        """Show the first card, or go back to the saved state."""
        super().update(cards)
        if self._testing:
            return
        if not cards:
            self._hand = False
            if self.look is not None or self.manager.saved(self.key) is not None:
                self.look = None
                self._applied = None
                self._stop_blink()
                self.hass.async_create_task(self._async_restore(), eager_start=True)
                self.manager.changed()
            return
        if self._hand:
            return
        card = cards[0]
        notification = self._notification(card)
        category = self.manager.engine.category_of(notification)
        look = Look(
            rgb=light_rgb(
                self.settings, color_of(notification, category), self._colors()
            ),
            highlight=highlight_of(notification, category),
            notification_id=card.notification_id,
        )
        if look != self.look:
            self.look = look
            self._apply(look)
            self.manager.changed()

    def _brightness(self) -> int:
        brightness = self.settings.get("brightness") or DEFAULT_BRIGHTNESS
        sensor = self.settings.get("illuminance_sensor")
        below = self.settings.get("dim_below")
        dim = self.settings.get("dim_brightness")
        if sensor and below is not None and dim:
            state = self.hass.states.get(sensor)
            try:
                lux = float(state.state) if state else None
            except ValueError:
                lux = None
            if lux is not None and lux < float(below):
                return int(dim)
        return int(brightness)

    def _on_data(self, look: Look) -> dict[str, Any]:
        if self.is_switch:
            return {}
        modes = self._modes()
        data: dict[str, Any] = {}
        if modes & _RGB_MODES:
            data["rgb_color"] = list(look.rgb)
        elif "color_temp" in modes and self.settings.get("color_temp_kelvin"):
            data["color_temp_kelvin"] = int(self.settings["color_temp_kelvin"])
        if not modes or modes & _DIM_MODES:
            data["brightness_pct"] = self._brightness()
        effect = self.settings.get("effect") or EFFECT_BLINK
        if look.highlight and effect != EFFECT_BLINK and effect in self._effects():
            data["effect"] = effect
        return data

    def _own_blink(self, look: Look) -> bool:
        effect = self.settings.get("effect") or EFFECT_BLINK
        return look.highlight and (
            self.is_switch or effect == EFFECT_BLINK or effect not in self._effects()
        )

    def _apply(self, look: Look) -> None:
        data = self._on_data(look)
        blink = self._own_blink(look)
        applied = (tuple(sorted((k, str(v)) for k, v in data.items())), blink)
        if applied == self._applied:
            return
        self._applied = applied
        if self.manager.saved(self.key) is None and not self.standalone:
            self.manager.save(self.key, self._snapshot())
        self._stop_blink()
        self.hass.async_create_task(self._async_on(data), eager_start=True)
        if blink:
            self._blink_on = True
            self._blink = async_track_time_interval(
                self.hass, self._blink_step, BLINK_INTERVAL
            )

    @callback
    def _blink_step(self, _now: datetime) -> None:
        if self.look is None and not self._testing:
            self._stop_blink()
            return
        self._blink_on = not self._blink_on
        if self._blink_on and (look := self.look) is not None:
            self.hass.async_create_task(
                self._async_on(self._on_data(look)), eager_start=True
            )
        else:
            self.hass.async_create_task(self._async_off(), eager_start=True)

    def _stop_blink(self) -> None:
        if self._blink is not None:
            self._blink()
            self._blink = None

    def _context(self) -> Context:
        context = Context()
        self._contexts.append(context.id)
        self._last_command = dt_util.utcnow()
        return context

    async def _async_on(self, data: dict[str, Any]) -> None:
        domain = "switch" if self.is_switch else "light"
        await self._call(
            domain, "turn_on", {ATTR_ENTITY_ID: self.entity_id, **data}, self._context()
        )

    async def _async_off(self) -> None:
        domain = "switch" if self.is_switch else "light"
        await self._call(
            domain, "turn_off", {ATTR_ENTITY_ID: self.entity_id}, self._context()
        )

    def _snapshot(self) -> dict[str, Any] | None:
        state = self.hass.states.get(self.entity_id)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            return {"state": "off"}
        attributes = state.attributes
        saved: dict[str, Any] = {"state": state.state}
        if state.state == STATE_ON and not self.is_switch:
            mode = attributes.get("color_mode")
            for name in ("brightness", "effect"):
                if attributes.get(name) is not None:
                    saved[name] = attributes[name]
            if mode == "color_temp" and attributes.get("color_temp_kelvin"):
                saved["color_temp_kelvin"] = attributes["color_temp_kelvin"]
            elif mode in ("rgbw", "rgbww") and attributes.get(f"{mode}_color"):
                saved[f"{mode}_color"] = list(attributes[f"{mode}_color"])
            elif mode in _RGB_MODES and attributes.get("hs_color"):
                saved["hs_color"] = list(attributes["hs_color"])
        return saved

    async def _async_restore(self, saved: dict[str, Any] | None = None) -> None:
        if saved is None:
            saved = self.manager.saved(self.key)
            self.manager.save(self.key, None)
        if not saved:
            return
        if saved.get("state") != STATE_ON:
            await self._async_off()
            return
        data = {key: value for key, value in saved.items() if key != "state"}
        if data.get("effect") in (None, "none", "off") or self.is_switch:
            data.pop("effect", None)
        await self._async_on(data)

    def release(self) -> None:
        """Put the light back: it was removed from the settings."""
        if self.look is not None:
            self.look = None
            self._stop_blink()
            self.hass.async_create_task(self._async_restore(), eager_start=True)

    def summary(self) -> dict[str, Any]:
        """Return the shown notification and its colour."""
        notification = (
            self.manager.engine.notification_config(self.look.notification_id)
            if self.look and self.look.notification_id
            else None
        )
        return {
            "state": len(self.cards),
            "showing": notification["name"] if notification else None,
            "color": list(self.look.rgb) if self.look else None,
            "highlight": self.look.highlight if self.look else False,
            "changed_by_hand": self._hand,
        }

    async def async_test(self, data: dict[str, Any]) -> None:
        """Show a colour for a few seconds, then go back."""
        # A test while another runs: the light goes back to how it was
        # before the first one, after the last one.
        if self._test_before is None:
            self._test_before = (
                self.look,
                self.manager.saved(self.key) or self._snapshot(),
            )
        previous, saved = self._test_before
        self._test_run += 1
        run = self._test_run
        self._testing = True
        self._applied = None
        self._stop_blink()
        try:
            with self._test_settings(data):
                color = data.get("color") or color_of(
                    data.get("notification"), data.get("category")
                )
                look = Look(
                    rgb=light_rgb(self.settings, color, self._colors()),
                    highlight=bool(data.get("highlight"))
                    or highlight_of(data.get("notification"), data.get("category")),
                )
                self.look = look
                await self._async_on(self._on_data(look))
                if self._own_blink(look):
                    self._blink_on = True
                    self._blink = async_track_time_interval(
                        self.hass, self._blink_step, BLINK_INTERVAL
                    )
                await asyncio.sleep(TEST_SECONDS)
        finally:
            if run == self._test_run:
                await self._async_end_test(previous, saved)

    async def _async_end_test(
        self, previous: Look | None, saved: dict[str, Any] | None
    ) -> None:
        """Go back after the last test: to the card shown, or the light before."""
        self._test_before = None
        self._stop_blink()
        self._testing = False
        if self.standalone:
            self.settings = dict(self.settings)
        self.look = previous
        self._applied = None
        if previous is not None and not self.standalone:
            self._apply(previous)
        else:
            await self._async_restore(saved)
