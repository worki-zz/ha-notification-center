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
    drop_inherited_values,
    effective_buttons,
)
from custom_components.notification_center.store import (
    move_schedule_expires,
    rename_mute_and_pulse,
    upgrade_push_devices,
    upgrade_status_actions,
    upgrade_tap_behavior,
)


def _effective(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the first step's buttons as they work, with the category's."""
    notification = config["notifications"][0]
    category = next(
        item for item in config["categories"] if item["id"] == notification["category"]
    )
    return effective_buttons(category, notification["steps"][0])


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
    no_actions = {"entity_action": False, "ha_actions": []}
    assert step["activation"] == {
        "type": "triggers",
        "triggers": [],
        "actions": no_actions,
    }
    assert step["done_when"]["actions"] == no_actions
    assert step["dismiss_when"]["actions"] == no_actions
    assert step["snooze_when"] == {
        "enabled": False,
        "triggers": [],
        "actions": no_actions,
        "rerun_activation": False,
    }
    assert step["mute_when"] == {
        "enabled": False,
        "triggers": [],
        "actions": no_actions,
    }
    assert step["conditions"] == {
        "activate_only_while_met": True,
        "hide_while_not_met": True,
        "conditions": [],
    }
    assert [button["type"] for button in step["buttons"]] == list(BUILTIN_BUTTONS)
    # The step stores only its own settings: the rest comes from the category.
    assert all("enabled" not in button for button in step["buttons"])
    buttons = _effective(config)
    assert [button["type"] for button in buttons] == [
        "tap",
        "done",
        "dismiss",
        "snooze",
        "mute",
    ]
    mute = next(button for button in buttons if button["type"] == "mute")
    assert mute["enabled"] is False
    done = next(button for button in buttons if button["type"] == "done")
    assert done["enabled"] is True
    assert done["show_in_push"] is True
    assert "push_tap" not in done
    tap = next(button for button in buttons if button["type"] == "tap")
    assert "push_tap" not in tap
    # The Tap does nothing until it is set.
    assert tap["actions"] == {
        "entity_action": False,
        "notification_state": {"type": "unchanged"},
        "ha_actions": [],
    }
    assert tap["navigation"] is None
    assert tap["run_state_actions"] is True
    assert "show_in_push" not in tap
    assert done["actions"] == {}
    snooze = next(button for button in buttons if button["type"] == "snooze")
    assert snooze["enabled"] is False
    assert snooze["snooze"] == ["1h", "3h", "tomorrow"]
    assert snooze["snooze_for"] == "1h"


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
    buttons = _effective(config)
    assert sorted(button["type"] for button in buttons) == sorted(
        [*BUILTIN_BUTTONS, "custom"]
    )
    dismiss = next(button for button in buttons if button["type"] == "dismiss")
    assert dismiss["label"] == "Close"
    custom = next(button for button in buttons if button["type"] == "custom")
    # Every button is in the push unless switched off.
    assert custom["show_in_push"] is True
    assert "card" not in custom


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
                },
            },
            dismiss_when={"expires": "36:00:00"},
        ),
    )
    step = config["notifications"][0]["steps"][0]
    schedule = step["activation"]["schedule"]
    assert schedule["at"] == "10:00"
    assert schedule["starting"] == "2026-11-01"
    assert step["dismiss_when"]["expires"] == {"days": 1, "hours": 12}


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
            lambda c: c["categories"][0]["channels"]["dashboard"].update(
                modes=["away"]
            ),
            "no mode 'away'",
        ),
        (lambda c: c["colors"].append({"name": "X", "rgb": [255, 0]}), "three numbers"),
        (lambda c: c["categories"][0].update(color="nope"), "no colour 'nope'"),
        (lambda c: c["notifications"][0].update(chime="nope"), "no chime 'nope'"),
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
        hass, _with_notification(channels={"dashboard": {"modes": []}})
    )
    assert config["notifications"][0]["steps"][0]["channels"] == {
        "dashboard": {"modes": []}
    }
    category = config["categories"][0]["channels"]["dashboard"]
    assert category == {"modes": ["home"]}


async def test_category_buttons_are_inherited(hass: HomeAssistant) -> None:
    """Icon, times and push come from the category until a step sets them."""
    data = _with_notification(
        buttons=[
            {"id": "s", "type": "snooze", "enabled": True},
            {"id": "own", "type": "custom", "label": "Own"},
            {"id": "door", "type": "custom", "icon": "mdi:door", "enabled": False},
        ]
    )
    data["categories"][0]["buttons"] = [
        {"type": "snooze", "snooze": ["30m"], "icon": "mdi:sleep"},
        {"id": "door", "type": "custom", "label": "Open", "show_in_push": True},
        {"id": "light", "type": "custom", "label": "Light"},
    ]
    config = await async_validate_config(hass, data)
    category = config["categories"][0]
    assert [button["id"] for button in category["buttons"]][:4] == [
        "tap",
        "done",
        "dismiss",
        "snooze",
    ]
    buttons = {button["id"]: button for button in _effective(config)}
    assert buttons["s"]["snooze"] == ["30m"]
    assert buttons["s"]["icon"] == "mdi:sleep"
    assert buttons["s"]["enabled"] is True
    assert buttons["door"]["label"] == "Open"
    assert buttons["door"]["icon"] == "mdi:door"
    assert buttons["door"]["enabled"] is False
    assert buttons["door"]["show_in_push"] is True
    assert buttons["door"]["category"] is True
    assert buttons["light"]["enabled"] is True
    assert buttons["own"]["category"] is False


async def test_speaker_repeat_volume_and_chime(hass: HomeAssistant) -> None:
    """Recurring needs its time; the channel can set a volume and no chime."""
    config = default_config()
    config["speakers"] = [{"id": "x", "entity_id": "media_player.x"}]
    config["categories"][0]["channels"]["speaker:x"] = {
        "modes": ["home"],
        "repeat": {"type": "recurring", "every": {"hours": 1}},
        "volume": 0.5,
        "play_chime": False,
    }
    result = await async_validate_config(hass, config)
    channel = result["categories"][0]["channels"]["speaker:x"]
    assert channel["repeat"] == {"type": "recurring", "every": {"hours": 1}}
    assert channel["volume"] == 0.5
    assert channel["play_chime"] is False
    config["categories"][0]["channels"]["speaker:x"]["repeat"] = {"type": "recurring"}
    with pytest.raises(ConfigValidationError):
        await async_validate_config(hass, config)


def _with_category_tap(tap: dict[str, Any], **step: Any) -> dict[str, Any]:
    config = _with_notification(**step)
    config["categories"][0]["buttons"] = [{"type": "tap", "enabled": True, **tap}]
    return config


async def test_button_keys_follow_the_category(hass: HomeAssistant) -> None:
    """Each key of a step's Tap or custom button is inherited on its own."""
    actions = {"entity_action": True, "notification_state": {"type": "mute"}}
    navigation = {"type": "navigate", "path": "/x"}
    config = await async_validate_config(
        hass,
        _with_category_tap(
            {"actions": actions, "navigation": navigation, "snooze_for": "3h"},
            buttons=[{"type": "tap", "actions": {"entity_action": False}}],
        ),
    )
    tap = next(b for b in _effective(config) if b["type"] == "tap")
    assert tap["actions"] == {
        "entity_action": False,
        "notification_state": {"type": "mute"},
        "ha_actions": [],
    }
    assert tap["navigation"] == navigation
    assert tap["snooze_for"] == "3h"
    assert tap["run_button"] is None

    # Navigation switched off in the step.
    config = await async_validate_config(
        hass,
        _with_category_tap(
            {"navigation": navigation},
            buttons=[{"type": "tap", "navigation": {"type": "none"}}],
        ),
    )
    tap = next(b for b in _effective(config) if b["type"] == "tap")
    assert tap["navigation"] is None

    config = await async_validate_config(
        hass, _with_category_tap({"actions": actions, "run_button": "done"})
    )
    category_tap = config["categories"][0]["buttons"][0]
    # Button action: the actions are not used, so not kept.
    assert "actions" not in category_tap
    tap = next(b for b in _effective(config) if b["type"] == "tap")
    assert tap["run_button"] == "done"


async def test_step_tap_run_button(hass: HomeAssistant) -> None:
    """A step's Tap can run its own actions instead of the category's button."""
    own = {"entity_action": True}
    config = await async_validate_config(
        hass,
        _with_category_tap(
            {"run_button": "done"},
            buttons=[{"type": "tap", "run_button": "", "actions": own}],
        ),
    )
    tap = next(b for b in _effective(config) if b["type"] == "tap")
    assert tap["actions"]["entity_action"] is True
    assert tap["run_button"] is None

    config = await async_validate_config(
        hass,
        _with_category_tap(
            {"actions": {"ha_actions": [{"action": "light.turn_on"}]}},
            buttons=[{"type": "tap", "run_button": "dismiss", "actions": own}],
        ),
    )
    step_tap = next(
        b
        for b in config["notifications"][0]["steps"][0]["buttons"]
        if b["type"] == "tap"
    )
    assert "actions" not in step_tap
    tap = next(b for b in _effective(config) if b["type"] == "tap")
    assert tap["run_button"] == "dismiss"


def test_upgrade_tap_behavior() -> None:
    """Stored Taps that showed the category's behavior follow it again."""
    more_info = {"navigation": {"type": "more_info"}}
    own = {"mute": True}

    def data(category_tap: dict[str, Any], *taps: dict[str, Any]) -> dict[str, Any]:
        return {
            "categories": [
                {"id": "general", "buttons": [{"type": "tap", **category_tap}]}
            ],
            "notifications": [
                {
                    "category": "general",
                    "steps": [{"buttons": [{"type": "tap", **tap}]} for tap in taps],
                }
            ],
        }

    def taps(value: dict[str, Any]) -> list[dict[str, Any]]:
        return [step["buttons"][0] for step in value["notifications"][0]["steps"]]

    value = data(
        {},
        {"actions": more_info},
        {"actions": own},
        {"actions": own, "run_button": ""},
    )
    upgrade_tap_behavior(value)
    assert taps(value) == [
        {"type": "tap"},
        {"type": "tap", "actions": own},
        {"type": "tap", "actions": own, "run_button": ""},
    ]

    # The category's Button action used to win over a step's actions.
    value = data({"run_button": "done"}, {"actions": own})
    upgrade_tap_behavior(value)
    assert taps(value) == [{"type": "tap"}]


def test_rename_mute_and_pulse() -> None:
    """Silence becomes Mute, the own blink becomes Notification Pulse."""
    value: dict[str, Any] = {
        "categories": [{"buttons": [{"type": "tap", "actions": {"silence": True}}]}],
        "notifications": [
            {"steps": [{"buttons": [{"id": "q", "actions": {"silence": False}}]}]}
        ],
        "lights": [{"effect": "blink"}, {"effect": "rainbow"}],
    }
    rename_mute_and_pulse(value)
    assert value["categories"][0]["buttons"][0]["actions"] == {"mute": True}
    assert value["notifications"][0]["steps"][0]["buttons"][0]["actions"] == {}
    assert [light["effect"] for light in value["lights"]] == [
        "notification_pulse",
        "rainbow",
    ]


def test_move_schedule_expires() -> None:
    """A schedule's Expires becomes the Expires row of Dismiss when."""
    value: dict[str, Any] = {
        "notifications": [
            {
                "steps": [
                    {
                        "activation": {
                            "type": "schedule",
                            "schedule": {"type": "calendar", "expires": {"hours": 6}},
                        }
                    },
                    {
                        "activation": {
                            "type": "schedule",
                            "schedule": {"type": "calendar", "expires": None},
                        },
                        "dismiss_when": {"triggers": []},
                    },
                    {"activation": {"type": "triggers", "triggers": []}},
                ]
            }
        ]
    }
    move_schedule_expires(value)
    first, second, third = value["notifications"][0]["steps"]
    assert first["activation"]["schedule"] == {"type": "calendar"}
    assert first["dismiss_when"] == {"expires": {"hours": 6}}
    assert second["activation"]["schedule"] == {"type": "calendar"}
    assert second["dismiss_when"] == {"triggers": []}
    assert "dismiss_when" not in third


async def test_builtin_buttons_have_no_own_actions(hass: HomeAssistant) -> None:
    """Done, Dismiss, Snooze and Mute: their status block has the actions."""
    actions = {"entity_action": True, "ha_actions": [{"action": "light.turn_on"}]}
    config = _with_notification(buttons=[{"type": "done", "actions": actions}])
    config["categories"][0]["buttons"] = [
        {"type": "done", "enabled": True, "actions": actions}
    ]
    validated = await async_validate_config(hass, config)
    category_done = next(
        b for b in validated["categories"][0]["buttons"] if b["type"] == "done"
    )
    assert "actions" not in category_done
    step_done = next(
        b
        for b in validated["notifications"][0]["steps"][0]["buttons"]
        if b["type"] == "done"
    )
    assert "actions" not in step_done
    done = next(b for b in _effective(validated) if b["type"] == "done")
    assert done["actions"] == {}


async def test_custom_button_actions_follow_the_category(
    hass: HomeAssistant,
) -> None:
    """A category's custom button's actions apply until the step sets a key."""
    config = _with_notification(
        buttons=[{"id": "door", "type": "custom", "actions": {"ha_actions": []}}]
    )
    config["categories"][0]["buttons"] = [
        {
            "id": "door",
            "type": "custom",
            "label": "Open",
            "actions": {
                "entity_action": True,
                "ha_actions": [{"action": "lock.unlock"}],
            },
        }
    ]
    validated = await async_validate_config(hass, config)
    door = next(b for b in _effective(validated) if b["id"] == "door")
    assert door["actions"] == {
        "entity_action": True,
        "notification_state": {"type": "unchanged"},
        "ha_actions": [],
    }


async def test_step_values_equal_to_the_category_are_kept(
    hass: HomeAssistant,
) -> None:
    """A value chosen equal to the category's stays the step's own."""
    config = _with_notification(
        buttons=[
            {"type": "done", "enabled": True},
            {"type": "snooze", "snooze": ["1h", "3h", "tomorrow"]},
            {"type": "tap", "actions": {"ha_actions": []}},
        ]
    )
    validated = await async_validate_config(hass, config)
    stored = {
        b["type"]: b for b in validated["notifications"][0]["steps"][0]["buttons"]
    }
    assert stored["done"]["enabled"] is True
    assert stored["snooze"]["snooze"] == ["1h", "3h", "tomorrow"]
    assert stored["tap"]["actions"] == {"ha_actions": []}


async def test_run_state_actions_is_stored_only_when_off(
    hass: HomeAssistant,
) -> None:
    config = _with_notification(
        buttons=[
            {"type": "done", "run_state_actions": False},
            {"type": "dismiss", "run_state_actions": True},
        ]
    )
    validated = await async_validate_config(hass, config)
    stored = {
        b["type"]: b for b in validated["notifications"][0]["steps"][0]["buttons"]
    }
    assert stored["done"]["run_state_actions"] is False
    assert "run_state_actions" not in stored["dismiss"]
    buttons = {b["type"]: b for b in _effective(validated)}
    assert buttons["done"]["run_state_actions"] is False
    assert buttons["dismiss"]["run_state_actions"] is True


def test_old_step_values_equal_to_the_category_are_dropped() -> None:
    """Once, on old data: switches, times and empty actions follow again."""
    config = _with_notification(
        buttons=[
            {"type": "done", "enabled": True, "actions": {}},
            {"type": "dismiss", "enabled": True, "actions": {}},
            {
                "type": "snooze",
                "snooze": ["1h", "3h", "tomorrow"],
                "actions": {"mute": True},
            },
            {"type": "tap", "enabled": False, "actions": {}},
        ]
    )
    config["categories"][0]["buttons"] = [
        {"type": "tap", "enabled": False},
        {"type": "done", "enabled": True},
        {"type": "dismiss", "enabled": False},
        {"type": "snooze", "enabled": False, "snooze": ["1h", "3h", "tomorrow"]},
    ]
    config["notifications"][0]["category"] = "general"
    drop_inherited_values(config)
    stored = {b["type"]: b for b in config["notifications"][0]["steps"][0]["buttons"]}
    assert set(stored["done"]) == {"type"}
    # Differs from the category (Dismiss is off there): kept.
    assert stored["dismiss"]["enabled"] is True
    assert "actions" not in stored["dismiss"]
    assert "snooze" not in stored["snooze"]
    assert stored["snooze"]["actions"] == {"mute": True}
    # The Tap's actions are its own Tap behavior.
    assert stored["tap"]["actions"] == {}
    assert "enabled" not in stored["tap"]


def test_upgrade_push_devices() -> None:
    """A person's notify and device_type become a list of one push device."""
    people: list[dict[str, Any]] = [
        {"person": "person.a", "notify": "notify.a", "device_type": "ios"},
        {"person": "person.b"},
    ]
    value: dict[str, Any] = {"people": people}
    upgrade_push_devices(value)
    [device] = people[0]["push_devices"]
    assert device["id"]
    assert (device["notify"], device["device_type"], device["enabled"]) == (
        "notify.a",
        "ios",
        True,
    )
    assert "notify" not in people[0]
    assert "push_devices" not in people[1]


async def test_upgrade_status_actions(hass: HomeAssistant) -> None:
    """Old button actions move to the status blocks; what runs stays the same."""
    light = {"action": "light.turn_on"}
    page = {"type": "navigate", "path": "/lovelace/home"}
    config = default_config()
    general = config["categories"][0]
    quiet = {**copy.deepcopy(general), "id": "quiet", "name": "Quiet"}
    general["buttons"] = [
        {"type": "tap", "enabled": True},
        {
            "type": "done",
            "enabled": True,
            "actions": {"ha_actions": [light], "navigation": page},
        },
        {"type": "snooze", "snooze": ["3h", "tomorrow"]},
        {
            "id": "door",
            "type": "custom",
            "label": "Open",
            "actions": {
                "entity_action": True,
                "notification_state": {"type": "snooze", "snooze": "2h"},
            },
        },
    ]
    quiet["buttons"] = [{"type": "tap", "enabled": False}]
    config["categories"].append(quiet)
    config["notifications"] = [
        {
            "id": "n1",
            "name": "One",
            "category": "general",
            "steps": [
                {
                    "id": "s1",
                    "message": "Hello",
                    "buttons": [
                        {"id": "b-done", "type": "done"},
                        {
                            "id": "b-mute",
                            "type": "mute",
                            "actions": {"entity_action": True},
                        },
                        {"id": "door", "type": "custom", "actions": {"mute": True}},
                        {
                            "id": "x",
                            "type": "custom",
                            "label": "X",
                            "actions": {
                                "mute": True,
                                "notification_state": {"type": "done"},
                            },
                        },
                        {
                            "id": "b-tap",
                            "type": "tap",
                            "open_on_tap": "/p",
                            "actions": {"navigation": {"type": "more_info"}},
                        },
                        {"id": "b-snooze", "type": "snooze", "snooze": ["30m", "1h"]},
                    ],
                }
            ],
        },
        {
            "id": "n2",
            "name": "Two",
            "category": "quiet",
            "steps": [
                {
                    "message": "Hi",
                    "buttons": [{"id": "t2", "type": "tap", "enabled": True}],
                }
            ],
        },
    ]
    upgrade_status_actions(config)

    buttons = {b.get("id", b["type"]): b for b in general["buttons"]}
    assert buttons["tap"]["navigation"] == {"type": "more_info"}
    assert "actions" not in buttons["done"]
    assert buttons["done"]["navigation"] == page
    assert buttons["snooze"]["snooze_for"] == "3h"
    assert buttons["door"]["actions"] == {
        "entity_action": True,
        "notification_state": {"type": "snooze"},
    }
    assert buttons["door"]["snooze_for"] == "2h"
    assert "navigation" not in quiet["buttons"][0]

    step = config["notifications"][0]["steps"][0]
    own = {b["id"]: b for b in step["buttons"]}
    assert step["done_when"]["actions"] == {
        "entity_action": False,
        "ha_actions": [light],
    }
    assert step["mute_when"] == {
        "actions": {"entity_action": True, "ha_actions": []},
        "enabled": True,
    }
    assert "snooze_when" not in step
    assert "actions" not in own["b-mute"]
    assert own["door"]["actions"] == {
        "notification_state": {"type": "mute"},
        "entity_action": False,
    }
    assert own["x"]["actions"] == {"notification_state": {"type": "done"}}
    assert own["b-tap"] == {
        "id": "b-tap",
        "type": "tap",
        "actions": {},
        "navigation": {"type": "more_info"},
    }
    assert own["b-snooze"]["snooze_for"] == "30m"
    other = config["notifications"][1]["steps"][0]["buttons"][0]
    assert other["navigation"] == {"type": "more_info"}

    validated = await async_validate_config(hass, config)
    effective = {
        b["id"]: b
        for b in effective_buttons(
            validated["categories"][0], validated["notifications"][0]["steps"][0]
        )
    }
    assert effective["b-done"]["navigation"] == page
    assert effective["door"]["actions"]["notification_state"] == {"type": "mute"}
    assert effective["b-tap"]["navigation"] == {"type": "more_info"}
