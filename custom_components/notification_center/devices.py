"""The lights, speakers and sirens: the channels that drive devices.

Each device follows the engine. After every change it works out which
active cards it sends now (the channel rules of ``channels.py``; a silenced
card is left out) and acts:

- **A light** shows the first of those cards in the order of the
  Notifications list: its colour, or blinking (or the light's effect) for a
  highlighted notification. Before it first turns on, the light's state is
  saved; when no card is left, the light goes back to it. A change made by
  hand meanwhile wins: the light is then left as it is.
- **A speaker** plays the chime of a card once when the card starts to
  send (later too: someone arrives home, the mode changes), reads the
  message if asked, and repeats while the card still sends.
- **A siren** is on while any card sends.

The Test button of a channel runs a device once, outside these rules.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
from typing import TYPE_CHECKING, Any, Final

from homeassistant.components.media_player import (
    ATTR_MEDIA_ANNOUNCE,
    MediaPlayerEntityFeature,
    async_process_play_media_url,
)
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_SUPPORTED_FEATURES,
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
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .media_source import sound_url
from .model import (
    BUILTIN_CHIMES,
    CHANNEL_LIGHT_PREFIX,
    CHANNEL_SIREN_PREFIX,
    CHANNEL_SPEAKER_PREFIX,
    EFFECT_BLINK,
    ConfigData,
)

if TYPE_CHECKING:
    from .engine import Card, Engine

_LOGGER = logging.getLogger(__name__)

STORE_KEY: Final = f"{DOMAIN}.devices"
STORE_VERSION: Final = 1

# The RGB of Home Assistant's system colours (its default theme): what a
# light shows for a card colour, unless the light has its own.
SYSTEM_COLORS: Final[dict[str, tuple[int, int, int]]] = {
    "primary": (3, 169, 244),
    "accent": (255, 152, 0),
    "red": (244, 67, 54),
    "pink": (233, 30, 99),
    "purple": (146, 107, 199),
    "deep-purple": (110, 65, 171),
    "indigo": (63, 81, 181),
    "blue": (33, 150, 243),
    "light-blue": (3, 169, 244),
    "cyan": (0, 188, 212),
    "teal": (0, 150, 136),
    "green": (76, 175, 80),
    "light-green": (139, 195, 74),
    "lime": (205, 220, 57),
    "yellow": (255, 235, 59),
    "amber": (255, 193, 7),
    "orange": (255, 152, 0),
    "deep-orange": (255, 111, 34),
    "brown": (121, 85, 72),
    "light-grey": (189, 189, 189),
    "grey": (158, 158, 158),
    "dark-grey": (96, 96, 96),
    "blue-grey": (96, 125, 139),
    "black": (0, 0, 0),
    "white": (255, 255, 255),
}
DEFAULT_COLOR: Final = "primary"
DEFAULT_BRIGHTNESS: Final = 70

_RGB_MODES: Final = {"hs", "xy", "rgb", "rgbw", "rgbww"}
_DIM_MODES: Final = _RGB_MODES | {"color_temp", "brightness", "white"}

# Own blinking: on and off, a second each.
BLINK_INTERVAL: Final = timedelta(seconds=1)
# A state change this soon after a command is the light following it.
OWN_CHANGE_WINDOW: Final = timedelta(seconds=5)
TEST_SECONDS: Final = 10
SIREN_TEST_SECONDS: Final = 3
# Waiting for a speaker: to start playing, and to finish.
PLAY_START_TIMEOUT: Final = 5.0
PLAY_TIMEOUT: Final = 60.0
POLL: Final = 0.25

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
) -> tuple[str | None, Rgb | None]:
    """Return a notification's colour: a system colour's name, or a custom RGB.

    The notification's own colour wins over its category's. A custom colour
    carries its light colour (empty: the card colour itself).
    """
    for item in (notification or {}, category or {}):
        card = item.get("card_color")
        light = parse_color(item.get("light_color"))
        if not card and light is None:
            continue
        name = str(card).strip().lower().replace("_", "-") if card else None
        if name in SYSTEM_COLORS and light is None:
            return name, None
        return None, light or parse_color(card) or SYSTEM_COLORS[DEFAULT_COLOR]
    return DEFAULT_COLOR, None


def highlight_of(
    notification: Mapping[str, Any] | None, category: Mapping[str, Any] | None
) -> bool:
    """Return whether a notification is highlighted on the lights."""
    own = (notification or {}).get("highlight")
    if own is not None:
        return bool(own)
    return bool((category or {}).get("highlight", False))


def light_rgb(light: Mapping[str, Any], name: str | None, custom: Rgb | None) -> Rgb:
    """Return what a light shows for a colour: its own RGB of a system colour."""
    if custom is not None:
        return custom
    name = name or DEFAULT_COLOR
    own = parse_color((light.get("colors") or {}).get(name))
    return own or SYSTEM_COLORS.get(name, SYSTEM_COLORS[DEFAULT_COLOR])


@dataclass(slots=True)
class Look:
    """What a light shows: colour, brightness and highlight."""

    rgb: Rgb
    highlight: bool
    notification_id: str | None = None


class DeviceManager:
    """Run every light, speaker and siren of the configuration."""

    def __init__(self, engine: Engine) -> None:
        """Set up; call ``async_start``."""
        self.engine = engine
        self.hass = engine.hass
        self.devices: dict[str, Device] = {}
        self._store = Store[dict[str, Any]](self.hass, STORE_VERSION, STORE_KEY)
        self._saved: dict[str, Any] = {}
        self._unsubs: list[CALLBACK_TYPE] = []
        self._listeners: list[Callable[[], None]] = []

    async def async_start(self) -> None:
        """Read the saved light states and follow the engine."""
        self._saved = await self._store.async_load() or {}
        self._build(self.engine.manager.config)
        self._unsubs.append(
            self.engine.manager.async_add_listener(self._config_changed)
        )
        self._unsubs.append(self.engine.async_add_listener(self.update))
        self.update()

    async def async_stop(self) -> None:
        """Stop the timers; the lights stay as they are, their state saved."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for device in self.devices.values():
            device.stop()
        await self._store.async_save(self._saved)

    @callback
    def add_listener(self, listener: Callable[[], None]) -> CALLBACK_TYPE:
        """Call the listener when a device changes what it does."""
        self._listeners.append(listener)

        @callback
        def remove() -> None:
            self._listeners.remove(listener)

        return remove

    @callback
    def changed(self) -> None:
        """Tell the listeners (the diagnostic sensors)."""
        for listener in list(self._listeners):
            listener()

    def saved(self, key: str) -> Any:
        """Return what a device saved (a light's state before it turned on)."""
        return self._saved.get(key)

    def save(self, key: str, value: Any) -> None:
        """Keep what a device saved, across restarts."""
        if value is None:
            self._saved.pop(key, None)
        else:
            self._saved[key] = value
        self._store.async_delay_save(lambda: self._saved, 1)

    @callback
    def _config_changed(self, config: ConfigData) -> None:
        self._build(config)
        self.update()

    def _build(self, config: ConfigData) -> None:
        wanted: dict[str, tuple[type[Device], dict[str, Any]]] = {}
        for light in config.get("lights", []):
            wanted[CHANNEL_LIGHT_PREFIX + light["id"]] = (LightDevice, light)
        for speaker in config.get("speakers", []):
            wanted[CHANNEL_SPEAKER_PREFIX + speaker["id"]] = (SpeakerDevice, speaker)
        for siren in config.get("sirens", []):
            wanted[CHANNEL_SIREN_PREFIX + siren["id"]] = (SirenDevice, siren)
        for key in list(self.devices):
            kind, settings = wanted.get(key, (None, None))
            device = self.devices[key]
            if kind is None or not isinstance(device, kind):
                device.release()
                device.stop()
                del self.devices[key]
            elif settings is not None and settings != device.settings:
                device.settings = settings
                device.reconfigure()
        for key, (kind, settings) in wanted.items():
            if key not in self.devices:
                self.devices[key] = kind(self, key, settings)

    @callback
    def update(self) -> None:
        """Let every device follow the cards."""
        if not self.engine.started:
            return
        for device in self.devices.values():
            device.update(self.sending(device.key))

    def sending(self, key: str) -> list[Card]:
        """Return the cards a channel sends now, in the Notifications order."""
        engine = self.engine
        result: list[tuple[tuple[int, int], Card]] = []
        order = {
            item["id"]: index
            for index, item in enumerate(engine.manager.config["notifications"])
        }
        for card in engine.cards.values():
            if card.status != "active" or card.silenced:
                continue
            if card.notification_id not in order:
                continue
            if not engine.channel_view(card, key).sends:
                continue
            result.append(
                (
                    (
                        order[card.notification_id],
                        engine.step_number(card.notification_id, card.step_id) or 0,
                    ),
                    card,
                )
            )
        result.sort(key=lambda item: (item[0], item[1].entity_id or ""))
        return [card for _, card in result]

    def summary(self, key: str) -> dict[str, Any]:
        """Return what a device does now, for its diagnostic sensor."""
        device = self.devices.get(key)
        return device.summary() if device else {}

    async def async_test(self, key: str, data: dict[str, Any]) -> None:
        """Run a device once, as its channel's Test button asks."""
        device = self.devices.get(key)
        settings = data.get("device")
        if device is None:
            kind = {
                CHANNEL_LIGHT_PREFIX: LightDevice,
                CHANNEL_SPEAKER_PREFIX: SpeakerDevice,
                CHANNEL_SIREN_PREFIX: SirenDevice,
            }.get(key.split(":", 1)[0] + ":")
            if kind is None or not settings:
                raise HomeAssistantError(f"No device '{key}'")
            device = kind(self, key, settings, standalone=True)
        await device.async_test(data)


