"""Upgrades of earlier (0.x) configuration forms.

Each ``upgrade_*`` function rewrites an earlier stored form in place to the
current one, before the structure check. The whole module is removed at 1.0.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import homeassistant.helpers.config_validation as cv
import voluptuous as vol

from .model import (
    AUDIENCE_STATES,
    CHANNEL_DASHBOARD,
    CHANNEL_NOTIFICATION_CENTER,
    CHANNEL_SPEAKER_PREFIX,
    CHIME_NONE,
    DEFAULT_SNOOZE_CHOICES,
    SYSTEM_COLORS,
    TRIGGER_ENTITIES_NUMERIC,
    TRIGGER_ENTITIES_STATE,
    TRIGGER_LISTED_ENTITIES,
    new_id,
)


def upgrade_listed(notification: dict[str, Any]) -> None:
    """Turn earlier Listed entities triggers and conditions into the new kinds.

    With a limit (above or below) the item becomes Notification entities
    numeric state, otherwise Notification entities state. It points to the
    notification itself, as the earlier kind always did.
    """
    for step in notification.get("steps") or []:
        if not isinstance(step, dict):
            continue
        start = step.get("activation") or step.get("start") or {}
        done_when = step.get("done_when") or {}
        conditions = step.get("conditions")
        conditions = conditions if isinstance(conditions, dict) else {}
        for items, key in (
            (start.get("triggers"), "trigger"),
            (done_when.get("triggers"), "trigger"),
            (start.get("conditions"), "condition"),
            (step.get("hide_while"), "condition"),
            ((step.get("show_when") or {}).get("conditions"), "condition"),
            (conditions.get("conditions"), "condition"),
        ):
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get(key) == TRIGGER_LISTED_ENTITIES:
                    _upgrade_listed_item(item, key, notification.get("id"))


def _snooze_choice(duration: Any) -> str:
    """Return the snooze choice nearest to an earlier fixed duration."""
    try:
        minutes = cv.time_period(duration).total_seconds() / 60
    except vol.Invalid:
        return "1h"
    lengths = {
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "3h": 180,
        "6h": 360,
        "12h": 720,
        "tomorrow": 1440,
        "2d": 2880,
        "3d": 4320,
        "1w": 10080,
        "2w": 20160,
        "1mo": 43200,
    }
    return min(lengths, key=lambda key: abs(lengths[key] - minutes))


def upgrade_buttons(notification: dict[str, Any]) -> None:
    """Turn earlier buttons and the notification's Snooze into the new ones.

    A button no longer chooses what happens to the card: Done marks it done,
    Dismiss dismisses it, Snooze snoozes it, and the others only run their
    action. An earlier Dismiss that kept the card silently (Mute) becomes a
    button of its own (with its id, so its entity actions stay), so it does
    not start dismissing. The notification's
    Snooze moves to its Snooze button: not allowed switches it off, a fixed
    time becomes its one choice.
    """
    snooze = notification.pop("snooze", None)
    snooze = snooze if isinstance(snooze, dict) else {}
    for step in notification.get("steps") or []:
        buttons = step.get("buttons") if isinstance(step, dict) else None
        if not isinstance(buttons, list):
            if isinstance(step, dict) and snooze.get("type") in (
                "not_allowed",
                "fixed",
            ):
                step["buttons"] = buttons = []
            else:
                continue
        found = False
        for button in buttons:
            if not isinstance(button, dict):
                continue
            effect = button.pop("card", None)
            if button.get("type") == "dismiss" and effect == "keep_silent":
                button["type"] = "custom"
                button.setdefault("label", "Mute")
                button.setdefault("icon", "mdi:volume-off")
            if button.get("type") != "snooze":
                continue
            found = True
            own = button.get("snooze")
            if isinstance(own, list):
                continue
            if isinstance(own, dict):
                button["snooze"] = [_snooze_choice(own)]
            elif own != "ask" and snooze.get("type") == "fixed":
                button["snooze"] = [_snooze_choice(snooze.get("duration"))]
            else:
                button.pop("snooze", None)
            if snooze.get("type") == "not_allowed" and own is None:
                button["enabled"] = False
        if not found and snooze.get("type") in ("not_allowed", "fixed"):
            button = {"type": "snooze", "enabled": snooze["type"] == "fixed"}
            if snooze["type"] == "fixed":
                button["snooze"] = [_snooze_choice(snooze.get("duration"))]
            buttons.insert(0, button)


def upgrade_category_buttons(data: dict[str, Any]) -> None:
    """Give categories of 0.4 and before their buttons.

    A category's Snooze becomes its Snooze button. The steps then keep only
    what differs from the category: the snooze times, the push settings and
    the icons that were the defaults are left out, so they are inherited.
    Runs once: afterwards every category has its buttons.
    """
    categories = data.get("categories")
    if not isinstance(categories, list) or all(
        not isinstance(category, dict) or "buttons" in category
        for category in categories
    ):
        return
    for category in categories:
        if not isinstance(category, dict) or "buttons" in category:
            continue
        snooze = category.pop("snooze", None)
        snooze = snooze if isinstance(snooze, dict) else {}
        button: dict[str, Any] = {"type": "snooze"}
        if snooze.get("type") == "fixed":
            button["snooze"] = [_snooze_choice(snooze.get("duration"))]
        category["buttons"] = [button]
    defaults = list(DEFAULT_SNOOZE_CHOICES)
    for notification in data.get("notifications") or []:
        if not isinstance(notification, dict):
            continue
        for step in notification.get("steps") or []:
            buttons = step.get("buttons") if isinstance(step, dict) else None
            for button in buttons if isinstance(buttons, list) else []:
                kind = button.get("type") if isinstance(button, dict) else None
                if kind is None:
                    continue
                if kind == "snooze" and list(button.get("snooze") or []) == defaults:
                    button.pop("snooze", None)
                if button.get("show_in_push") is True:
                    button.pop("show_in_push", None)
                button.pop("push_tap", None)
                for key in ("icon", "label"):
                    if not button.get(key):
                        button.pop(key, None)


def upgrade_devices(data: dict[str, Any]) -> None:
    """Drop the device settings of the first plan that 0.6.2 left out.

    A light's transition and highlight effect (the effect is now chosen by
    the light's Effect and the notification's Highlight), and a speaker's
    resume playback (it follows the speaker).
    """
    for light in data.get("lights") or []:
        if isinstance(light, dict):
            light.pop("transition", None)
            light.pop("highlight_effect", None)
            for key in ("brightness", "dim_brightness"):
                if light.get(key) == 0:
                    light[key] = None
    for speaker in data.get("speakers") or []:
        if isinstance(speaker, dict):
            speaker.pop("resume_playback", None)


def upgrade_colors(data: dict[str, Any]) -> None:
    """Bring the colours and chimes of 0.6.4 and before to the 0.6.5 form.

    - ``card_color`` is now ``color``.
    - A custom colour (``#rrggbb``, or a ``light_color``) becomes an own colour
      of the Colors list, "Custom 1" and on (the same RGB is one colour). A
      light colour that differs from the card colour goes to every light's
      Colors, for that colour.
    - A speaker channel has no chime of its own any more: the category's or
      notification's plays.
    - A category's chime cannot be None (0.6.6): such a category plays the
      default chime.
    """
    colors = data.get("colors")
    if not isinstance(colors, list):
        colors = []
    by_look: dict[tuple[Any, ...], str] = {}
    lights = [light for light in data.get("lights") or [] if isinstance(light, dict)]
    items = [
        item
        for section in ("categories", "notifications")
        for item in data.get(section) or []
        if isinstance(item, dict)
    ]
    for item in items:
        if "card_color" not in item and "light_color" not in item:
            continue
        card = item.pop("card_color", None)
        light = item.pop("light_color", None)
        name = str(card).strip().lower().replace("_", "-") if card else None
        if light is None and (not name or name in SYSTEM_COLORS):
            item.setdefault("color", name)
            continue
        rgb = _parse_hex(card) or (
            list(SYSTEM_COLORS[name]) if name in SYSTEM_COLORS else None
        )
        light_rgb = list(light) if isinstance(light, (list, tuple)) else None
        rgb = rgb or light_rgb or list(SYSTEM_COLORS["primary"])
        key = (tuple(rgb), tuple(light_rgb) if light_rgb else None)
        if key not in by_look:
            color_id = new_id()
            colors.append(
                {"id": color_id, "name": f"Custom {len(by_look) + 1}", "rgb": rgb}
            )
            by_look[key] = color_id
            if light_rgb and light_rgb != rgb:
                for lamp in lights:
                    own = lamp.setdefault("colors", {})
                    if isinstance(own, dict):
                        own[color_id] = light_rgb
        item.setdefault("color", by_look[key])
    if colors:
        data["colors"] = colors

    def drop_chime(channels: Any) -> None:
        if not isinstance(channels, dict):
            return
        for key, channel in channels.items():
            if str(key).startswith(CHANNEL_SPEAKER_PREFIX) and isinstance(
                channel, dict
            ):
                channel.pop("chime", None)

    for category in data.get("categories") or []:
        if isinstance(category, dict):
            drop_chime(category.get("channels"))
            if category.get("chime") == CHIME_NONE:
                del category["chime"]
    for notification in data.get("notifications") or []:
        for step in (
            (notification.get("steps") or []) if isinstance(notification, dict) else []
        ):
            if isinstance(step, dict):
                drop_chime(step.get("channels"))


def _parse_hex(value: Any) -> list[int] | None:
    text = value.strip() if isinstance(value, str) else ""
    if len(text) == 7 and text.startswith("#"):
        try:
            return [int(text[i : i + 2], 16) for i in (1, 3, 5)]
        except ValueError:
            return None
    return None


def upgrade_channels(data: dict[str, Any], people: Iterable[str]) -> None:
    """Bring the channels and audiences of 0.5 and before to the 0.6 form.

    - The Notification center channel is now called Dashboard.
    - ``when`` becomes ``delay``: After X keeps its time, Immediately and On
      arrival send at once (arriving is now part of the audience: a person
      away gets it when they are home again).
    - A category gets an audience (everyone, in every state), and, once, the
      Dashboard in every mode, so that nothing disappears after the update.
    - A step's audience, a list of people (empty: everyone), becomes the
      people it leaves out, with no state.
    - A person's Sleep entity becomes a Sleep condition (the entity is on).
    """
    categories = data.get("categories")
    categories = categories if isinstance(categories, list) else []
    modes = [
        mode["id"]
        for mode in data.get("modes") or []
        if isinstance(mode, dict) and mode.get("id")
    ]
    first = any(
        isinstance(category, dict) and "audience" not in category
        for category in categories
    )
    for category in categories:
        if not isinstance(category, dict):
            continue
        channels = category.get("channels")
        if isinstance(channels, dict):
            _upgrade_channel_settings(channels, category=True)
        if first and "audience" not in category:
            category["audience"] = {}
            channels = category.setdefault("channels", {})
            if isinstance(channels, dict) and CHANNEL_DASHBOARD not in channels:
                channels[CHANNEL_DASHBOARD] = {"modes": list(modes)}
    for person in data.get("people") or []:
        if isinstance(person, dict) and "sleep_entity" in person:
            entity = person.pop("sleep_entity")
            if entity and "sleep" not in person:
                person["sleep"] = {"type": "state", "entity_id": entity, "state": "on"}
    everyone = set(people)
    for notification in data.get("notifications") or []:
        if not isinstance(notification, dict):
            continue
        for step in notification.get("steps") or []:
            if not isinstance(step, dict):
                continue
            channels = step.get("channels")
            if isinstance(channels, dict):
                _upgrade_channel_settings(channels, category=False)
            audience = step.get("audience")
            if isinstance(audience, list):
                chosen = {str(person) for person in audience}
                step["audience"] = (
                    {
                        person: dict.fromkeys(AUDIENCE_STATES, False)
                        for person in sorted(everyone - chosen)
                    }
                    if chosen
                    else {}
                )


def _upgrade_channel_settings(channels: dict[str, Any], *, category: bool) -> None:
    if CHANNEL_NOTIFICATION_CENTER in channels:
        old = channels.pop(CHANNEL_NOTIFICATION_CENTER)
        channels.setdefault(CHANNEL_DASHBOARD, old)
    for channel in channels.values():
        if not isinstance(channel, dict) or "when" not in channel:
            continue
        when = channel.pop("when")
        delay = (
            when.get("delay")
            if isinstance(when, dict) and when.get("type") == "after"
            else None
        )
        if delay or not category:
            channel["delay"] = delay or None


def upgrade_show_when(notification: dict[str, Any]) -> None:
    """Turn the Start conditions and Hide while of earlier steps into Show when.

    Start conditions alone are used at the start only; Hide while alone
    becomes its opposite (Not), used while a card is open. With both, the
    card needs the Start conditions and not Hide while, at the start and
    while it is open.
    """
    for step in notification.get("steps") or []:
        if not isinstance(step, dict):
            continue
        start = step.get("start")
        conditions = start.pop("conditions", None) if isinstance(start, dict) else None
        hide_while = step.pop("hide_while", None)
        conditions = conditions if isinstance(conditions, list) else []
        hide_while = hide_while if isinstance(hide_while, list) else []
        if "show_when" in step or not (conditions or hide_while):
            continue
        items = list(conditions)
        if hide_while:
            items.append({"condition": "not", "conditions": hide_while})
        step["show_when"] = {
            "start": bool(conditions),
            "hide": bool(hide_while),
            "conditions": items,
        }


def upgrade_terms(notification: dict[str, Any]) -> None:
    """Rename the step fields of earlier versions (0.4.11 and before).

    start -> activation; show_when -> conditions, with start ->
    activate_only_while_met and hide -> hide_while_not_met; Done when's
    start_no_longer_true -> activation_conditions_no_longer_true.
    """
    for step in notification.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if "start" in step and "activation" not in step:
            step["activation"] = step.pop("start")
        show_when = step.pop("show_when", None)
        if isinstance(show_when, dict) and not isinstance(step.get("conditions"), dict):
            step["conditions"] = {
                "activate_only_while_met": show_when.get("start", True),
                "hide_while_not_met": show_when.get("hide", True),
                "conditions": show_when.get("conditions") or [],
            }
        done_when = step.get("done_when")
        if isinstance(done_when, dict) and "start_no_longer_true" in done_when:
            done_when.setdefault(
                "activation_conditions_no_longer_true",
                done_when.pop("start_no_longer_true"),
            )


def _upgrade_listed_item(item: dict[str, Any], key: str, own_id: Any) -> None:
    options = item.pop("options", None)
    if isinstance(options, dict):
        item.update(options)
    numeric = "above" in item or "below" in item
    item[key] = TRIGGER_ENTITIES_NUMERIC if numeric else TRIGGER_ENTITIES_STATE
    for name in ("to", "not_to") if numeric else ("above", "below"):
        item.pop(name, None)
    if not item.get("notification") and own_id:
        item["notification"] = own_id
