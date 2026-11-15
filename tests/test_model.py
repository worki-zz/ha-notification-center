"""Tests for the configuration schema."""

from __future__ import annotations

import copy
from typing import Any

from homeassistant.core import HomeAssistant
import pytest

from custom_components.notification_center.model import (
    BUILTIN_BUTTONS,
    ConfigValidationError,
    async_validate_config,
    default_config,
)


def _with_notification(**step: Any) -> dict[str, Any]:
    config = default_config()
    config["notifications"] = [
        {"name": "Test", "steps": [{"message": "Hello", **step}]},
    ]
    return config


async def test_default_config_is_valid(hass: HomeAssistant) -> None:
    config = await async_validate_config(hass, default_config())
    assert [mode["id"] for mode in config["modes"]] == ["home"]
    assert [category["id"] for category in config["categories"]] == ["general"]
    assert config["notifications"] == []


async def test_step_defaults(hass: HomeAssistant) -> None:
    config = await async_validate_config(hass, _with_notification())
    notification = config["notifications"][0]
    assert notification["category"] == "general"
    assert notification["enabled"] is True
    step = notification["steps"][0]
    assert step["enabled"] is True
    assert step["start"] == {"type": "triggers", "triggers": [], "conditions": []}
    assert [button["type"] for button in step["buttons"]] == list(BUILTIN_BUTTONS)
    done = next(button for button in step["buttons"] if button["type"] == "done")
    assert done["enabled"] is True
    assert done["card"] == "done"


async def test_builtin_buttons_keep_their_settings(hass: HomeAssistant) -> None:
    config = await async_validate_config(
        hass,
        _with_notification(
            buttons=[
                {"type": "dismiss", "label": "Mute", "card": "keep_silent"},
                {"type": "custom", "label": "Disarm"},
            ]
        ),
    )
    buttons = config["notifications"][0]["steps"][0]["buttons"]
    assert sorted(button["type"] for button in buttons) == sorted(
        [*BUILTIN_BUTTONS, "custom"]
    )
    dismiss = next(button for button in buttons if button["type"] == "dismiss")
    assert dismiss["label"] == "Mute"
    assert dismiss["card"] == "keep_silent"
    custom = next(button for button in buttons if button["type"] == "custom")
    assert custom["card"] == "keep"


async def test_durations_times_and_dates_stay_plain(hass: HomeAssistant) -> None:
    config = await async_validate_config(
        hass,
        _with_notification(
            start={
                "type": "schedule",
                "schedule": {
                    "type": "calendar",
                    "every": 3,
                    "unit": "weeks",
                    "weekdays": ["sat"],
                    "at": "10:00:00",
                    "starting": "2026-11-01",
                    "expires": "36:00:00",
                },
            }
        ),
    )
    schedule = config["notifications"][0]["steps"][0]["start"]["schedule"]
    assert schedule["at"] == "10:00"
    assert schedule["starting"] == "2026-11-01"
    assert schedule["expires"] == {"days": 1, "hours": 12}


async def test_interval_zero_and_entity(hass: HomeAssistant) -> None:
    for every in (0, "input_number.interval"):
        config = await async_validate_config(
            hass,
            _with_notification(
                start={
                    "type": "schedule",
                    "schedule": {
                        "type": "after_last_done",
                        "every": every,
                        "unit": "days",
                    },
                }
            ),
        )
        assert (
            config["notifications"][0]["steps"][0]["start"]["schedule"]["every"]
            == every
        )


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda c: c["notifications"][0].update(category="missing"), "no category"),
        (lambda c: c["notifications"][0].update(steps=[]), "steps"),
        (
            lambda c: c["notifications"].append(
                copy.deepcopy(c["notifications"][0]) | {"id": "x"}
            ),
            "used twice",
        ),
        (lambda c: c["modes"].clear(), "'home' mode is required"),
        (
            lambda c: c["modes"].insert(0, {"id": "away", "name": "Away"}),
            "condition",
        ),
        (
            lambda c: c["categories"][0]["channels"].update(
                {"light:nope": {"modes": ["home"]}}
            ),
            "no such device",
        ),
        (
            lambda c: c["categories"][0]["channels"].update({"tv": {}}),
            "unknown channel",
        ),
        (
            lambda c: c["categories"][0]["channels"]["notification_center"].update(
                modes=["away"]
            ),
            "no mode 'away'",
        ),
        (lambda c: c["categories"][0].update(light_color=[255, 0]), "three numbers"),
        (lambda c: c["notifications"][0].update(colour="red"), "colour"),
        (
            lambda c: c["notifications"][0]["steps"][0].update(
                start={"type": "triggers", "triggers": [{"trigger": "state"}]}
            ),
            "start",
        ),
        (
            lambda c: c["notifications"][0]["steps"][0].update(
                hide_while=[{"condition": "state"}]
            ),
            "hide while",
        ),
        (
            lambda c: c["notifications"][0]["steps"][0].update(
                start={
                    "type": "triggers",
                    "triggers": [
                        {
                            "trigger": "notification_center.notification_state",
                            "notification": "missing",
                            "state": "done",
                        }
                    ],
                }
            ),
            "no notification 'missing'",
        ),
        (
            lambda c: c["notifications"][0]["steps"][0].update(
                buttons=[{"type": "done"}, {"type": "done"}]
            ),
            "listed twice",
        ),
    ],
)
async def test_invalid_configs(hass: HomeAssistant, change: Any, message: str) -> None:
    config = _with_notification()
    change(config)
    with pytest.raises(ConfigValidationError, match=message):
        await async_validate_config(hass, config)


async def test_step_channels_store_only_changes(hass: HomeAssistant) -> None:
    config = await async_validate_config(
        hass, _with_notification(channels={"notification_center": {"modes": []}})
    )
    assert config["notifications"][0]["steps"][0]["channels"] == {
        "notification_center": {"modes": []}
    }
    category = config["categories"][0]["channels"]["notification_center"]
    assert category == {"modes": ["home"], "when": {"type": "immediately"}}
