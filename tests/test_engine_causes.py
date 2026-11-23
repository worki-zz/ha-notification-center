"""Tests for the engine: what caused a change of a card."""

from __future__ import annotations

from typing import Any

from homeassistant.core import Context, Event, HomeAssistant, callback

from custom_components.notification_center.cards import Overrides
from custom_components.notification_center.const import DOMAIN

from .common import Center, step


async def test_changes_link_to_their_cause(hass: HomeAssistant, center: Center) -> None:
    """The Activity log can say why: the state is a child of the cause."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    cause = hass.states.get("binary_sensor.front")
    state = hass.states.get("sensor.nc_doors")
    assert cause is not None
    assert state is not None
    assert state.state == "active"
    assert state.context.parent_id == cause.context.id
    summary = hass.states.get("sensor.notification_center")
    assert summary is not None
    assert summary.context.parent_id == state.context.id

    context = Context()
    await hass.services.async_call(
        DOMAIN,
        "done",
        {"entity_id": "sensor.nc_doors"},
        blocking=True,
        context=context,
    )
    state = hass.states.get("sensor.nc_doors")
    assert state is not None
    assert state.state == "done"
    assert state.context.parent_id == context.id


async def test_time_driven_change_has_no_cause(
    hass: HomeAssistant, center: Center
) -> None:
    """A time driven change has no cause, but the summary still follows it."""
    nid = await center.add("Plain", step())
    runner = center.engine.runners[nid]
    center.engine.trigger(nid, next(iter(runner.steps)), None, Overrides())
    await hass.async_block_till_done()
    state = hass.states.get("sensor.nc_plain")
    assert state is not None
    assert state.state == "active"
    assert state.context.parent_id is None
    summary = hass.states.get("sensor.notification_center")
    assert summary is not None
    # The summary sensor is still caused by the notification's sensor.
    assert summary.context.parent_id == state.context.id


async def test_closing_is_caused_and_reopening_does_not_flicker(
    hass: HomeAssistant, center: Center
) -> None:
    """The entity closing a status card is the cause, and it goes to idle."""
    await center.set("binary_sensor.front", "off")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
            done_when={"activation_conditions_no_longer_true": True},
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    log: list[tuple[str, str]] = []

    @callback
    def record(event: Event[Any]) -> None:
        new = event.data["new_state"]
        if new is not None and new.entity_id in (
            "sensor.nc_doors",
            "sensor.notification_center",
        ):
            log.append((new.entity_id, new.state))

    hass.bus.async_listen("state_changed", record)
    await center.set("binary_sensor.front", "on")
    await center.set("binary_sensor.front", "off")
    door = hass.states.get("binary_sensor.front")
    state = hass.states.get("sensor.nc_doors")
    assert door is not None
    assert state is not None
    # A status goes back to idle, it is not "done today".
    assert state.state == "idle"
    assert state.context.parent_id == door.context.id

    log.clear()
    await center.set("binary_sensor.front", "on")
    # The sensor goes active, and the summary and the event follow it.
    assert [
        (entity, value) for entity, value in log if entity == "sensor.nc_doors"
    ] == [("sensor.nc_doors", "active")]
    assert [entity for entity, _ in log] == [
        "sensor.nc_doors",
        "sensor.notification_center",
    ]

    sensor = hass.states.get("sensor.nc_doors")
    summary = hass.states.get("sensor.notification_center")
    assert sensor is not None
    assert summary is not None
    assert summary.context.parent_id == sensor.context.id


async def test_entity_already_matching_has_no_cause(
    hass: HomeAssistant, center: Center
) -> None:
    """A card opened because the entity already matched has no state cause."""
    await center.set("binary_sensor.front", "on")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    state = hass.states.get("sensor.nc_doors")
    assert state is not None
    assert state.state == "active"
    assert state.context.parent_id is None
