"""Tests for the Push channel."""

from __future__ import annotations

from typing import Any

from homeassistant.auth.models import User
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import async_mock_service
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.model import effective_buttons
from custom_components.notification_center.push import (
    Content,
    Phone,
    action_id,
    build_payload,
    color_hex,
    parse_action,
    press_url,
    push_body,
)

from .common import Center, step

KRISTOF = "person.kristof"
DORA = "person.dora"


def _content(priority: str = "normal") -> Content:
    return Content(
        title="Washing machine",
        body="Unload it\nEco 40",
        icon="mdi:washing-machine",
        color="#F44336",
        priority=priority,
        group="nc-household",
        category_name="Household",
        url="/notification-center",
    )


def test_payload_ios() -> None:
    """iOS: the icon on the colour, the URL, the interruption level."""
    phone = Phone(DORA, "notify.dora_iphone", "ios")
    actions = [{"action": f"NC|n|s||b{index}", "title": "B"} for index in range(5)]
    payload = build_payload(phone, _content(), tag="nc-n", actions=actions)
    assert payload["title"] == "Washing machine"
    assert payload["message"] == "Unload it\nEco 40"
    data = payload["data"]
    assert data["tag"] == "nc-n"
    assert data["group"] == "nc-household"
    assert data["url"] == "/notification-center"
    assert data["notification_icon"] == "mdi:washing-machine"
    assert data["notification_icon_color"] == "#FFFFFF"
    assert data["color"] == "#F44336"
    assert data["push"] == {"interruption-level": "active"}
    assert len(data["actions"]) == 5, "iOS shows every button"

    critical = build_payload(phone, _content("critical"), tag="nc-n")["data"]["push"]
    assert critical == {
        "interruption-level": "critical",
        "sound": {"name": "default", "critical": 1, "volume": 1.0},
    }
    silent = build_payload(phone, _content("silent"), tag="nc-n")["data"]["push"]
    assert silent == {"interruption-level": "passive"}


def test_payload_android() -> None:
    """Android: the category's channel, shared channels for the other priorities."""
    phone = Phone(KRISTOF, "notify.kristof_nothing", "android")
    actions = [{"action": f"NC|n|s||b{index}", "title": "B"} for index in range(5)]
    data = build_payload(phone, _content(), tag="nc-n", actions=actions)["data"]
    assert data["channel"] == "Household"
    assert data["clickAction"] == "/notification-center"
    assert len(data["actions"]) == 3, "Android shows three buttons"
    assert "ttl" not in data, "a normal push may wait"

    silent = build_payload(phone, _content("silent"), tag="t")["data"]
    assert (silent["channel"], silent["importance"]) == ("Silent", "low")
    urgent = build_payload(phone, _content("time_sensitive"), tag="t")["data"]
    assert urgent["channel"] == "Time-sensitive"
    assert (urgent["ttl"], urgent["priority"], urgent["importance"]) == (
        0,
        "high",
        "high",
    )
    critical = build_payload(phone, _content("critical"), tag="t")["data"]
    assert critical["channel"] == "alarm_stream"
    assert critical["persistent"] is True
    assert critical["sticky"] == "true"
    assert (critical["ttl"], critical["priority"]) == (0, "high")


def test_payload_other() -> None:
    """Other: only the title and the text."""
    phone = Phone(DORA, "notify.email", "other")
    assert build_payload(phone, _content(), tag="t", actions=[{"a": 1}]) == {
        "title": "Washing machine",
        "message": "Unload it\nEco 40",
    }


def test_helpers() -> None:
    """Action ids, the panel's address, the body and the colour."""
    assert parse_action("NC|n1|s1|binary_sensor.door|done") == (
        "n1",
        "s1",
        "binary_sensor.door",
        "done",
    )
    assert parse_action("NC|n1|s1||done") == ("n1", "s1", None, "done")
    assert parse_action("OTHER") is None
    assert parse_action(None) is None
    assert press_url("NC|n|s||tap", "/lovelace/0") == (
        "/notification-center?nc_press=NC%7Cn%7Cs%7C%7Ctap&nc_then=%2Flovelace%2F0"
    )
    assert push_body("Unload it", None) == "Unload it"
    assert push_body("Unload it", "Eco 40") == "Unload it\nEco 40"
    assert color_hex("red", []) == "#F44336"
    assert color_hex("c1", [{"id": "c1", "rgb": [1, 2, 3]}]) == "#010203"