class Device:
    """A device channel."""

    def __init__(
        self,
        manager: DeviceManager,
        key: str,
        settings: dict[str, Any],
        *,
        standalone: bool = False,
    ) -> None:
        """Set up the device."""
        self.manager = manager
        self.hass = manager.hass
        self.key = key
        self.settings = settings
        self.standalone = standalone
        self.cards: list[Card] = []

    @property
    def entity_id(self) -> str:
        """Return the entity the device drives."""
        return str(self.settings["entity_id"])

    def update(self, cards: list[Card]) -> None:
        """Follow the cards the channel sends now."""
        self.cards = cards

    def reconfigure(self) -> None:
        """Take the changed settings."""

    def release(self) -> None:
        """Leave the device as it was before: it was removed."""

    def stop(self) -> None:
        """Stop the timers."""

    def summary(self) -> dict[str, Any]:
        """Return what the device does now."""
        return {"state": len(self.cards)}

    async def async_test(self, data: dict[str, Any]) -> None:
        """Run the device once."""

    async def _call(
        self,
        domain: str,
        service: str,
        data: dict[str, Any],
        context: Context | None = None,
        *,
        blocking: bool = False,
    ) -> None:
        try:
            await self.hass.services.async_call(
                domain, service, data, blocking=blocking, context=context
            )
        except (HomeAssistantError, ValueError) as err:
            _LOGGER.warning("%s: %s.%s failed: %s", self.key, domain, service, err)

    def _notification(self, card: Card) -> dict[str, Any]:
        return self.manager.engine.notification_config(card.notification_id) or {}


