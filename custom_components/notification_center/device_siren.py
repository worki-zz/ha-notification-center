"""The siren channel."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any, Final

from homeassistant.const import (
    ATTR_ENTITY_ID,
)

if TYPE_CHECKING:
    from .cards import Card
    from .devices import DeviceManager

from .device_base import Device

_LOGGER = logging.getLogger(__name__)


SIREN_TEST_SECONDS: Final = 3


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
