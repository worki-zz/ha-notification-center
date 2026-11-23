"""The speaker channel."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import time
from typing import TYPE_CHECKING, Any, Final

from homeassistant.components.media_player import (
    ATTR_MEDIA_ANNOUNCE,
    MediaPlayerEntityFeature,
    async_process_play_media_url,
)
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_SUPPORTED_FEATURES,
)
from homeassistant.core import (
    CALLBACK_TYPE,
    callback,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import (
    async_call_later,
)
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .media_source import sound_url
from .model import (
    BUILTIN_CHIMES,
)

if TYPE_CHECKING:
    from .cards import Card
    from .devices import DeviceManager

from .device_base import Device
from .device_colors import chime_of

_LOGGER = logging.getLogger(__name__)


# Waiting for a speaker: to start playing, and to finish.
PLAY_START_TIMEOUT: Final = 5.0
PLAY_TIMEOUT: Final = 60.0
# A Loop plays again at once; a play shorter than this (nothing to play, an
# error) waits LOOP_RETRY seconds first.
LOOP_MIN_PLAY: Final = 1.0
LOOP_RETRY: Final = 5.0
POLL: Final = 0.25


@dataclass(slots=True)
class _Played:
    """A card a speaker played: when it opened, and its repeat timer."""

    token: str
    repeat: CALLBACK_TYPE | None = None
    # Playing now (a Loop plays again when it ends).
    busy: bool = False


@dataclass(slots=True)
class Sound:
    """What a speaker plays: a chime, then maybe a text."""

    chime: str | None
    text: str | None
    notification_id: str | None = None
    # The channel's volume; None: the speaker's own.
    volume: float | None = None
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
            elif (
                played.repeat is None
                and not played.busy
                and (self._settings_of(card).get("repeat") or {}).get("type")
                in ("loop", "recurring")
            ):
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

    def _sending(self, key: tuple[str, str, str]) -> Card | None:
        """Return a card this speaker still plays, or None."""
        if key not in self._played:
            return None
        current = self.manager.engine.cards.get(key)
        if current is None or current.key not in {c.key for c in self.cards}:
            return None
        return current

    def _schedule_repeat(self, card: Card, delay: float | None = None) -> None:
        """Plan the next play: Recurring after its time, Loop right after."""
        repeat = self._settings_of(card).get("repeat") or {}
        kind = repeat.get("type")
        key = card.key
        played = self._played.get(key)
        if played is None or played.repeat is not None:
            return
        if kind == "recurring":
            every = repeat.get("every") or {}
            seconds = timedelta(**{unit: int(value) for unit, value in every.items()})
            if seconds.total_seconds() < 5:
                seconds = timedelta(seconds=5)
        elif kind == "loop":
            # Started by the end of the play; a play still going goes on.
            if delay is None:
                if played.busy:
                    return
                delay = 0
            seconds = timedelta(seconds=delay)
        else:
            return

        @callback
        def again(_now: datetime) -> None:
            played = self._played.get(key)
            if played is None:
                return
            played.repeat = None
            current = self._sending(key)
            if current is not None:
                self._play_card(current)
                if kind == "recurring":
                    self._schedule_repeat(current)

        played.repeat = async_call_later(self.hass, seconds, again)

    def _play_card(self, card: Card) -> None:
        sound = self.sound_of(card)
        key = card.key
        played = self._played.get(key)
        if played is not None:
            played.busy = True

        async def run() -> None:
            started = time.monotonic()
            try:
                await self._async_play(sound)
            finally:
                played = self._played.get(key)
                if played is not None:
                    played.busy = False
            current = self._sending(key)
            if current is None:
                return
            repeat = self._settings_of(current).get("repeat") or {}
            if repeat.get("type") == "loop":
                # Again at once; a play that ended at once (nothing to play,
                # an error) waits a little, not to call the speaker in a
                # tight loop.
                quick = time.monotonic() - started < LOOP_MIN_PLAY
                self._schedule_repeat(current, LOOP_RETRY if quick else 0)

        self.hass.async_create_background_task(run(), f"{DOMAIN} {self.key}")

    def sound_of(self, card: Card) -> Sound:
        """Return the chime and the text of a card."""
        engine = self.manager.engine
        notification = self._notification(card)
        category = engine.category_of(notification) or {}
        settings = self._settings_of(card)
        chime = (
            chime_of(notification, category)
            if settings.get("play_chime", True)
            else None
        )
        text = None
        if settings.get("read_the_message"):
            text = spoken_text(
                notification.get("name"),
                card.message,
                card.info,
                with_name=bool(settings.get("read_name")),
                with_info=bool(settings.get("read_info")),
            )
        return Sound(
            chime=chime,
            text=text,
            notification_id=card.notification_id,
            volume=settings.get("volume"),
        )

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
        volume = (
            sound.volume if sound.volume is not None else self.settings.get("volume")
        )
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
        chime = (
            chime_of(data.get("notification"), category)
            if settings.get("play_chime", True)
            else None
        )
        text = None
        if settings.get("read_the_message"):
            text = spoken_text(
                data.get("name"),
                data.get("message") or "This is a test of Notification Center.",
                data.get("info"),
                with_name=bool(settings.get("read_name")),
                with_info=bool(settings.get("read_info")),
            )
        await self._async_play(
            Sound(chime=chime, text=text, volume=settings.get("volume"))
        )


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
