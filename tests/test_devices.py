"""Tests for the lights, speakers and sirens."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    async_fire_time_changed,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.notification_center import (
    device_light,
    device_siren,
    device_speaker,
)
from custom_components.notification_center.device_colors import (
    chime_of,
    color_of,
    highlight_of,
    light_rgb,
    parse_color,
)
from custom_components.notification_center.device_speaker import spoken_text

from .common import Center, step

RED = [244, 67, 54]


@pytest.fixture(autouse=True)
def _fast_speakers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Do not wait for mocked speakers to play."""
    monkeypatch.setattr(device_speaker, "PLAY_START_TIMEOUT", 0)
    monkeypatch.setattr(device_speaker, "POLL", 0)
    monkeypatch.setattr(device_light, "TEST_SECONDS", 0)
    monkeypatch.setattr(device_siren, "SIREN_TEST_SECONDS", 0)


def test_colors() -> None:
    """System colours by name, custom colours with their light colour."""
    assert parse_color("#ff8000") == (255, 128, 0)
    assert parse_color("1, 2, 3") == (1, 2, 3)
    assert parse_color("red") is None
    assert color_of({}, {"color": "red"}) == "red"
    assert color_of({"color": "c1"}, {"color": "red"}) == "c1"
    assert color_of({}, {}) == "primary"
    own = [{"id": "c1", "name": "Custom 1", "rgb": [1, 2, 3]}]
    assert light_rgb({"colors": {"red": [200, 0, 0]}}, "red") == (200, 0, 0)
    assert light_rgb({}, "red") == (244, 67, 54)
    assert light_rgb({}, "c1", own) == (1, 2, 3)
    assert light_rgb({"colors": {"c1": [9, 9, 9]}}, "c1", own) == (9, 9, 9)
    assert chime_of({}, {"chime": "nc_chime"}) == "nc_chime"
    assert chime_of({"chime": "none"}, {"chime": "nc_chime"}) is None
    assert chime_of({"chime": "nc_alarm"}, {"chime": None}) == "nc_alarm"
    # A category without a chime plays the default one.
    assert chime_of({}, {}) == "nc_chime"
    assert highlight_of({}, {"highlight": "glow"}) is True
    assert highlight_of({"highlight": "none"}, {"highlight": "alert"}) is False


def test_spoken_text() -> None:
    """The message, with the name and the Info line when asked."""
    assert spoken_text("Dishwasher", "It finished", "Eco") == "It finished."
    assert (
        spoken_text("Dishwasher", "It finished.", "Eco", with_name=True, with_info=True)
        == "Dishwasher. It finished. Eco."
    )


async def _category(center: Center, **changes: Any) -> None:
    category = dict(center.manager.config["categories"][0])
    category.update(changes)
    await center.manager.async_update("categories", category["id"], category)
    await center.hass.async_block_till_done()


async def _light(center: Center, **settings: Any) -> str:
    item = await center.manager.async_create(
        "lights", {"entity_id": "light.strip", **settings}
    )
    await center.hass.async_block_till_done()
    return f"light:{item['id']}"


async def test_light_shows_and_goes_back(center: Center, hass: HomeAssistant) -> None:
    """The light shows the colour, then goes back to how it was."""
    await center.set("light.strip", "off", supported_color_modes=["hs"])
    on = async_mock_service(hass, "light", "turn_on")
    off = async_mock_service(hass, "light", "turn_off")
    key = await _light(center)
    await _category(
        center,
        color="red",
        channels={"dashboard": {"modes": ["home"]}, key: {"modes": ["home"]}},
    )
    await center.add("Leak", step())
    await center.call("trigger", "sensor.nc_leak")

    assert on[-1].data == {
        "entity_id": "light.strip",
        "rgb_color": RED,
        "brightness_pct": 70,
    }
    assert center.state("sensor.nc_channel_light_strip") == "1"
    assert center.attrs("sensor.nc_channel_light_strip")["showing"] == "Leak"

    await center.call("done", "sensor.nc_leak")
    assert off, "the light was off before"
    assert center.state("sensor.nc_channel_light_strip") == "0"


