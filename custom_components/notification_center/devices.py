"""The lights, speakers, sirens and Push: the channels that drive devices.

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
- **Push** sends each card to the phones of the people it goes to
  (``push.py``).

The Test button of a channel runs a device once, outside these rules.
"""

from __future__ import annotations

from collections.abc import Callable
import logging
from typing import TYPE_CHECKING, Any, Final

from homeassistant.core import (
    CALLBACK_TYPE,
    callback,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .device_base import Device
from .device_light import LightDevice
from .device_siren import SirenDevice
from .device_speaker import SpeakerDevice
from .model import (
    CHANNEL_LIGHT_PREFIX,
    CHANNEL_PUSH,
    CHANNEL_SIREN_PREFIX,
    CHANNEL_SPEAKER_PREFIX,
    ConfigData,
)

if TYPE_CHECKING:
    from .cards import Card
    from .engine import Engine

_LOGGER = logging.getLogger(__name__)

STORE_KEY: Final = f"{DOMAIN}.devices"
STORE_VERSION: Final = 1


class DeviceManager:
    """Run every light, speaker and siren of the configuration."""

    def __init__(self, engine: Engine) -> None:
        """Set up; call ``async_start``."""
        self.engine = engine
        self.hass = engine.hass
        self.devices: dict[str, Device] = {}
        # Devices not in the settings yet, while their tests run.
        self._testing: dict[str, tuple[Device, int]] = {}
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
        push = self.devices.get(CHANNEL_PUSH)
        if push is not None:
            push.config_changed(config)
        self._build(config)
        self.update()

    def _build(self, config: ConfigData) -> None:
        from .push import PushDevice  # noqa: PLC0415

        wanted: dict[str, tuple[type[Device], dict[str, Any]]] = {
            # Push is always there: it sends to the people who have a phone.
            CHANNEL_PUSH: (PushDevice, {}),
        }
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
        if device is not None:
            await device.async_test(data)
            return
        settings = data.get("device")
        running = self._testing.get(key)
        if running is not None:
            device = running[0]
        else:
            kind = {
                CHANNEL_LIGHT_PREFIX: LightDevice,
                CHANNEL_SPEAKER_PREFIX: SpeakerDevice,
                CHANNEL_SIREN_PREFIX: SirenDevice,
            }.get(key.split(":", 1)[0] + ":")
            if kind is None or not settings:
                raise HomeAssistantError(f"No device '{key}'")
            device = kind(self, key, settings, standalone=True)
        # The same device for tests one after the other, so the last one
        # puts it back as it was before the first.
        self._testing[key] = (device, (running[1] if running else 0) + 1)
        try:
            await device.async_test(data)
        finally:
            left = self._testing[key][1] - 1
            if left:
                self._testing[key] = (device, left)
            else:
                del self._testing[key]