# ---------------------------------------------------------------------------
# Lights


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
        self._contexts: set[str] = set()
        # A change by hand: the light is left alone until no card is left.
        self._hand = False
        self._testing = False
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
        name, custom = color_of(notification, category)
        look = Look(
            rgb=light_rgb(self.settings, name, custom),
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
        self._contexts.add(context.id)
        if len(self._contexts) > 50:
            self._contexts.pop()
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
        if data.get("device"):
            self.settings = {**self.settings, **data["device"]}
        name, custom = color_of(data.get("notification"), data.get("category"))
        if data.get("color"):
            name, custom = (
                (data["color"], None)
                if data["color"] in SYSTEM_COLORS
                else (None, parse_color(data["color"]))
            )
        look = Look(
            rgb=light_rgb(self.settings, name, custom),
            highlight=bool(data.get("highlight"))
            or highlight_of(data.get("notification"), data.get("category")),
        )
        previous = self.look
        saved = self.manager.saved(self.key) or self._snapshot()
        self._testing = True
        self.look = look
        self._applied = None
        self._stop_blink()
        try:
            await self._async_on(self._on_data(look))
            if self._own_blink(look):
                self._blink_on = True
                self._blink = async_track_time_interval(
                    self.hass, self._blink_step, BLINK_INTERVAL
                )
            await asyncio.sleep(TEST_SECONDS)
        finally:
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


# ---------------------------------------------------------------------------
# Speakers


@dataclass(slots=True)
class _Played:
    """A card a speaker played: when it opened, and its repeat timer."""

    token: str
    repeat: CALLBACK_TYPE | None = None


@dataclass(slots=True)
class Sound:
    """What a speaker plays: a chime, then maybe a text."""

    chime: str | None
    text: str | None
    notification_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class SpeakerDevice(Device):
    """A speaker that plays the chime of each card once (and repeats)."""

    def __init__(
        self,
        manager: DeviceManager,
        key: str,
        settings: dict[str, Any],
        *,
        standalone: bool = False,
    ) -> None:
        """Set up the speaker."""
        super().__init__(manager, key, settings, standalone=standalone)
        self._played: dict[tuple[str, str, str], _Played] = {}
        self._lock = asyncio.Lock()
        self.last_played: datetime | None = None
        self.last_notification: str | None = None
        self.playing = False

    def stop(self) -> None:
        """Stop the repeat timers."""
        for played in self._played.values():
            if played.repeat is not None:
                played.repeat()
        self._played.clear()

    def update(self, cards: list[Card]) -> None:
        """Play each card that starts to send; forget closed cards."""
        super().update(cards)
        engine = self.manager.engine
        sending = {card.key: card for card in cards}
        for key in list(self._played):
            card = engine.cards.get(key)
            token = _token(card) if card is not None else None
            if card is None or not card.is_open or token != self._played[key].token:
                self._forget(key)
            elif key not in sending:
                self._cancel_repeat(key)
        for key, card in sending.items():
            played = self._played.get(key)
            if played is None:
                self._played[key] = _Played(_token(card))
                self._play_card(card)
                self._schedule_repeat(card)
            elif played.repeat is None and self._settings_of(card).get("repeat"):
                # Sending again (the mode came back): only the repeat goes on.
                self._schedule_repeat(card)

    def _forget(self, key: tuple[str, str, str]) -> None:
        self._cancel_repeat(key)
        self._played.pop(key, None)

    def _cancel_repeat(self, key: tuple[str, str, str]) -> None:
        played = self._played.get(key)
        if played is not None and played.repeat is not None:
            played.repeat()
            played.repeat = None

    def _settings_of(self, card: Card) -> dict[str, Any]:
        return self.manager.engine.channel_settings_of(card, self.key) or {}

    def _schedule_repeat(self, card: Card) -> None:
        repeat = self._settings_of(card).get("repeat") or {}
        if repeat.get("type") != "until_muted":
            return
        every = repeat.get("every") or {}
        seconds = timedelta(**{unit: int(value) for unit, value in every.items()})
        if seconds.total_seconds() < 5:
            seconds = timedelta(seconds=5)
        key = card.key

        @callback
        def again(_now: datetime) -> None:
            played = self._played.get(key)
            if played is None:
                return
            played.repeat = None
            current = self.manager.engine.cards.get(key)
            if current is not None and current.key in {c.key for c in self.cards}:
                self._play_card(current)
                self._schedule_repeat(current)

        played = self._played.get(key)
        if played is not None:
            played.repeat = async_call_later(self.hass, seconds, again)

    def _play_card(self, card: Card) -> None:
        sound = self.sound_of(card)
        self.hass.async_create_background_task(
            self._async_play(sound), f"{DOMAIN} {self.key}"
        )

    def sound_of(self, card: Card) -> Sound:
        """Return the chime and the text of a card."""
        engine = self.manager.engine
        notification = self._notification(card)
        category = engine.category_of(notification) or {}
        settings = self._settings_of(card)
        chime = settings.get("chime", category.get("chime"))
        text = None
        if settings.get("read_the_message"):
            text = spoken_text(
                notification.get("name"),
                card.message,
                card.info,
                with_name=bool(settings.get("read_name")),
                with_info=bool(settings.get("read_info")),
            )
        return Sound(chime=chime, text=text, notification_id=card.notification_id)

    async def _async_play(self, sound: Sound) -> None:
        async with self._lock:
            self.playing = True
            self.last_played = dt_util.utcnow()
            self.last_notification = sound.notification_id
            self.manager.changed()
            try:
                await self._async_play_locked(sound)
            except HomeAssistantError as err:
                _LOGGER.warning("%s: could not play: %s", self.entity_id, err)
            finally:
                self.playing = False
                self.manager.changed()

    def _announce(self) -> bool:
        state = self.hass.states.get(self.entity_id)
        features = int(state.attributes.get(ATTR_SUPPORTED_FEATURES, 0)) if state else 0
        return bool(features & MediaPlayerEntityFeature.MEDIA_ANNOUNCE)

    async def _async_play_locked(self, sound: Sound) -> None:
        announce = self._announce()
        volume = self.settings.get("volume")
        restore: float | None = None
        if volume is not None and not announce:
            state = self.hass.states.get(self.entity_id)
            current = state.attributes.get("volume_level") if state else None
            if current is not None and abs(float(current) - float(volume)) > 0.001:
                restore = float(current)
                await self._call(
                    "media_player",
                    "volume_set",
                    {ATTR_ENTITY_ID: self.entity_id, "volume_level": volume},
                    blocking=True,
                )
        try:
            media = await self._async_chime_media(sound.chime)
            if media is not None:
                await self._async_play_media(*media, announce=announce)
            if sound.text:
                await self._async_speak(sound.text, announce=announce)
        finally:
            if restore is not None:
                await self._call(
                    "media_player",
                    "volume_set",
                    {ATTR_ENTITY_ID: self.entity_id, "volume_level": restore},
                    blocking=True,
                )

    async def _async_chime_media(self, chime: str | None) -> tuple[str, str] | None:
        if not chime:
            return None
        if chime in BUILTIN_CHIMES:
            url = sound_url(chime) or ""
            try:
                url = async_process_play_media_url(self.hass, url)
            except Exception as err:
                _LOGGER.warning("%s: no URL for the sound: %s", self.key, err)
            return (url, "music")
        item = next(
            (
                item
                for item in self.manager.engine.manager.config.get("chimes", [])
                if item["id"] == chime
            ),
            None,
        )
        if item is None:
            return None
        media = item["media"]
        return (media["media_content_id"], media.get("media_content_type") or "music")

    async def _async_play_media(
        self, content_id: str, content_type: str, *, announce: bool
    ) -> None:
        data: dict[str, Any] = {
            ATTR_ENTITY_ID: self.entity_id,
            "media_content_id": content_id,
            "media_content_type": content_type,
        }
        if announce:
            data[ATTR_MEDIA_ANNOUNCE] = True
        await self._call("media_player", "play_media", data, blocking=True)
        await self._async_wait()

    async def _async_speak(self, text: str, *, announce: bool) -> None:
        general = self.manager.engine.manager.config.get("general", {})
        reading = general.get("read_the_message") or {}
        engine = reading.get("tts_service")
        if not engine:
            _LOGGER.warning("%s: no text-to-speech set for Read the message", self.key)
            return
        data: dict[str, Any] = {
            ATTR_ENTITY_ID: engine,
            "media_player_entity_id": self.entity_id,
            "message": text,
        }
        if reading.get("language"):
            data["language"] = reading["language"]
        await self._call("tts", "speak", data, blocking=True)
        await self._async_wait()

    async def _async_wait(self) -> None:
        """Wait until the speaker played what it was given."""
        waited = 0.0
        started = False
        while waited < PLAY_TIMEOUT:
            state = self.hass.states.get(self.entity_id)
            playing = state is not None and state.state in ("playing", "buffering")
            if playing:
                started = True
            elif started or waited >= PLAY_START_TIMEOUT:
                return
            await asyncio.sleep(POLL)
            waited += POLL

    def summary(self) -> dict[str, Any]:
        """Return the cards, and what was played last."""
        notification = (
            self.manager.engine.notification_config(self.last_notification)
            if self.last_notification
            else None
        )
        return {
            "state": len(self.cards),
            "playing": self.playing,
            "last_played": self.last_played.isoformat() if self.last_played else None,
            "last_notification": notification["name"] if notification else None,
        }

    async def async_test(self, data: dict[str, Any]) -> None:
        """Play the chime and read a sample text."""
        if data.get("device"):
            self.settings = {**self.settings, **data["device"]}
        settings = data.get("settings") or {}
        category = data.get("category") or {}
        chime = settings.get("chime", category.get("chime"))
        text = None
        if settings.get("read_the_message"):
            text = spoken_text(
                data.get("name"),
                data.get("message") or "This is a test of Notification Center.",
                data.get("info"),
                with_name=bool(settings.get("read_name")),
                with_info=bool(settings.get("read_info")),
            )
        await self._async_play(Sound(chime=chime, text=text))


def spoken_text(
    name: str | None,
    message: str | None,
    info: str | None,
    *,
    with_name: bool = False,
    with_info: bool = False,
) -> str | None:
    """Return what Read the message says: the message, maybe name and Info."""
    parts = [
        part.strip().rstrip(".") + "."
        for part in (
            name if with_name else None,
            message,
            info if with_info else None,
        )
        if part and part.strip()
    ]
    return " ".join(parts) or None


def _token(card: Card) -> str:
    when = card.active_since or card.state_since
    return when.isoformat()


# ---------------------------------------------------------------------------
# Sirens


class SirenDevice(Device):
    """A siren (or a switch, or a select) that sounds while a card sends."""

    def __init__(
        self,
        manager: DeviceManager,
        key: str,
        settings: dict[str, Any],
        *,
        standalone: bool = False,
    ) -> None:
        """Set up the siren."""
        super().__init__(manager, key, settings, standalone=standalone)
        self.on = False

    @property
    def domain(self) -> str:
        """Return the domain of the entity."""
        return self.entity_id.split(".", 1)[0]

    def update(self, cards: list[Card]) -> None:
        """Sound while a card sends."""
        super().update(cards)
        wanted = bool(cards)
        if wanted != self.on:
            self.on = wanted
            self.hass.async_create_task(
                self._async_on() if wanted else self._async_off(), eager_start=True
            )
            self.manager.changed()

    def release(self) -> None:
        """Stop the siren: it was removed from the settings."""
        if self.on:
            self.on = False
            self.hass.async_create_task(self._async_off(), eager_start=True)

    async def _async_on(self) -> None:
        target = {ATTR_ENTITY_ID: self.entity_id}
        if self.domain == "select":
            if option := self.settings.get("option"):
                await self._call(
                    "select", "select_option", {**target, "option": option}
                )
            return
        if self.domain == "switch":
            await self._call("switch", "turn_on", target)
            return
        data: dict[str, Any] = dict(target)
        if self.settings.get("tone"):
            data["tone"] = self.settings["tone"]
        if self.settings.get("volume") is not None:
            data["volume_level"] = self.settings["volume"]
        if self.settings.get("duration"):
            data["duration"] = int(self.settings["duration"])
        await self._call("siren", "turn_on", data)

    async def _async_off(self) -> None:
        target = {ATTR_ENTITY_ID: self.entity_id}
        if self.domain == "select":
            if option := self.settings.get("stop_option"):
                await self._call(
                    "select", "select_option", {**target, "option": option}
                )
            return
        await self._call(self.domain, "turn_off", target)

    def summary(self) -> dict[str, Any]:
        """Return whether the siren sounds."""
        return {"state": len(self.cards), "sounding": self.on}

    async def async_test(self, data: dict[str, Any]) -> None:
        """Sound for a few seconds."""
        if data.get("device"):
            self.settings = {**self.settings, **data["device"]}
        if self.on and not self.standalone:
            return
        await self._async_on()
        await asyncio.sleep(SIREN_TEST_SECONDS)
        if not self.on or self.standalone:
            await self._async_off()