async def test_light_restores_after_several_colours(
    center: Center, hass: HomeAssistant
) -> None:
    """The state saved before the first card comes back, whatever came between."""
    await center.set(
        "light.strip",
        "on",
        supported_color_modes=["hs"],
        color_mode="hs",
        brightness=120,
        hs_color=[30, 50],
    )
    on = async_mock_service(hass, "light", "turn_on")
    key = await _light(center)
    await _category(center, color="red", channels={key: {"modes": ["home"]}})
    blue = await center.manager.async_create(
        "categories",
        {"name": "Blue", "color": "blue", "channels": {key: {"modes": ["home"]}}},
    )
    await center.add("Second", step(), category=blue["id"])
    await center.add("First", step())
    await center.call("trigger", "sensor.nc_first")
    assert on[-1].data["rgb_color"] == [33, 150, 243] or on[-1].data["rgb_color"] == RED
    await center.call("trigger", "sensor.nc_second")
    # The Notifications list order: Second is first in the list.
    assert on[-1].data["rgb_color"] == [33, 150, 243]
    await center.call("done", "sensor.nc_second")
    assert on[-1].data["rgb_color"] == RED
    await center.call("done", "sensor.nc_first")
    assert on[-1].data == {
        "entity_id": "light.strip",
        "brightness": 120,
        "hs_color": [30, 50],
    }


async def test_light_dims_and_custom_colour(
    center: Center, hass: HomeAssistant
) -> None:
    """Dim when dark (all the time), the light's own RGB and a custom colour."""
    await center.set("light.strip", "off", supported_color_modes=["rgb"])
    await center.set("sensor.lux", "100")
    on = async_mock_service(hass, "light", "turn_on")
    async_mock_service(hass, "light", "turn_off")
    key = await _light(
        center,
        brightness=80,
        illuminance_sensor="sensor.lux",
        dim_below=30,
        dim_brightness=20,
        dim_continuously=True,
        colors={"red": [200, 0, 0]},
    )
    await _category(center, color="red", channels={key: {"modes": ["home"]}})
    nid = await center.add("Leak", step())
    await center.call("trigger", "sensor.nc_leak")
    assert on[-1].data["rgb_color"] == [200, 0, 0]
    assert on[-1].data["brightness_pct"] == 80

    await center.set("sensor.lux", "10")
    assert on[-1].data["brightness_pct"] == 20

    own = await center.manager.async_create(
        "colors", {"name": "Custom 1", "rgb": [16, 32, 48]}
    )
    notification = dict(center.manager.config["notifications"][0])
    notification.update(color=own["id"])
    await center.manager.async_update("notifications", nid, notification)
    await hass.async_block_till_done()
    assert on[-1].data["rgb_color"] == [16, 32, 48]


