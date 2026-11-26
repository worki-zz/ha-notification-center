"""Tests for the engine: buttons and actions."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center.const import DOMAIN

from .common import DOOR_GROUP, Center, step


async def test_icon_color_follows_the_state(center: Center) -> None:
    """Active: the notification's colour; Snoozed orange; Idle grey."""
    colors = [{"id": "mint", "name": "Mint", "rgb": [16, 32, 48]}]
    await center.manager.async_create("colors", colors[0])
    await center.add("Plants", step(), color="red")
    await center.add("Mint", step(), color="mint")
    assert center.attrs("sensor.nc_plants")["icon_color"] == "grey"
    await center.call("trigger", "sensor.nc_plants")
    await center.call("trigger", "sensor.nc_mint")
    assert center.attrs("sensor.nc_plants")["icon_color"] == "red"
    assert center.attrs("sensor.nc_mint")["icon_color"] == "#102030"
    await center.call("snooze", "sensor.nc_plants", duration={"minutes": 5})
    assert center.attrs("sensor.nc_plants")["icon_color"] == "orange"


async def test_clear_and_done_actions(center: Center) -> None:
    """Clear dismisses without last done; Done records it even when closed."""
    await center.add("Plants", step())
    await center.call("trigger", "sensor.nc_plants")
    await center.call("clear", "sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "idle"
    assert center.attrs("sensor.nc_plants")["last_done"] is None
    assert center.kinds() == ["active", "dismissed"]

    await center.call("done", "sensor.nc_plants")
    assert center.state("sensor.nc_plants") == "idle"
    assert center.attrs("sensor.nc_plants")["last_done"] is not None

    await center.call(
        "set_last_done", "sensor.nc_plants", datetime="2026-01-02 03:04:05"
    )
    last = dt_util.parse_datetime(center.attrs("sensor.nc_plants")["last_done"])
    assert last is not None
    assert dt_util.as_local(last).strftime("%Y-%m-%d %H:%M") == "2026-01-02 03:04"


async def test_action_errors(center: Center) -> None:
    """Actions explain a wrong target or step."""
    await center.add("Plants", step())
    with pytest.raises(ServiceValidationError):
        await center.call("trigger", "sensor.notification_center")
    with pytest.raises(ServiceValidationError, match="1 step"):
        await center.call("trigger", "sensor.nc_plants", step=2)


async def test_trigger_action_message_and_data(center: Center) -> None:
    """The trigger action can replace the message and pass data."""
    await center.set("input_boolean.front", "on", friendly_name="Front door")
    await center.add("Bell", step("Someone at {Entity}"))
    await center.call("trigger", "sensor.nc_bell", entity="input_boolean.front")
    assert center.attrs("sensor.nc_bell")["message"] == "Someone at Front door"

    await center.call(
        "trigger",
        "sensor.nc_bell",
        message="Visitor: {{ data.visitor }}",
        data={"visitor": "Postman"},
    )
    cards = center.engine.cards_of(
        center.engine.resolve_notification("sensor.nc_bell") or ""
    )
    messages = sorted(card.message or "" for card in cards)
    assert messages == ["Someone at Front door", "Visitor: Postman"]


async def test_websocket_state_and_card_actions(
    hass: HomeAssistant,
    center: Center,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: Any,
    hass_read_only_access_token: str,
) -> None:
    """Any user can follow the cards and mark one done."""
    hass.states.async_set("person.reader", "home", {"user_id": hass_read_only_user.id})
    nid = await center.add("Plants", step())
    await center.call("trigger", "sensor.nc_plants")
    ws = await hass_ws_client(hass, hass_read_only_access_token)

    await ws.send_json_auto_id({"type": f"{DOMAIN}/state/subscribe"})
    assert (await ws.receive_json())["success"]
    snapshot = (await ws.receive_json())["event"]
    entry = snapshot["notifications"][nid]
    assert entry["state"] == "active"
    assert entry["entity_id"] == "sensor.nc_plants"
    card = entry["cards"][0]
    assert card["message"] == "Do it"
    assert card["muted"] is False

    await ws.send_json_auto_id(
        {
            "type": f"{DOMAIN}/card/action",
            "notification_id": nid,
            "step_id": card["step_id"],
            "entity_id": None,
            "action": "mute",
        }
    )
    while True:
        message = await ws.receive_json()
        if message.get("type") == "event":
            muted = message["event"]["notifications"][nid]["cards"][0]
            assert muted["muted"] is True
            assert muted["status"] == "active"
        if message.get("type") == "result":
            assert message["success"], message
            break
    assert center.state("sensor.nc_plants") == "active"
    events = len(center.events)

    await ws.send_json_auto_id(
        {
            "type": f"{DOMAIN}/card/action",
            "notification_id": nid,
            "step_id": card["step_id"],
            "entity_id": None,
            "action": "done",
        }
    )
    while True:
        message = await ws.receive_json()
        if message.get("type") == "result":
            assert message["success"], message
            break
    assert center.state("sensor.nc_plants") == "done"
    assert len(center.events) == events + 1
    assert center.events[-1][1]["person"] == "person.reader"
    assert center.events[-1][1]["source"] == "button"


async def test_button_press(
    hass: HomeAssistant,
    center: Center,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: Any,
    hass_read_only_access_token: str,
) -> None:
    """A button changes the card, runs its action, and the log names the user."""
    calls = async_mock_service(hass, "test", "ring")
    await center.set("binary_sensor.front", "on", device_class="door")
    nid = await center.add(
        "Doors",
        step(
            done_when={
                "actions": {
                    "entity_action": True,
                    "ha_actions": [
                        {
                            "action": "test.ring",
                            "data": {
                                "who": "{{ status }} {{ cause.source }} "
                                "{{ cause.button }} {{ cause.user_id is not none }}"
                            },
                        }
                    ],
                }
            },
            buttons=[
                {"type": "done", "id": "done"},
                {
                    "type": "custom",
                    "id": "ring",
                    "label": "Ring",
                    "actions": {
                        "ha_actions": [
                            {
                                "action": "test.ring",
                                "data": {"who": "{{ notification.name }}"},
                            }
                        ],
                    },
                },
                {
                    "type": "snooze",
                    "id": "snooze",
                    "enabled": True,
                    "snooze": ["30m", "2h"],
                },
            ],
        ),
        entities=[
            {
                "entity_id": "binary_sensor.front",
                "actions": {
                    "done": [{"action": "test.ring", "data": {"who": "{{ entity }}"}}]
                },
            }
        ],
    )
    await hass.services.async_call(
        DOMAIN,
        "trigger",
        {"entity_id": "sensor.nc_doors", "entity": "binary_sensor.front"},
        blocking=True,
    )
    await hass.async_block_till_done()
    card = center.engine.cards_of(nid)[0]
    ws = await hass_ws_client(hass, hass_read_only_access_token)

    async def press(button_id: str, **extra: Any) -> dict[str, Any]:
        await ws.send_json_auto_id(
            {
                "type": f"{DOMAIN}/card/press",
                "notification_id": nid,
                "step_id": card.step_id,
                "entity_id": "binary_sensor.front",
                "button_id": button_id,
                **extra,
            }
        )
        result: dict[str, Any] = await ws.receive_json()
        await hass.async_block_till_done()
        return result

    # A custom button keeps the card and runs its action.
    assert (await press("ring"))["success"]
    assert center.state("sensor.nc_doors") == "active"
    assert calls[-1].data == {"who": "Doors"}

    # Snooze with one of the button's times; without a choice, its first.
    before = dt_util.utcnow()
    assert (await press("snooze", choice="2h"))["success"]
    assert center.state("sensor.nc_doors") == "snoozed"
    until = card.snoozed_until
    assert until is not None
    assert timedelta(minutes=119) < until - before <= timedelta(minutes=121)

    # Done runs the Done when actions: the entity's own action, then the
    # others, which know the status and its cause; they carry the user.
    assert (await press("done"))["success"]
    assert center.state("sensor.nc_doors") == "done"
    assert calls[-2].data == {"who": "binary_sensor.front"}
    assert calls[-1].data == {"who": "done button done True"}
    assert calls[-1].context.user_id == hass_read_only_user.id
    state = hass.states.get("sensor.nc_doors")
    assert state is not None
    assert state.context.user_id == hass_read_only_user.id

    result = await press("done")
    assert not result["success"]
    assert result["error"]["code"] == "not_found"


async def test_button_action_list(hass: HomeAssistant, center: Center) -> None:
    """A button runs its actions in order; one that cannot run is skipped."""
    calls = async_mock_service(hass, "test", "ring")
    nid = await center.add(
        "Plants",
        step(
            buttons=[
                {
                    "type": "custom",
                    "id": "later",
                    "label": "Later",
                    "actions": {
                        # Nothing to run: no entity has an action.
                        "entity_action": True,
                        "notification_state": {"type": "snooze"},
                        "ha_actions": [{"action": "test.ring"}],
                    },
                    "snooze_for": "2h",
                    "navigation": {"type": "navigate", "path": "/lovelace/0"},
                },
                {
                    "type": "custom",
                    "id": "finish",
                    "label": "Finish",
                    "actions": {
                        "notification_state": {"type": "done"},
                        # Not valid any more: skipped, the card is still done.
                        "ha_actions": [
                            {"device_id": "gone", "domain": "gone", "type": "x"}
                        ],
                    },
                },
            ]
        ),
    )
    config = center.engine.notification_config(nid) or {}
    buttons = {b["id"]: b for b in config["steps"][0]["buttons"]}
    assert buttons["finish"]["actions"]["notification_state"] == {"type": "done"}
    await hass.services.async_call(
        DOMAIN, "trigger", {"entity_id": "sensor.nc_plants"}, blocking=True
    )
    card = center.engine.cards_of(nid)[0]
    before = dt_util.utcnow()
    await center.engine.async_press(card, "later", None)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "snoozed"
    assert len(calls) == 1
    until = card.snoozed_until
    assert until is not None
    assert timedelta(minutes=119) < until - before <= timedelta(minutes=121)

    await center.engine.async_press(card, "finish", None)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "done"
    assert len(calls) == 1


async def test_tap_runs_another_button(hass: HomeAssistant, center: Center) -> None:
    """A Tap with Button action runs that button; one that is off, its own."""
    nid = await center.add(
        "Plants",
        step(
            buttons=[
                {"type": "tap", "id": "tap", "enabled": True, "run_button": "done"},
                {"type": "done", "id": "done", "enabled": True},
            ]
        ),
    )
    await hass.services.async_call(
        DOMAIN, "trigger", {"entity_id": "sensor.nc_plants"}, blocking=True
    )
    card = center.engine.cards_of(nid)[0]
    button = center.engine.button_of(card, "tap")
    assert button is not None
    assert button["type"] == "done"
    await center.engine.async_press(card, "tap", None)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_plants") == "done"

    nid = await center.add(
        "Bins",
        step(
            buttons=[
                {"type": "tap", "id": "tap", "enabled": True, "run_button": "done"},
                {"type": "done", "id": "done", "enabled": False},
            ]
        ),
    )
    await hass.services.async_call(
        DOMAIN, "trigger", {"entity_id": "sensor.nc_bins"}, blocking=True
    )
    card = center.engine.cards_of(nid)[0]
    button = center.engine.button_of(card, "tap")
    assert button is not None
    assert button["type"] == "tap"


async def test_snooze_choices(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """Minutes and hours count from now; days come back at the morning time."""
    freezer.move_to(
        dt_util.as_utc(
            datetime(2026, 1, 31, 20, 0, tzinfo=dt_util.get_default_time_zone())
        )
    )
    nid = await center.add("Plants", step())
    await hass.services.async_call(
        DOMAIN, "trigger", {"entity_id": "sensor.nc_plants"}, blocking=True
    )
    card = center.engine.cards_of(nid)[0]

    def local(choice: str) -> datetime:
        return dt_util.as_local(center.engine.snooze_choice(card, choice))

    assert local("15m") == dt_util.now() + timedelta(minutes=15)
    assert local("12h") == dt_util.now() + timedelta(hours=12)
    assert (
        local("tomorrow").date().isoformat(),
        local("tomorrow").strftime("%H:%M"),
    ) == (
        "2026-02-01",
        "08:00",
    )
    assert local("1w").date().isoformat() == "2026-02-07"
    # A month later, or that month's last day.
    assert local("1mo").date().isoformat() == "2026-02-28"


async def test_group_member_custom_action(center: Center) -> None:
    """A member's custom action replaces the group's; the others run the group's."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.set("binary_sensor.back", "on", device_class="door")
    group_action = [{"action": "test.mute", "target": {"entity_id": "switch.a"}}]
    custom_action = [{"action": "test.mute", "target": {"entity_id": "switch.b"}}]
    entity_action = {"entity_action": True}
    nid = await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
            buttons=[
                {"type": "dismiss", "id": "dismiss", "actions": entity_action},
                {"type": "done", "id": "done", "actions": entity_action},
            ],
        ),
        entity_groups=[
            {
                **DOOR_GROUP,
                "actions": {"dismiss": group_action, "done": group_action},
                "member_actions": {
                    "binary_sensor.back": {"dismiss": custom_action, "done": []}
                },
            }
        ],
    )
    cards = {card.entity_id: card for card in center.engine.cards_of(nid)}
    front, back = cards["binary_sensor.front"], cards["binary_sensor.back"]
    engine = center.engine
    assert engine.entity_actions(front, "dismiss") == group_action
    assert engine.entity_actions(back, "dismiss") == custom_action
    # An empty custom action does nothing, instead of the group's.
    assert engine.entity_actions(back, "done") == []
    assert engine.entity_actions(front, "done") == group_action


async def test_button_actions_run_one_after_the_other(
    hass: HomeAssistant, center: Center
) -> None:
    """A button's Home Assistant actions wait for its entity action."""
    log: list[str] = []
    release = asyncio.Event()

    async def slow(call: ServiceCall) -> None:
        log.append("slow start")
        await release.wait()
        log.append("slow end")

    async def quick(call: ServiceCall) -> None:
        log.append("quick")

    hass.services.async_register("test", "slow", slow)
    hass.services.async_register("test", "quick", quick)
    await center.set("binary_sensor.front", "on", device_class="door")
    nid = await center.add(
        "Plants",
        step(
            buttons=[
                {
                    "type": "custom",
                    "id": "both",
                    "label": "Both",
                    "actions": {
                        "entity_action": True,
                        "ha_actions": [{"action": "test.quick"}],
                    },
                }
            ]
        ),
        entities=[
            {
                "entity_id": "binary_sensor.front",
                "actions": {"both": [{"action": "test.slow"}]},
            }
        ],
    )
    await hass.services.async_call(
        DOMAIN,
        "trigger",
        {"entity_id": "sensor.nc_plants", "entity": "binary_sensor.front"},
        blocking=True,
    )
    card = center.engine.cards_of(nid)[0]
    task = hass.async_create_task(center.engine.async_press(card, "both", None))
    await asyncio.sleep(0.05)
    assert log == ["slow start"]
    release.set()
    await task
    assert log == ["slow start", "slow end", "quick"]


async def test_trigger_only_me(
    hass: HomeAssistant, center: Center, hass_admin_user: Any
) -> None:
    """A test trigger goes to the user's person only, and not to the devices."""
    hass.states.async_set("person.admin", "home", {"user_id": hass_admin_user.id})
    hass.states.async_set("person.other", "home", {})
    nid = await center.add("Plants", step())
    await hass.services.async_call(
        DOMAIN,
        "trigger",
        {"entity_id": "sensor.nc_plants", "only_me": True},
        blocking=True,
        context=Context(user_id=hass_admin_user.id),
    )
    await hass.async_block_till_done()
    card = center.engine.cards_of(nid, None)[0]
    assert card.only_people == ["person.admin"]
    assert center.engine.channel_view(card).people == ["person.admin"]
    assert center.engine.channel_view(card, "light").reason == "off"

    # A normal trigger afterwards makes it a normal card again.
    await center.call("trigger", "sensor.nc_plants")
    assert center.engine.cards_of(nid, None)[0].only_people is None

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "trigger",
            {"entity_id": "sensor.nc_plants", "only_me": True},
            blocking=True,
        )
