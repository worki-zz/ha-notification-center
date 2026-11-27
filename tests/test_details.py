"""The Notification details: Undo, and the cards dismissed today."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
import pytest
from pytest_homeassistant_custom_component.common import async_mock_service
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center.const import DOMAIN

from .common import Center, step, tick


def _ring(text: str) -> dict[str, Any]:
    return {"ha_actions": [{"action": "test.ring", "data": {"what": text}}]}


def _ids(center: Center, name: str) -> tuple[str, str]:
    item = next(
        item for item in center.manager.config["notifications"] if item["name"] == name
    )
    return item["id"], item["steps"][0]["id"]


def _cards(center: Center, notification_id: str) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = center.engine.snapshot()["notifications"][
        notification_id
    ]["cards"]
    return cards


async def test_undo_done(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """Undo brings a done card back as it was, muted, without status actions."""
    calls = async_mock_service(hass, "test", "ring")
    await center.add(
        "Dishwasher",
        step(
            "Unload it",
            activation={"type": "triggers", "actions": _ring("active")},
            done_when={"actions": _ring("done")},
        ),
    )
    nid, sid = _ids(center, "Dishwasher")
    await center.call("trigger", "sensor.nc_dishwasher")
    since = center.engine.cards[(nid, sid, "")].active_since
    await tick(hass, freezer, timedelta(minutes=5))
    await center.call("done", "sensor.nc_dishwasher")
    assert center.state("sensor.nc_dishwasher") == "done"

    card = center.engine.undo(nid, sid, None)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_dishwasher") == "active"
    assert card.active_since == since
    assert card.muted is True
    assert card.closed_at is None
    assert [call.data["what"] for call in calls] == ["active", "done"]

    # Open: nothing to undo.
    with pytest.raises(ServiceValidationError, match="open"):
        center.engine.undo(nid, sid, None)


async def test_dismissed_card_stays_for_the_day(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """A dismissed card shows in the details until midnight, and Undo works."""
    await center.add("Plants", step("Water the plants"))
    nid, sid = _ids(center, "Plants")
    await center.call("trigger", "sensor.nc_plants")
    await center.call("clear", "sensor.nc_plants")
    assert (nid, sid, "") not in center.engine.cards
    assert [card["status"] for card in _cards(center, nid)] == ["dismissed"]
    # The sensor does not count it.
    assert center.state("sensor.nc_plants") == "idle"

    center.engine.undo(nid, sid, None)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "active"
    assert [card["status"] for card in _cards(center, nid)] == ["active"]

    await center.call("clear", "sensor.nc_plants")
    # A new card of the step: the dismissed one cannot come back.
    await center.call("trigger", "sensor.nc_plants")
    await center.call("done", "sensor.nc_plants")
    assert [card["status"] for card in _cards(center, nid)] == ["done"]

    await center.call("clear", "sensor.nc_plants")
    await tick(hass, freezer, timedelta(days=1))
    assert _cards(center, nid) == [] or all(
        card["status"] == "done" for card in _cards(center, nid)
    )
    assert center.engine.dismissed == {}
    with pytest.raises(ServiceValidationError, match="today"):
        center.engine.undo(nid, sid, None)


async def test_undo_refused(hass: HomeAssistant, center: Center) -> None:
    """A card never active, or a newer card of the step, keeps it closed."""
    await center.add(
        "Waste",
        step(
            "Put out the bin",
            activation={
                "type": "schedule",
                "schedule": {
                    "type": "calendar",
                    "every": 1,
                    "unit": "days",
                    "at": "23:59",
                },
            },
        ),
    )
    nid, sid = _ids(center, "Waste")
    center.engine.done_early(nid, sid)
    await hass.async_block_till_done()
    with pytest.raises(ServiceValidationError, match="never active"):
        center.engine.undo(nid, sid, None)

    await center.add("Door", step("The door is open"))
    door, door_step = _ids(center, "Door")
    with pytest.raises(ServiceValidationError, match="today"):
        center.engine.undo(door, door_step, None)


async def test_undo_websocket(
    hass: HomeAssistant, center: Center, hass_ws_client: WebSocketGenerator
) -> None:
    """Any user can undo through the websocket API."""
    await center.add("Mail", step("Mail is here"))
    nid, sid = _ids(center, "Mail")
    await center.call("trigger", "sensor.nc_mail")
    await center.call("done", "sensor.nc_mail")
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id(
        {"type": f"{DOMAIN}/card/undo", "notification_id": nid, "step_id": sid}
    )
    response = await ws.receive_json()
    assert response["success"], response
    await hass.async_block_till_done()
    assert center.state("sensor.nc_mail") == "active"

    await ws.send_json_auto_id(
        {"type": f"{DOMAIN}/card/undo", "notification_id": nid, "step_id": sid}
    )
    response = await ws.receive_json()
    assert not response["success"]
    assert response["error"]["code"] == "invalid_config"