async def test_switch_pulses_for_highlight(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """A switch pulses for a highlighted notification, a second on, a second off."""
    await center.set("switch.lamp", "off")
    on = async_mock_service(hass, "switch", "turn_on")
    off = async_mock_service(hass, "switch", "turn_off")
    item = await center.manager.async_create("lights", {"entity_id": "switch.lamp"})
    key = f"light:{item['id']}"
    await _category(center, highlight="alert", channels={key: {"modes": ["home"]}})
    await center.add("Smoke", step())
    await center.call("trigger", "sensor.nc_smoke")
    assert len(on) == 1
    freezer.tick(timedelta(seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(off) == 1
    freezer.tick(timedelta(seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(on) == 2


async def test_dimmable_light_pulses_to_half(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """A dimmable light pulses between its brightness and half of it."""
    await center.set("light.strip", "off", supported_color_modes=["hs"])
    on = async_mock_service(hass, "light", "turn_on")
    off = async_mock_service(hass, "light", "turn_off")
    item = await center.manager.async_create(
        "lights", {"entity_id": "light.strip", "brightness": 80}
    )
    assert item["effect"] == "notification_pulse"
    key = f"light:{item['id']}"
    await _category(center, highlight="alert", channels={key: {"modes": ["home"]}})
    await center.add("Smoke", step())
    await center.call("trigger", "sensor.nc_smoke")
    assert on[-1].data["brightness_pct"] == 80
    freezer.tick(timedelta(seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert on[-1].data["brightness_pct"] == 40
    assert not off
    freezer.tick(timedelta(seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert on[-1].data["brightness_pct"] == 80


async def test_light_changed_by_hand_is_left_alone(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """A change by hand wins: the light is not put back at the end."""
    await center.set("light.strip", "off", supported_color_modes=["hs"])
    async_mock_service(hass, "light", "turn_on")
    off = async_mock_service(hass, "light", "turn_off")
    key = await _light(center)
    await _category(center, channels={key: {"modes": ["home"]}})
    await center.add("Leak", step())
    await center.call("trigger", "sensor.nc_leak")
    freezer.tick(timedelta(seconds=10))
    hass.states.async_set(
        "light.strip",
        "on",
        {"supported_color_modes": ["hs"], "brightness": 3},
        context=Context(),
    )
    await hass.async_block_till_done()
    assert center.attrs("sensor.nc_channel_light_strip")["changed_by_hand"] is True
    await center.call("done", "sensor.nc_leak")
    assert not off


async def test_speaker_plays_reads_and_repeats(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """Chime, then the message; again every 30 s until muted."""
    await center.set("media_player.kitchen", "idle", supported_features=0)
    play = async_mock_service(hass, "media_player", "play_media")
    speak = async_mock_service(hass, "tts", "speak")
    await center.manager.async_update_general(
        {"read_the_message": {"tts_service": "tts.cloud", "language": "en-US"}}
    )
    item = await center.manager.async_create(
        "speakers", {"entity_id": "media_player.kitchen"}
    )
    key = f"speaker:{item['id']}"
    await _category(
        center,
        chime="nc_doorbell",
        channels={
            "dashboard": {"modes": ["home"]},
            key: {
                "modes": ["home"],
                "read_the_message": True,
                "repeat": {"type": "recurring", "every": {"seconds": 30}},
            },
        },
    )
    await center.add("Doorbell", step("Someone is at the door"))
    await center.call("trigger", "sensor.nc_doorbell")
    await hass.async_block_till_done()

    assert len(play) == 1
    assert play[0].data["media_content_id"].split("?")[0].endswith("/doorbell.mp3")
    assert speak[0].data == {
        "entity_id": "tts.cloud",
        "media_player_entity_id": "media_player.kitchen",
        "message": "Someone is at the door.",
        "language": "en-US",
    }

    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(play) == 2

    engine = center.engine
    engine.mute_cards(list(engine.cards.values()), "button")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(play) == 2
    attrs = center.attrs("sensor.nc_channel_speaker_kitchen")
    assert attrs["muted"] == 1
    assert attrs["last_notification"] == "Doorbell"


async def test_speaker_loop_plays_again_until_muted(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """Loop plays again right after a play ends, until muted."""
    await center.set("media_player.kitchen", "idle", supported_features=0)
    play = async_mock_service(hass, "media_player", "play_media")
    item = await center.manager.async_create(
        "speakers", {"entity_id": "media_player.kitchen"}
    )
    key = f"speaker:{item['id']}"
    await _category(
        center,
        channels={key: {"modes": ["home"], "repeat": {"type": "loop"}}},
    )
    await center.add("Alarm", step())
    await center.call("trigger", "sensor.nc_alarm")
    await hass.async_block_till_done()
    assert len(play) == 1

    # The mock plays nothing, so the play ends at once and the loop waits a
    # little before it plays again.
    for count in (2, 3):
        freezer.tick(timedelta(seconds=6))
        async_fire_time_changed(hass, dt_util.utcnow())
        await hass.async_block_till_done()
        assert len(play) == count

    engine = center.engine
    engine.mute_cards(list(engine.cards.values()), "button")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=6))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(play) == 3


async def test_speaker_loop_stops_after_times(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """A repeat with Times plays that many times in all, then stops."""
    await center.set("media_player.kitchen", "idle", supported_features=0)
    play = async_mock_service(hass, "media_player", "play_media")
    item = await center.manager.async_create(
        "speakers", {"entity_id": "media_player.kitchen"}
    )
    key = f"speaker:{item['id']}"
    repeat = {"type": "loop", "times": 2}
    await _category(center, channels={key: {"modes": ["home"], "repeat": repeat}})
    await center.add("Alarm", step())
    await center.call("trigger", "sensor.nc_alarm")
    await hass.async_block_till_done()
    for _ in range(3):
        freezer.tick(timedelta(seconds=6))
        async_fire_time_changed(hass, dt_util.utcnow())
        await hass.async_block_till_done()
    assert len(play) == 2


async def test_speaker_channel_volume_and_no_chime(
    center: Center, hass: HomeAssistant
) -> None:
    """The channel's volume wins over the speaker's; Play chime off only reads."""
    await center.set(
        "media_player.cast", "idle", supported_features=0, volume_level=0.2
    )
    play = async_mock_service(hass, "media_player", "play_media")
    speak = async_mock_service(hass, "tts", "speak")
    volume = async_mock_service(hass, "media_player", "volume_set")
    await center.manager.async_update_general(
        {"read_the_message": {"tts_service": "tts.cloud"}}
    )
    item = await center.manager.async_create(
        "speakers", {"entity_id": "media_player.cast", "volume": 0.6}
    )
    key = f"speaker:{item['id']}"
    await _category(
        center,
        channels={
            key: {
                "modes": ["home"],
                "volume": 0.9,
                "play_chime": False,
                "read_the_message": True,
            }
        },
    )
    await center.add("Bell", step("Hello"))
    await center.call("trigger", "sensor.nc_bell")
    await hass.async_block_till_done()
    assert [call.data["volume_level"] for call in volume] == [0.9, 0.2]
    assert play == []
    assert speak[0].data["message"] == "Hello."


async def test_speaker_announce_and_volume(center: Center, hass: HomeAssistant) -> None:
    """Announce where the speaker can; otherwise set the volume and put it back."""
    await center.set(
        "media_player.cast", "idle", supported_features=0, volume_level=0.2
    )
    play = async_mock_service(hass, "media_player", "play_media")
    volume = async_mock_service(hass, "media_player", "volume_set")
    item = await center.manager.async_create(
        "speakers", {"entity_id": "media_player.cast", "volume": 0.6}
    )
    key = f"speaker:{item['id']}"
    await _category(center, chime="nc_chime", channels={key: {"modes": ["home"]}})
    await center.add("Bell", step())
    await center.call("trigger", "sensor.nc_bell")
    await hass.async_block_till_done()
    assert [call.data["volume_level"] for call in volume] == [0.6, 0.2]
    assert "announce" not in play[0].data

    await center.set(
        "media_player.cast",
        "idle",
        supported_features=1048576,
        volume_level=0.2,
    )
    await center.call("done", "sensor.nc_bell")
    await center.call("trigger", "sensor.nc_bell")
    await hass.async_block_till_done()
    assert play[-1].data["announce"] is True
    assert len(volume) == 2


async def test_sirens(center: Center, hass: HomeAssistant) -> None:
    """A siren with its settings, and a select with its options."""
    await center.set("siren.balcony", "off")
    await center.set("select.co", "stop", options=["stop", "smoke_siren"])
    siren_on = async_mock_service(hass, "siren", "turn_on")
    siren_off = async_mock_service(hass, "siren", "turn_off")
    select = async_mock_service(hass, "select", "select_option")
    balcony = await center.manager.async_create(
        "sirens", {"entity_id": "siren.balcony", "duration": 60}
    )
    co = await center.manager.async_create(
        "sirens",
        {"entity_id": "select.co", "option": "smoke_siren", "stop_option": "stop"},
    )
    await center.manager.async_set_channel_modes(f"siren:{balcony['id']}", ["home"])
    await center.manager.async_set_channel_modes(f"siren:{co['id']}", ["home"])
    await center.add("Smoke", step())
    await center.call("trigger", "sensor.nc_smoke")
    assert siren_on[0].data == {"entity_id": "siren.balcony", "duration": 60}
    assert select[0].data == {"entity_id": "select.co", "option": "smoke_siren"}
    assert center.attrs("sensor.nc_channel_siren_balcony")["sounding"] is True

    await center.call("done", "sensor.nc_smoke")
    assert siren_off
    assert select[-1].data["option"] == "stop"


async def test_light_reconfigure_while_showing(
    center: Center, hass: HomeAssistant
) -> None:
    """Saving a light's settings while it shows a card applies them at once."""
    await center.set("light.strip", "off", supported_color_modes=["hs"])
    on = async_mock_service(hass, "light", "turn_on")
    key = await _light(center)
    await _category(
        center,
        color="red",
        channels={"dashboard": {"modes": ["home"]}, key: {"modes": ["home"]}},
    )
    await center.add("Leak", step())
    await center.call("trigger", "sensor.nc_leak")
    assert on[-1].data["brightness_pct"] == 70

    item = dict(center.manager.config["lights"][0])
    await center.manager.async_update("lights", item["id"], {**item, "brightness": 20})
    await hass.async_block_till_done()
    assert on[-1].data["brightness_pct"] == 20


async def test_test_does_not_change_live_settings(
    center: Center, hass: HomeAssistant
) -> None:
    """The Test button uses the dialog's values for the test only."""
    await center.set("light.strip", "off", supported_color_modes=["hs"])
    async_mock_service(hass, "light", "turn_on")
    async_mock_service(hass, "light", "turn_off")
    key = await _light(center, brightness=40)
    devices = center.entry.runtime_data.devices
    await devices.async_test(
        key,
        {"color": "red", "device": {"entity_id": "light.strip", "brightness": 90}},
    )
    assert devices.devices[key].settings["brightness"] == 40


async def test_siren_follows_a_change_and_stops(
    center: Center, hass: HomeAssistant
) -> None:
    """A sounding siren moves to a new entity, and stops when unloaded."""
    await center.set("siren.balcony", "off")
    await center.set("siren.hall", "off")
    on = async_mock_service(hass, "siren", "turn_on")
    off = async_mock_service(hass, "siren", "turn_off")
    item = await center.manager.async_create("sirens", {"entity_id": "siren.balcony"})
    await center.manager.async_set_channel_modes(f"siren:{item['id']}", ["home"])
    await center.add("Smoke", step())
    await center.call("trigger", "sensor.nc_smoke")
    assert [call.data["entity_id"] for call in on] == ["siren.balcony"]

    await center.manager.async_update(
        "sirens", item["id"], {**item, "entity_id": "siren.hall"}
    )
    await hass.async_block_till_done()
    assert [call.data["entity_id"] for call in off] == ["siren.balcony"]
    assert on[-1].data["entity_id"] == "siren.hall"

    assert await hass.config_entries.async_unload(center.entry.entry_id)
    await hass.async_block_till_done()
    assert off[-1].data["entity_id"] == "siren.hall"


async def test_mute_button(center: Center, hass: HomeAssistant) -> None:
    """A button with the Mute action keeps the card and stops the siren."""
    await center.set("switch.siren", "off")
    on = async_mock_service(hass, "switch", "turn_on")
    off = async_mock_service(hass, "switch", "turn_off")
    item = await center.manager.async_create("sirens", {"entity_id": "switch.siren"})
    await center.manager.async_set_channel_modes(f"siren:{item['id']}", ["home"])
    await center.add(
        "Smoke",
        step(
            buttons=[
                {
                    "id": "quiet",
                    "type": "custom",
                    "label": "Quiet",
                    "actions": {"mute": True},
                }
            ]
        ),
    )
    await center.call("trigger", "sensor.nc_smoke")
    assert on
    card = next(iter(center.engine.cards.values()))
    await center.engine.async_press(card, "quiet", None)
    await hass.async_block_till_done()
    assert off
    assert center.state("sensor.nc_smoke") == "active"


async def test_builtin_mute_button(center: Center, hass: HomeAssistant) -> None:
    """The built-in Mute button keeps the card and stops the siren."""
    await center.set("switch.siren", "off")
    async_mock_service(hass, "switch", "turn_on")
    off = async_mock_service(hass, "switch", "turn_off")
    item = await center.manager.async_create("sirens", {"entity_id": "switch.siren"})
    await center.manager.async_set_channel_modes(f"siren:{item['id']}", ["home"])
    await center.add("Smoke", step(buttons=[{"type": "mute", "enabled": True}]))
    await center.call("trigger", "sensor.nc_smoke")
    card = next(iter(center.engine.cards.values()))
    mute = next(b for b in center.engine.buttons_of(card) if b["type"] == "mute")
    await center.engine.async_press(card, mute["id"], None)
    await hass.async_block_till_done()
    assert off
    assert card.muted
    assert center.state("sensor.nc_smoke") == "active"


async def test_set_channel_modes(center: Center) -> None:
    """A new device gets the same modes in every category."""
    item = await center.manager.async_create("lights", {"entity_id": "light.strip"})
    key = f"light:{item['id']}"
    await center.manager.async_set_channel_modes(key, ["home"])
    for category in center.manager.config["categories"]:
        assert category["channels"][key] == {"modes": ["home"]}
    await center.manager.async_delete("lights", item["id"])
    for category in center.manager.config["categories"]:
        assert key not in category["channels"]


async def test_channel_test_light(
    center: Center,
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The Test button shows a colour on a light not saved yet, then goes back."""
    await center.set("light.new", "off", supported_color_modes=["hs"])
    on = async_mock_service(hass, "light", "turn_on")
    off: list[ServiceCall] = async_mock_service(hass, "light", "turn_off")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "notification_center/channel/test",
            "channel": "light:new",
            "device": {"entity_id": "light.new"},
            "color": "red",
        }
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done(wait_background_tasks=True)
    assert on[-1].data["rgb_color"] == RED
    assert off, "back to off"


async def test_channel_test_light_several_times(
    center: Center, hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Tests one after the other: the light goes back to how it was before the first."""
    monkeypatch.setattr(device_light, "TEST_SECONDS", 0.05)
    await center.set("light.strip", "off", supported_color_modes=["hs"])
    on = async_mock_service(hass, "light", "turn_on")
    off = async_mock_service(hass, "light", "turn_off")
    key = await _light(center)
    devices = center.entry.runtime_data.devices

    first = hass.async_create_task(devices.async_test(key, {"color": "red"}))
    await asyncio.sleep(0.01)
    assert on[-1].data["rgb_color"] == RED
    # The light follows the first test, as a real one does.
    hass.states.async_set(
        "light.strip", "on", {"supported_color_modes": ["hs"], "hs_color": [4, 78]}
    )
    second = hass.async_create_task(devices.async_test(key, {"color": "green"}))
    await first
    await second
    await hass.async_block_till_done()
    assert off, "back to off, as before the first test"
    assert on[-1].data["rgb_color"] == [76, 175, 80]
    assert len(on) == 2, "nothing turned on after the last test"


def test_greys_are_white_on_a_light() -> None:
    """A lamp has no grey: the greys show white unless the light sets its own."""
    assert light_rgb({}, "grey") == (255, 255, 255)
    assert light_rgb({"colors": {"grey": [100, 100, 100]}}, "grey") == (
        100,
        100,
        100,
    )
