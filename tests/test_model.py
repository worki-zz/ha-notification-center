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
    assert step["activation"] == {"type": "triggers", "triggers": []}
    assert step["conditions"] == {
        "activate_only_while_met": True,
        "hide_while_not_met": True,
        "conditions": [],
    }
    assert [button["type"] for button in step["buttons"]] == list(BUILTIN_BUTTONS)
    done = next(button for button in step["buttons"] if button["type"] == "done")
    assert done["enabled"] is True
    assert done["show_in_push"] is True
    snooze = next(button for button in step["buttons"] if button["type"] == "snooze")
    assert snooze["snooze"] == ["1h", "3h", "tomorrow"]


async def test_builtin_buttons_keep_their_settings(hass: HomeAssistant) -> None:
    config = await async_validate_config(
        hass,
        _with_notification(
            buttons=[
                {"type": "dismiss", "label": "Close", "icon": "mdi:close-box"},
                {"type": "custom", "label": "Disarm"},
            ]
        ),
    )
    buttons = config["notifications"][0]["steps"][0]["buttons"]
    assert sorted(button["type"] for button in buttons) == sorted(
        [*BUILTIN_BUTTONS, "custom"]
    )
    dismiss = next(button for button in buttons if button["type"] == "dismiss")
    assert dismiss["label"] == "Close"
    custom = next(button for button in buttons if button["type"] == "custom")
    assert custom["show_in_push"] is False
    assert "card" not in custom


async def test_earlier_buttons_and_snooze_are_upgraded(hass: HomeAssistant) -> None:
    """Mute becomes an own button; the notification's Snooze moves to the button."""
    data = _with_notification(
        buttons=[
            {"id": "mute", "type": "dismiss", "label": "Mute", "card": "keep_silent"},
            {"type": "custom", "label": "Disarm", "card": "done"},
            {"type": "snooze", "snooze": "ask"},
        ]
    )
    data["notifications"][0]["snooze"] = {"type": "fixed", "duration": {"hours": 2}}
    config = await async_validate_config(hass, data)
    notification = config["notifications"][0]
    assert "snooze" not in notification
    buttons = notification["steps"][0]["buttons"]
    mute = next(button for button in buttons if button["id"] == "mute")
    assert (mute["type"], mute["label"]) == ("custom", "Mute")
    assert all("card" not in button for button in buttons)
    snooze = next(button for button in buttons if button["type"] == "snooze")
    assert snooze["snooze"] == ["1h", "3h", "tomorrow"]

    data = _with_notification()
    data["notifications"][0]["snooze"] = {"type": "not_allowed"}
    config = await async_validate_config(hass, data)
    buttons = config["notifications"][0]["steps"][0]["buttons"]
    snooze = next(button for button in buttons if button["type"] == "snooze")
    assert snooze["enabled"] is False

    data = _with_notification(buttons=[{"type": "snooze", "snooze": {"minutes": 20}}])
    config = await async_validate_config(hass, data)
    buttons = config["notifications"][0]["steps"][0]["buttons"]
    snooze = next(button for button in buttons if button["type"] == "snooze")
    assert snooze["snooze"] == ["15m"]


async def test_durations_times_and_dates_stay_plain(hass: HomeAssistant) -> None:
    config = await async_validate_config(
        hass,
        _with_notification(
            activation={
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
    schedule = config["notifications"][0]["steps"][0]["activation"]["schedule"]
    assert schedule["at"] == "10:00"
    assert schedule["starting"] == "2026-11-01"
    assert schedule["expires"] == {"days": 1, "hours": 12}


async def test_interval_zero_and_entity(hass: HomeAssistant) -> None:
    for every in (0, "input_number.interval"):
        config = await async_validate_config(
            hass,
            _with_notification(
                activation={
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
            config["notifications"][0]["steps"][0]["activation"]["schedule"]["every"]
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
                activation={"type": "triggers", "triggers": [{"trigger": "state"}]}
            ),
            "activation",
        ),
        (
            lambda c: c["notifications"][0]["steps"][0].update(
                conditions={"conditions": [{"condition": "state"}]}
            ),
            "conditions",
        ),
        (
            lambda c: c["notifications"][0]["steps"][0].update(
                activation={
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


async def test_start_conditions_and_hide_while_become_show_when(
    hass: HomeAssistant,
) -> None:
    """Earlier steps get one Show when, with the switches set to match."""
    away = {"condition": "state", "entity_id": "input_boolean.away", "state": "off"}
    rain = {"condition": "state", "entity_id": "input_boolean.rain", "state": "on"}
    data = _with_notification()
    first = data["notifications"][0]["steps"][0]
    data["notifications"][0]["steps"] = [
        {**first, "start": {"type": "triggers", "conditions": [away]}},
        {**first, "hide_while": [rain]},
        {
            **first,
            "start": {"type": "triggers", "conditions": [away]},
            "hide_while": [rain],
        },
        dict(first),
    ]
    config = await async_validate_config(hass, data)
    steps = config["notifications"][0]["steps"]
    not_rain = {"condition": "not", "conditions": [rain]}

    def conditions(activate: bool, hide: bool, items: list[Any]) -> dict[str, Any]:
        return {
            "activate_only_while_met": activate,
            "hide_while_not_met": hide,
            "conditions": items,
        }

    assert steps[0]["conditions"] == conditions(True, False, [away])
    assert steps[1]["conditions"] == conditions(False, True, [not_rain])
    assert steps[2]["conditions"] == conditions(True, True, [away, not_rain])
    assert steps[3]["conditions"] == conditions(True, True, [])
    assert all("hide_while" not in step and "show_when" not in step for step in steps)
    assert all("conditions" not in step["activation"] for step in steps)


async def test_earlier_field_names_are_renamed(hass: HomeAssistant) -> None:
    """Show when, start and Start condition no longer true get their new names."""
    away = {"condition": "state", "entity_id": "input_boolean.away", "state": "off"}
    data = _with_notification()
    first = data["notifications"][0]["steps"][0]
    first.pop("activation", None)
    first["start"] = {"type": "triggers", "triggers": []}
    first["show_when"] = {"start": False, "hide": True, "conditions": [away]}
    first["done_when"] = {"start_no_longer_true": True}
    config = await async_validate_config(hass, data)
    step = config["notifications"][0]["steps"][0]
    assert step["activation"] == {"type": "triggers", "triggers": []}
    assert step["conditions"] == {
        "activate_only_while_met": False,
        "hide_while_not_met": True,
        "conditions": [away],
    }
    assert step["done_when"]["activation_conditions_no_longer_true"] is True
    assert "show_when" not in step
    assert "start" not in step
