"""Tests for the channel rules: modes, delay, audience, and the Dashboard."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.notification_center.channels import (
    REASON_AUDIENCE,
    REASON_DELAY,
    REASON_MODE,
    REASON_OFF,
    audience_of,
    channel_settings,
    channel_view,
)
from custom_components.notification_center.model import (
    async_validate_config,
    upgrade_channels,
)

from .common import Center, step

NOW = dt_util.utcnow()
EVERY = {"home": True, "sleep": True, "away": True}
HOME_ONLY = {"home": True, "sleep": False, "away": False}
NONE = {"home": False, "sleep": False, "away": False}


def _view(settings: dict[str, Any] | None, **extra: Any) -> Any:
    args: dict[str, Any] = {
        "mode_id": "home",
        "active_since": NOW,
        "now": NOW,
        "audience": {"person.a": EVERY, "person.b": EVERY},
        "states": {"person.a": "home", "person.b": "away"},
    }
    args.update(extra)
    return channel_view(settings, **args)


def test_channel_settings_step_over_category() -> None:
    """A step changes only what it stores; ``delay: None`` means at once."""
    category = {"channels": {"dashboard": {"modes": ["home"], "delay": {"minutes": 5}}}}
    assert channel_settings(category, {"channels": {}}, "dashboard") == {
        "modes": ["home"],
        "delay": {"minutes": 5},
    }
    step_ = {"channels": {"dashboard": {"delay": None}}}
    assert channel_settings(category, step_, "dashboard") == {
        "modes": ["home"],
        "delay": None,
    }
    assert channel_settings(category, {}, "push") is None


def test_modes_and_fallback() -> None:
    """Off without ticks; with no active mode, any tick is enough."""
    assert _view(None).reason == REASON_OFF
    assert _view({"modes": []}, mode_id=None).reason == REASON_OFF
    assert _view({"modes": ["away"]}).reason == REASON_MODE
    assert _view({"modes": ["away"]}, mode_id=None).sends


def test_delay() -> None:
    """The delay counts from when the card became active."""
    view = _view({"modes": ["home"], "delay": {"minutes": 5}})
    assert view.reason == REASON_DELAY
    assert view.until == NOW + timedelta(minutes=5)
    later = _view(
        {"modes": ["home"], "delay": {"minutes": 5}}, now=NOW + timedelta(minutes=5)
    )
    assert later.sends


def test_audience_states() -> None:
    """Only the people in a ticked state; nobody: held back."""
    settings = {"modes": ["home"]}
    view = _view(settings, audience={"person.a": HOME_ONLY, "person.b": HOME_ONLY})
    assert view.people == ["person.a"]
    assert view.audience == ["person.a", "person.b"]
    view = _view(
        settings,
        audience={"person.a": HOME_ONLY, "person.b": HOME_ONLY},
        states={"person.a": "sleep", "person.b": "away"},
    )
    assert view.reason == REASON_AUDIENCE
    view = _view(settings, audience={"person.a": NONE, "person.b": NONE})
    assert view.reason == REASON_AUDIENCE
    assert view.audience == []
    # With no person in Home Assistant nothing is held back.
    assert _view(settings, audience={}, states={}).sends


def test_audience_inheritance() -> None:
    """Step over category per person; a person left out gets the common part."""
    category = {
        "audience": {
            "person.a": {"home": True, "sleep": True, "away": False},
            "person.b": {"home": True, "sleep": False, "away": True},
        }
    }
    step_ = {"audience": {"person.b": NONE}}
    result = audience_of(category, step_, ["person.a", "person.b", "person.c"])
    assert result == {
        "person.a": {"home": True, "sleep": True, "away": False},
        "person.b": NONE,
        "person.c": HOME_ONLY,
    }
    assert audience_of({}, {}, ["person.a"]) == {"person.a": EVERY}


def test_upgrade_channels() -> None:
    """0.5 data: renamed channel, delay, category audience, step audience."""
    data: dict[str, Any] = {
        "modes": [{"id": "home"}, {"id": "away"}],
        "people": [{"person": "person.a", "sleep_entity": "input_boolean.a_sleeps"}],
        "categories": [
            {
                "id": "general",
                "channels": {
                    "notification_center": {
                        "modes": ["home"],
                        "when": {"type": "immediately"},
                    },
                    "push": {
                        "modes": ["home"],
                        "when": {"type": "after", "delay": {"minutes": 5}},
                    },
                },
            },
            {"id": "other", "channels": {}},
        ],
        "notifications": [
            {
                "steps": [
                    {
                        "audience": ["person.a"],
                        "channels": {"push": {"when": {"type": "on_arrival"}}},
                    },
                    {"audience": []},
                ]
            }
        ],
    }
    upgrade_channels(data, ["person.a", "person.b"])
    general, other = data["categories"]
    assert general["channels"] == {
        "dashboard": {"modes": ["home"]},
        "push": {"modes": ["home"], "delay": {"minutes": 5}},
    }
    assert general["audience"] == {}
    assert other["channels"] == {"dashboard": {"modes": ["home", "away"]}}
    first, second = data["notifications"][0]["steps"]
    assert first["audience"] == {"person.b": NONE}
    assert first["channels"] == {"push": {"delay": None}}
    assert second["audience"] == {}
    assert data["people"][0] == {
        "person": "person.a",
        "sleep": {
            "type": "state",
            "entity_id": "input_boolean.a_sleeps",
            "state": "on",
        },
    }
    # Once only: a category whose Dashboard row was removed stays without it.
    data["categories"][1]["channels"] = {}
    upgrade_channels(data, ["person.a", "person.b"])
    assert data["categories"][1]["channels"] == {}


async def test_upgraded_config_validates(hass: HomeAssistant) -> None:
    """The upgrade runs as part of the validation."""
    config = await async_validate_config(
        hass,
        {
            "modes": [{"id": "home", "name": "Home"}],
            "categories": [
                {
                    "id": "general",
                    "name": "General",
                    "channels": {"notification_center": {"modes": ["home"]}},
                }
            ],
        },
    )
    assert config["categories"][0]["channels"] == {"dashboard": {"modes": ["home"]}}
    assert config["categories"][0]["audience"] == {}


async def _set_category(center: Center, **changes: Any) -> None:
    category = dict(center.manager.config["categories"][0])
    category.update(changes)
    await center.manager.async_update("categories", category["id"], category)
    await center.hass.async_block_till_done()


def _dashboard(center: Center, notification_id: str) -> dict[str, Any]:
    cards = center.engine.snapshot()["notifications"][notification_id]["cards"]
    assert len(cards) == 1
    return dict(cards[0]["dashboard"])


async def test_dashboard_follows_presence_and_sleep(center: Center) -> None:
    """The Dashboard shows a card to the people in a ticked state, live."""
    await center.set("person.a", "home")
    await center.set("person.b", "not_home")
    await center.set("input_boolean.a_sleeps", "off")
    await center.manager.async_update_person(
        {
            "person": "person.a",
            "sleep": {
                "type": "state",
                "entity_id": "input_boolean.a_sleeps",
                "state": "on",
            },
        }
    )
    await _set_category(center, audience={"person.a": HOME_ONLY, "person.b": HOME_ONLY})
    nid = await center.add("Garbage", step())
    await center.call("trigger", "sensor.nc_garbage")

    assert _dashboard(center, nid)["people"] == ["person.a"]
    assert center.state("sensor.nc_channel_dashboard") == "1"

    await center.set("input_boolean.a_sleeps", "on")
    assert _dashboard(center, nid)["reason"] == REASON_AUDIENCE
    assert center.state("sensor.nc_channel_dashboard") == "0"
    assert center.attrs("sensor.nc_channel_dashboard")["audience"] == 1
    # The notification itself stays active.
    assert center.state("sensor.nc_garbage") == "active"
    assert center.state("sensor.notification_center") == "1"

    await center.set("person.b", "home")
    assert _dashboard(center, nid)["people"] == ["person.b"]


async def test_dashboard_mode_and_delay(
    center: Center, hass: HomeAssistant, freezer: FrozenDateTimeFactory
) -> None:
    """Held back by the mode; shown when the delay ends, by itself."""
    await _set_category(center, channels={"dashboard": {"modes": ["home"]}})
    nid = await center.add(
        "Door",
        step(channels={"dashboard": {"delay": {"minutes": 5}}}),
    )
    await center.call("trigger", "sensor.nc_door")
    view = _dashboard(center, nid)
    assert view["reason"] == REASON_DELAY
    assert center.state("sensor.nc_channel_dashboard") == "0"

    freezer.tick(timedelta(minutes=5, seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert _dashboard(center, nid)["reason"] is None
    assert center.state("sensor.nc_channel_dashboard") == "1"

    await _set_category(center, channels={"dashboard": {"modes": []}})
    assert _dashboard(center, nid)["reason"] == REASON_OFF
    assert center.attrs("sensor.nc_channel_dashboard")["off"] == 1
