"""The base of the devices of the channels."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from homeassistant.core import (
    Context,
)
from homeassistant.exceptions import HomeAssistantError

from .model import (
    ConfigData,
)

if TYPE_CHECKING:
    from .cards import Card
    from .devices import DeviceManager


_LOGGER = logging.getLogger(__name__)


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

    def config_changed(self, config: ConfigData) -> None:
        """Follow a change of the configuration (before the devices change)."""

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

    def _colors(self) -> list[dict[str, Any]]:
        """Return the own colours of the Colors list."""
        return list(self.manager.engine.manager.config.get("colors") or [])