async def _setup(
    center: Center,
    hass: HomeAssistant,
    *,
    user: User | None = None,
    push: dict[str, Any] | None = None,
    audience: dict[str, Any] | None = None,
) -> tuple[list[ServiceCall], list[ServiceCall]]:
    """Two people with phones: Kristóf (Android, at home) and Dóra (iOS, away)."""
    await center.set(
        KRISTOF, "home", friendly_name="Kristóf", user_id=user.id if user else "u1"
    )
    await center.set(DORA, "not_home", friendly_name="Dóra", user_id="u2")
    android = async_mock_service(hass, "notify", "kristof_nothing")
    ios = async_mock_service(hass, "notify", "dora_iphone")
    await center.manager.async_update_person(
        {
            "person": KRISTOF,
            "notify": "notify.kristof_nothing",
            "device_type": "android",
        }
    )
    await center.manager.async_update_person(
        {"person": DORA, "notify": "notify.dora_iphone", "device_type": "ios"}
    )
    category = dict(center.manager.config["categories"][0])
    category["channels"] = {
        "dashboard": {"modes": ["home"]},
        "push": push or {"modes": ["home"]},
    }
    category["color"] = "red"
    if audience is not None:
        category["audience"] = audience
    await center.manager.async_update("categories", category["id"], category)
    await hass.async_block_till_done()
    return android, ios


def _done_id(center: Center, card: Any) -> str:
    """Return the id of the card's Done button (built-in buttons get an id)."""
    notification = center.engine.notification_config(card.notification_id) or {}
    category = center.engine.category_of(notification)
    step_config = next(
        item for item in notification["steps"] if item["id"] == card.step_id
    )
    return next(
        str(button["id"])
        for button in effective_buttons(category, step_config)
        if button["type"] == "done"
    )


async def test_push_sent_and_cleared(center: Center, hass: HomeAssistant) -> None:
    """Every person of the audience gets the push; Done takes it away from both."""
    android, ios = await _setup(center, hass)
    await center.add("Washing machine", step("Unload it", info="Eco 40"))
    await center.call("trigger", "sensor.nc_washing_machine")
    await hass.async_block_till_done()

    assert len(android) == 1
    assert len(ios) == 1
    sent = ios[0].data
    assert sent["title"] == "Washing machine"
    assert sent["message"] == "Unload it\nEco 40"
    card = next(iter(center.engine.cards.values()))
    tag = f"nc-{card.notification_id}"
    assert sent["data"]["tag"] == tag
    assert sent["data"]["color"] == "#F44336"
    # Done, the only button switched on in a new category.
    assert sent["data"]["actions"] == [
        {"action": action_id(card, _done_id(center, card)), "title": "Done"}
    ]
    assert android[0].data["data"]["channel"] == "General"
    assert center.state("sensor.nc_channel_push") == "1"
    assert "last_sent_dora" in center.attrs("sensor.nc_channel_push")

    await center.call("done", "sensor.nc_washing_machine")
    await hass.async_block_till_done()
    assert android[-1].data == {
        "message": "clear_notification",
        "data": {"tag": tag},
    }
    assert ios[-1].data["message"] == "clear_notification"
    assert center.state("sensor.nc_channel_push") == "0"


