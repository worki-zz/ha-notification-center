"""Helpers shared by the engine tests."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.engine import Engine
from custom_components.notification_center.store import ConfigManager

DOOR_GROUP = {"domain": "binary_sensor", "device_class": "door"}


class Center:
    """The loaded integration, with shortcuts for the tests."""

    def __init__(self, hass: HomeAssistant, entry: MockConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.engine.async_add_event_listener(
            lambda kind, data: self.events.append((kind, data))
        )

    @property
    def engine(self) -> Engine:
        engine: Engine = self.entry.runtime_data.engine
        return engine

    @property
    def manager(self) -> ConfigManager:
        manager: ConfigManager = self.entry.runtime_data.manager
        return manager

    async def add(self, name: str, *steps: dict[str, Any], **extra: Any) -> str:
        item = await self.manager.async_create(
            "notifications", {"name": name, "steps": list(steps), **extra}
        )
        await self.hass.async_block_till_done()
        return str(item["id"])

    def state(self, entity_id: str) -> str:
        state = self.hass.states.get(entity_id)
        assert state is not None, entity_id
        return state.state

    def attrs(self, entity_id: str) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        assert state is not None, entity_id
        return dict(state.attributes)

    def kinds(self) -> list[str]:
        return [kind for kind, _ in self.events]

    async def call(self, service: str, entity_id: str, **data: Any) -> None:
        await self.hass.services.async_call(
            DOMAIN, service, {"entity_id": entity_id, **data}, blocking=True
        )
        await self.hass.async_block_till_done()

    async def set(self, entity_id: str, state: str, **attributes: Any) -> None:
        self.hass.states.async_set(entity_id, state, attributes)
        await self.hass.async_block_till_done()


async def load(hass: HomeAssistant, entry: MockConfigEntry) -> Center:
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return Center(hass, entry)


def step(message: str = "Do it", **extra: Any) -> dict[str, Any]:
    """Return a step with a message."""
    return {"message": message, **extra}
