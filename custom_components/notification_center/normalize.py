"""Bring a notification from the editor into its stored form.

The notification editor uses Home Assistant's own trigger and condition
editors. They write the integration's triggers in the automation form:
``{trigger: notification_center.notification_state, options: {...}}``, with
the notification given by its sensor and the step by its number. Inside a
notification they are stored flat, with the internal ids, so that they keep
pointing to the same notification and step after a rename or a reorder:

- the options are moved to the top level, an empty target is dropped;
- Notification state: no notification means this notification; a sensor
  is turned into the notification's id; a step number into the step's id;
- Notification entities state and numeric state: like Notification state,
  no notification means this notification and a sensor becomes an id;
- an earlier Listed entities item becomes one of the two.

An entity group with Add new matching switched off remembers the entities
it matched when it was saved (``members``), until its filter changes.
"""

from __future__ import annotations

import copy
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, UNIQUE_ID_NOTIFICATION_PREFIX
from .listed import group_members
from .model import (
    ENTITIES_KINDS,
    TRIGGER_NOTIFICATION_STATE,
    ConfigData,
    new_id,
)

_GROUP_FILTER = ("domain", "device_class", "areas", "floors", "labels")


@callback
def resolve_reference(
    hass: HomeAssistant, config: ConfigData, reference: str
) -> str | None:
    """Return a notification id from an id or its sensor's entity id."""
    if any(item["id"] == reference for item in config["notifications"]):
        return reference
    entry = er.async_get(hass).async_get(reference)
    if (
        entry is not None
        and entry.platform == DOMAIN
        and entry.unique_id.startswith(UNIQUE_ID_NOTIFICATION_PREFIX)
    ):
        return entry.unique_id.removeprefix(UNIQUE_ID_NOTIFICATION_PREFIX)
    return None


def _step_id(target: dict[str, Any] | None, step: Any) -> Any:
    """Return the id of a step given by its number, or the value as it is."""
    if target is None or isinstance(step, bool):
        return step
    number: int | None = None
    if isinstance(step, (int, float)) or (
        isinstance(step, str) and step.strip().isdigit()
    ):
        number = int(step)
    if number is None:
        return step
    steps = target.get("steps") or []
    if 1 <= number <= len(steps) and isinstance(steps[number - 1], dict):
        return steps[number - 1].get("id", step)
    return step


def _own(
    hass: HomeAssistant,
    config: ConfigData,
    notification: dict[str, Any],
    item: Any,
    key: str,
) -> Any:
    if not isinstance(item, dict):
        return item
    kind = str(item.get(key, ""))
    if kind != TRIGGER_NOTIFICATION_STATE and kind not in ENTITIES_KINDS:
        return item
    result = {k: v for k, v in item.items() if k not in ("options", "target")}
    options = item.get("options")
    if isinstance(options, dict):
        result.update(options)
    if item.get("target"):
        result["target"] = item["target"]
    reference = result.get("notification")
    own_id = notification["id"]
    if not reference:
        result["notification"] = own_id
    elif isinstance(reference, str):
        result["notification"] = resolve_reference(hass, config, reference) or (
            own_id if reference == own_id else reference
        )
    if kind in ENTITIES_KINDS:
        # An empty field is the same as no field.
        return {k: v for k, v in result.items() if v not in (None, "", [])}
    if result.get("step") in (None, ""):
        result.pop("step", None)
    else:
        target = (
            notification
            if result["notification"] == own_id
            else next(
                (
                    other
                    for other in config["notifications"]
                    if other["id"] == result["notification"]
                ),
                None,
            )
        )
        result["step"] = _step_id(target, result["step"])
    return result


def _items(
    hass: HomeAssistant,
    config: ConfigData,
    notification: dict[str, Any],
    items: Any,
    key: str,
) -> Any:
    if not isinstance(items, list):
        return items
    return [_own(hass, config, notification, item, key) for item in items]


@callback
def normalize_notification(
    hass: HomeAssistant,
    config: ConfigData,
    data: dict[str, Any],
    old: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a notification from the editor in its stored form.

    ``data`` must have its id already. ``old`` is the stored notification
    it replaces, if any.
    """
    notification = copy.deepcopy(data)
    steps = notification.get("steps")
    for step in steps if isinstance(steps, list) else []:
        # A new step gets its id now, so a step number can point to it.
        if isinstance(step, dict) and not step.get("id"):
            step["id"] = new_id()
    for step in steps if isinstance(steps, list) else []:
        if not isinstance(step, dict):
            continue
        start = step.get("activation")
        if isinstance(start, dict) and "triggers" in start:
            start["triggers"] = _items(
                hass, config, notification, start["triggers"], "trigger"
            )
        conditions = step.get("conditions")
        if isinstance(conditions, dict) and "conditions" in conditions:
            conditions["conditions"] = _items(
                hass, config, notification, conditions["conditions"], "condition"
            )
        done_when = step.get("done_when")
        if isinstance(done_when, dict) and "triggers" in done_when:
            done_when["triggers"] = _items(
                hass, config, notification, done_when["triggers"], "trigger"
            )
    old_groups = {
        group.get("id"): group for group in (old or {}).get("entity_groups", [])
    }
    for group in notification.get("entity_groups") or []:
        if not isinstance(group, dict):
            continue
        if group.get("add_new", True):
            group.pop("members", None)
            continue
        previous = old_groups.get(group.get("id"))
        same_filter = previous is not None and all(
            _filter_value(previous, key) == _filter_value(group, key)
            for key in _GROUP_FILTER
        )
        if same_filter and previous is not None and previous.get("members") is not None:
            group["members"] = previous["members"]
        elif previous is not None or group.get("members") is None:
            # A new filter, or a new group without a saved list (an imported
            # one keeps the list it brings).
            group["members"] = group_members(hass, _with_lists(group))
    return notification


def _filter_value(group: dict[str, Any], key: str) -> Any:
    value = _with_lists(group).get(key)
    if isinstance(value, list):
        return sorted(map(str, value))
    return value or None


def _with_lists(group: dict[str, Any]) -> dict[str, Any]:
    """Return a group with the earlier single area and label as lists."""
    result = dict(group)
    for old, new in (("area", "areas"), ("label", "labels")):
        if old in result:
            single = result.pop(old)
            if single and not result.get(new):
                result[new] = [single]
    for key in ("areas", "floors", "labels"):
        value = result.get(key)
        if value is None:
            result[key] = []
        elif not isinstance(value, list):
            result[key] = [value]
    return result