async def test_push_follows_people_and_stays(
    center: Center, hass: HomeAssistant
) -> None:
    """Sent on arrival; a push already sent stays when the person leaves."""
    home_only = {"home": True, "sleep": False, "away": False}
    android, ios = await _setup(
        center, hass, audience={KRISTOF: home_only, DORA: home_only}
    )
    await center.add("Cat at home", step("The cat is in"))
    await center.call("trigger", "sensor.nc_cat_at_home")
    await hass.async_block_till_done()
    assert len(android) == 1
    assert not ios, "Dóra is away"

    await center.set(DORA, "home", friendly_name="Dóra", user_id="u2")
    await hass.async_block_till_done()
    assert len(ios) == 1, "sent when she arrives"

    await center.set(DORA, "not_home", friendly_name="Dóra", user_id="u2")
    await hass.async_block_till_done()
    assert len(ios) == 1, "left on the phone"
    await center.set(DORA, "home", friendly_name="Dóra", user_id="u2")
    await hass.async_block_till_done()
    assert len(ios) == 1, "not sent twice"


async def test_silence_keeps_snooze_clears(center: Center, hass: HomeAssistant) -> None:
    """Silence leaves the push on the phones; Snooze takes it away."""
    android, _ios = await _setup(center, hass)
    await center.add(
        "Smoke",
        step(
            "Smoke in the kitchen",
            buttons=[
                {
                    "id": "quiet",
                    "type": "custom",
                    "label": "Quiet",
                    "actions": {"silence": True},
                }
            ],
        ),
    )
    await center.call("trigger", "sensor.nc_smoke")
    await hass.async_block_till_done()
    card = next(iter(center.engine.cards.values()))
    assert {"action": action_id(card, "quiet"), "title": "Quiet"} in android[0].data[
        "data"
    ]["actions"]
    await center.engine.async_press(card, "quiet", None)
    await hass.async_block_till_done()
    assert len(android) == 1, "nothing cleared"

    await center.call("snooze", "sensor.nc_smoke")
    await hass.async_block_till_done()
    assert android[-1].data["message"] == "clear_notification"


async def test_button_pressed_on_the_phone(center: Center, hass: HomeAssistant) -> None:
    """A button of the push changes the card, by the person who pressed it."""
    android, _ios = await _setup(center, hass)
    await center.add("Washing machine", step("Unload it"))
    await center.call("trigger", "sensor.nc_washing_machine")
    await hass.async_block_till_done()
    card = next(iter(center.engine.cards.values()))
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": action_id(card, _done_id(center, card))},
        context=Context(user_id="u1"),
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    assert center.state("sensor.nc_washing_machine") == "done"
    assert center.events[-1][1]["person"] == KRISTOF
    assert android[-1].data["message"] == "clear_notification"


async def test_mode_and_priority(center: Center, hass: HomeAssistant) -> None:
    """No tick for the mode: no push; the priority comes from the channel."""
    android, ios = await _setup(
        center, hass, push={"modes": ["home"], "priority": "critical"}
    )
    await center.add("Leak", step("Water under the sink"))
    await center.call("trigger", "sensor.nc_leak")
    await hass.async_block_till_done()
    assert android[0].data["data"]["channel"] == "alarm_stream"
    assert ios[0].data["data"]["push"]["interruption-level"] == "critical"

    category = dict(center.manager.config["categories"][0])
    category["channels"] = {**category["channels"], "push": {"modes": []}}
    await center.manager.async_update("categories", category["id"], category)
    await center.add("Door", step("The door is open"))
    await center.call("trigger", "sensor.nc_door")
    await hass.async_block_till_done()
    assert len(android) == 1, "Push is off"


async def test_tap_opens_the_page(center: Center, hass: HomeAssistant) -> None:
    """The tap opens General's page, a Tap's own, or the panel that presses it."""
    _android, ios = await _setup(center, hass)
    general = dict(center.manager.config["general"])
    general["open_on_tap"] = "/lovelace/home"
    await center.manager.async_update_general(general)
    await center.add("Plain", step("Hello"))
    await center.add(
        "Tapped",
        step(
            "Hello",
            buttons=[
                {
                    "type": "tap",
                    "enabled": True,
                    "open_on_tap": "/lovelace/garden",
                    "actions": {"ha_actions": [{"action": "light.turn_on"}]},
                }
            ],
        ),
    )
    await center.call("trigger", "sensor.nc_plain")
    await center.call("trigger", "sensor.nc_tapped")
    await hass.async_block_till_done()
    urls = [call.data["data"]["url"] for call in ios]
    assert urls[0] == "/lovelace/home"
    assert urls[1].startswith("/notification-center?nc_press=NC%7C")
    assert urls[1].endswith("&nc_then=%2Flovelace%2Fgarden")


async def test_push_test_and_repairs(
    center: Center,
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hass_admin_user: User,
) -> None:
    """Test sends to the viewer, to everyone, or to a phone being edited."""
    android, ios = await _setup(center, hass, user=hass_admin_user)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/channel/test",
            "channel": "push",
            "scope": "me",
            "settings": {"priority": "time_sensitive"},
        }
    )
    assert (await client.receive_json())["success"]
    assert android[-1].data["title"] == "Test notification"
    assert android[-1].data["data"]["channel"] == "Time-sensitive"
    assert not ios

    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/channel/test", "channel": "push", "scope": "all"}
    )
    assert (await client.receive_json())["success"]
    assert len(ios) == 1
    assert len(android) == 2

    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/channel/test",
            "channel": "push",
            "scope": "person",
            "person": {
                "person": DORA,
                "notify": "notify.missing",
                "device_type": "ios",
            },
        }
    )
    result = await client.receive_json()
    assert not result["success"]
    assert "notify.missing" in result["error"]["message"]

    await client.send_json_auto_id({"type": f"{DOMAIN}/push/services"})
    services = (await client.receive_json())["result"]["services"]
    assert {
        "service": "notify.dora_iphone",
        "name": "Dora iphone",
        "device_type": None,
    } in services

    await center.manager.async_update_person(
        {"person": DORA, "notify": "notify.gone", "device_type": "ios"}
    )
    await hass.async_block_till_done()
    issue = ir.async_get(hass).async_get_issue(DOMAIN, f"missing_push_service_{DORA}")
    assert issue is not None
    assert issue.translation_placeholders == {
        "name": "Dóra",
        "service": "notify.gone",
        "link": "/notification-center/settings/general/people",
    }


async def test_no_phone_for_the_viewer(
    center: Center, hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    """Test to oneself without a phone says so."""
    await _setup(center, hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/channel/test", "channel": "push", "scope": "me"}
    )
    result = await client.receive_json()
    assert not result["success"]
    assert result["error"]["message"] == "Your user is not a person."


async def test_push_starts_off_after_the_update(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    """Push ticks of the earlier data model are taken away once, on load."""
    from pytest_homeassistant_custom_component.common import (  # noqa: PLC0415
        MockConfigEntry,
    )

    hass_storage[DOMAIN] = {
        "version": 1,
        "minor_version": 1,
        "key": DOMAIN,
        "data": {
            "modes": [{"id": "home", "name": "Home"}],
            "categories": [
                {
                    "id": "general",
                    "name": "General",
                    "channels": {
                        "dashboard": {"modes": ["home"]},
                        "push": {"modes": ["home"], "delay": {"hours": 1}},
                    },
                }
            ],
            "notifications": [
                {
                    "id": "n1",
                    "name": "Leak",
                    "category": "general",
                    "steps": [
                        {
                            "id": "s1",
                            "message": "Water",
                            "channels": {"push": {"modes": ["home"]}},
                        }
                    ],
                }
            ],
        },
    }
    entry = MockConfigEntry(domain=DOMAIN, title="Notification Center")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    config = entry.runtime_data.manager.config
    category = next(c for c in config["categories"] if c["id"] == "general")
    assert category["channels"]["push"]["modes"] == []
    assert category["channels"]["push"]["delay"] == {"hours": 1}
    assert category["channels"]["dashboard"]["modes"] == ["home"]
    step_channels = config["notifications"][0]["steps"][0].get("channels", {})
    assert "modes" not in step_channels.get("push", {})
