"""Storage of the Notification Center configuration and runtime state.

The configuration lives in ``.storage/notification_center``. It is saved
right after every change. The runtime state (cards, last done times) lives in
``.storage/notification_center.runtime`` and belongs to the engine.
Before an import replaces the configuration, the previous one is kept in
``.storage/notification_center.backup``.
"""

from __future__ import annotations

from collections.abc import Callable
import copy
from typing import Any, Final, cast

from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util, yaml as yaml_util

from .const import DOMAIN
from .model import (
    CHANNEL_PUSH,
    COLLECTIONS,
    DEVICE_PREFIXES,
    GENERAL_CATEGORY_ID,
    GENERAL_SCHEMA,
    HOME_MODE_ID,
    PERSON_SCHEMA,
    SECTIONS,
    ConfigData,
    ConfigValidationError,
    async_validate_config,
    category_custom_ids,
    default_config,
    detach_category_buttons,
    new_id,
    notifications_using,
    validate_item,
)
from .normalize import normalize_notification

STORAGE_VERSION: Final = 1
# 2: the Push channel starts switched off (0.6.8).
# 3: a button has a list of actions instead of one action (0.7.1).
STORAGE_MINOR_VERSION: Final = 3
CONFIG_KEY: Final = DOMAIN
RUNTIME_KEY: Final = f"{DOMAIN}.runtime"
BACKUP_KEY: Final = f"{DOMAIN}.backup"

# The version written into YAML exports, so that an older export can be
# migrated when it is imported.
# 2: a button has a list of actions instead of one action (0.7.1).
EXPORT_VERSION: Final = 2

type ConfigListener = Callable[[ConfigData], None]


class _ConfigStore(Store[ConfigData]):
    """The configuration store, with migrations between schema versions."""

    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> ConfigData:
        # Version 1 is the first schema. Later schema changes are migrated
        # here, step by step, so that an update never loses settings.
        if old_major_version == 1 and old_minor_version < 2:
            switch_push_off(old_data)
        if old_major_version == 1 and old_minor_version < 3:
            upgrade_button_actions(old_data)
        return old_data


# What a button's one action of the earlier data model becomes in its list.
_OLD_ACTIONS: Final[dict[str, Callable[[dict[str, Any]], dict[str, Any]]]] = {
    "ha_action": lambda old: {"ha_actions": list(old.get("actions") or [])},
    "entity_action": lambda old: {"entity_action": True},
    "silence": lambda old: {"silence": True},
    "more_info": lambda old: {
        "navigation": {
            "type": "more_info",
            **({"entity_id": old["entity_id"]} if old.get("entity_id") else {}),
        }
    },
    "navigate": lambda old: {
        "navigation": {"type": "navigate", "path": old.get("path") or ""}
    },
}


def upgrade_button_actions(data: dict[str, Any]) -> None:
    """Turn every button's one action into its list of actions.

    Nothing (and the never offered Show attachment) becomes an empty list.
    """
    for notification in data.get("notifications") or []:
        steps = notification.get("steps") if isinstance(notification, dict) else None
        for step in steps or []:
            buttons = step.get("buttons") if isinstance(step, dict) else None
            for button in buttons or []:
                if not isinstance(button, dict) or "action" not in button:
                    continue
                old = button.pop("action")
                kind = old.get("type") if isinstance(old, dict) else None
                upgrade = _OLD_ACTIONS.get(kind) if isinstance(kind, str) else None
                button["actions"] = upgrade(old) if upgrade else {}


def switch_push_off(data: dict[str, Any]) -> None:
    """Untick the Push channel everywhere: it starts off when it arrives.

    Push settings of the earlier data model were never sent; ticking the
    channel is the user's choice once the phones are set on the People page.
    """
    for category in data.get("categories") or []:
        channels = category.get("channels") if isinstance(category, dict) else None
        push = channels.get(CHANNEL_PUSH) if isinstance(channels, dict) else None
        if isinstance(push, dict):
            push["modes"] = []
    for notification in data.get("notifications") or []:
        steps = notification.get("steps") if isinstance(notification, dict) else None
        for step in steps or []:
            channels = step.get("channels") if isinstance(step, dict) else None
            push = channels.get(CHANNEL_PUSH) if isinstance(channels, dict) else None
            if isinstance(push, dict):
                push.pop("modes", None)


class ConfigManager:
    """Hold the configuration, apply changes and notify listeners."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the manager."""
        self.hass = hass
        self._store = _ConfigStore(
            hass, STORAGE_VERSION, CONFIG_KEY, minor_version=STORAGE_MINOR_VERSION
        )
        self._backup_store = Store[dict[str, Any]](hass, 1, BACKUP_KEY)
        self._config: ConfigData = {}
        self._listeners: list[ConfigListener] = []
        self._unsub_registry: CALLBACK_TYPE | None = None

    @property
    def config(self) -> ConfigData:
        """Return the current configuration. Do not change it in place."""
        return self._config

    async def async_load(self) -> None:
        """Load the configuration, or create the default one."""
        stored = await self._store.async_load()
        if stored is None:
            self._config = default_config()
            await self._store.async_save(self._config)
        else:
            self._config = await async_validate_config(self.hass, stored)
            if self._config != stored:
                # Keep what the upgrades changed, so that it is done once.
                await self._store.async_save(self._config)
        self._unsub_registry = self.hass.bus.async_listen(
            er.EVENT_ENTITY_REGISTRY_UPDATED, self._async_entity_registry_updated
        )

    @callback
    def async_unload(self) -> None:
        """Stop listening to entity registry changes."""
        if self._unsub_registry is not None:
            self._unsub_registry()
            self._unsub_registry = None

    @callback
    def async_add_listener(self, listener: ConfigListener) -> CALLBACK_TYPE:
        """Call the listener after every change. Returns a remove function."""
        self._listeners.append(listener)

        @callback
        def remove() -> None:
            self._listeners.remove(listener)

        return remove

    async def _async_commit(self, config: ConfigData) -> ConfigData:
        """Validate a changed configuration, save it and notify listeners."""
        validated = await async_validate_config(self.hass, config)
        self._config = validated
        await self._store.async_save(validated)
        for listener in list(self._listeners):
            listener(validated)
        return validated

    def _copy(self) -> ConfigData:
        return copy.deepcopy(self._config)

    # -- Collections ---------------------------------------------------------

    @staticmethod
    def _index(config: ConfigData, section: str, item_id: str) -> int:
        if section not in COLLECTIONS:
            raise ConfigValidationError(f"unknown section '{section}'")
        for index, item in enumerate(config[section]):
            if item["id"] == item_id:
                return index
        raise ConfigValidationError(f"{section}: no item with id '{item_id}'")

    async def async_create(self, section: str, data: dict[str, Any]) -> dict[str, Any]:
        """Add an item to the end of a collection and return it."""
        data = {**data, "id": data.get("id") or new_id()}
        if section == "notifications":
            data = normalize_notification(self.hass, self._config, data)
        item = validate_item(section, data)
        config = self._copy()
        config[section].append(item)
        if section == "modes":
            # A new mode starts with Home's channels; validation puts it
            # before Home when Home has no condition.
            for channels in _channel_lists(config):
                for channel in channels.values():
                    modes = channel.get("modes")
                    if modes is not None and HOME_MODE_ID in modes:
                        modes.append(item["id"])
        committed = await self._async_commit(config)
        index = self._index(committed, section, item["id"])
        return cast(dict[str, Any], committed[section][index])

    async def async_update(
        self, section: str, item_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Replace an item of a collection, keeping its id and place."""
        config = self._copy()
        index = self._index(config, section, item_id)
        data = {**data, "id": item_id}
        old = config[section][index]
        if section == "notifications":
            data = normalize_notification(self.hass, config, data, old)
            if data.get("category", GENERAL_CATEGORY_ID) != old["category"]:
                previous = _category(config, old["category"])
                if previous is not None:
                    detach_category_buttons(
                        data,
                        previous,
                        category_custom_ids(previous)
                        - category_custom_ids(
                            _category(config, data.get("category", GENERAL_CATEGORY_ID))
                        ),
                    )
        new_item = validate_item(section, data)
        if section == "categories":
            removed = category_custom_ids(old) - category_custom_ids(new_item)
            if removed:
                for notification in config["notifications"]:
                    if notification["category"] == item_id:
                        detach_category_buttons(notification, old, removed)
        config[section][index] = new_item
        committed = await self._async_commit(config)
        return cast(dict[str, Any], committed[section][index])

    async def async_delete(self, section: str, item_id: str) -> None:
        """Delete an item and the references to it."""
        config = self._copy()
        index = self._index(config, section, item_id)
        if section == "modes" and item_id == HOME_MODE_ID:
            raise ConfigValidationError("the Home mode cannot be deleted")
        if section == "categories" and item_id == GENERAL_CATEGORY_ID:
            raise ConfigValidationError("the General category cannot be deleted")
        if section == "categories":
            used = [
                item["name"]
                for item in config["notifications"]
                if item["category"] == item_id
            ]
            if used:
                raise ConfigValidationError(
                    "the category is used by: " + ", ".join(used)
                )
        if section == "notifications":
            users = notifications_using(config, item_id)
            if users:
                raise ConfigValidationError(
                    "the notification is used by: " + ", ".join(users)
                )
        del config[section][index]
        _remove_references(config, section, item_id)
        await self._async_commit(config)

    async def async_set_mode_channels(self, mode_id: str, channels: list[str]) -> None:
        """Switch a mode on for the given channels of every category.

        The second step of adding a mode. A channel a category does not use
        yet is added for this mode only.
        """
        config = self._copy()
        self._index(config, "modes", mode_id)
        for category in config["categories"]:
            settings = category["channels"]
            for key in set(settings) | set(channels):
                channel = settings.get(key)
                if channel is None:
                    settings[key] = {"modes": [mode_id]}
                    continue
                modes = channel.setdefault("modes", [])
                if key in channels and mode_id not in modes:
                    modes.append(mode_id)
                elif key not in channels and mode_id in modes:
                    modes.remove(mode_id)
        await self._async_commit(config)

    async def async_set_channel_modes(self, key: str, modes: list[str]) -> None:
        """Switch a channel on in the given modes of every category.

        The second step of adding a light, speaker or siren: every category
        gets the same modes. No mode leaves the channel off everywhere.
        """
        config = self._copy()
        known = {mode["id"] for mode in config["modes"]}
        for mode_id in modes:
            if mode_id not in known:
                raise ConfigValidationError(f"no mode '{mode_id}'")
        for category in config["categories"]:
            category["channels"][key] = {
                **category["channels"].get(key, {}),
                "modes": [
                    mode["id"] for mode in config["modes"] if mode["id"] in modes
                ],
            }
        await self._async_commit(config)

    async def async_reorder(self, section: str, item_ids: list[str]) -> None:
        """Put the items of a collection in the given order."""
        config = self._copy()
        if section not in COLLECTIONS:
            raise ConfigValidationError(f"unknown section '{section}'")
        items = {item["id"]: item for item in config[section]}
        if sorted(items) != sorted(item_ids):
            raise ConfigValidationError(
                f"{section}: the new order must list every item exactly once"
            )
        config[section] = [items[item_id] for item_id in item_ids]
        await self._async_commit(config)

    async def async_duplicate(self, notification_id: str) -> dict[str, Any]:
        """Copy a notification, with new ids, right after the original."""
        config = self._copy()
        index = self._index(config, "notifications", notification_id)
        copied = copy.deepcopy(config["notifications"][index])
        copied["id"] = new_id()
        names = {item["name"].casefold() for item in config["notifications"]}
        base = f"{copied['name']} (copy)"
        name, number = base, 2
        while name.casefold() in names:
            name, number = f"{base[:-1]} {number})", number + 1
        copied["name"] = name
        step_ids = {}
        for step in copied["steps"]:
            # The buttons keep their ids: the entity actions point to them,
            # and a category's button is linked by its id.
            step_ids[step["id"]] = step["id"] = new_id()
        for group in copied["entity_groups"]:
            group["id"] = new_id()
        # Notification state triggers that point to the copied notification's
        # own steps now point to the copy.
        for step in copied["steps"]:
            for items in (
                step["activation"].get("triggers", []),
                step["done_when"]["triggers"],
            ):
                for trigger in items:
                    if trigger.get("notification") == notification_id:
                        trigger["notification"] = copied["id"]
                        if trigger.get("step") in step_ids:
                            trigger["step"] = step_ids[trigger["step"]]
        config["notifications"].insert(index + 1, copied)
        committed = await self._async_commit(config)
        return cast(dict[str, Any], committed["notifications"][index + 1])

    async def async_set_enabled(
        self, notification_id: str, enabled: bool, step_id: str | None = None
    ) -> None:
        """Switch a notification, or one of its steps, on or off."""
        config = self._copy()
        notification = config["notifications"][
            self._index(config, "notifications", notification_id)
        ]
        if step_id is None:
            notification["enabled"] = enabled
        else:
            for step in notification["steps"]:
                if step["id"] == step_id:
                    step["enabled"] = enabled
                    break
            else:
                raise ConfigValidationError(f"no step with id '{step_id}'")
        await self._async_commit(config)

    # -- People and general settings ----------------------------------------

    async def async_update_person(self, data: dict[str, Any]) -> None:
        """Save the settings of a person (push, device type, sleep condition)."""
        try:
            person = PERSON_SCHEMA(data)
        except Exception as err:
            raise ConfigValidationError(f"people: {err}") from err
        config = self._copy()
        config["people"] = [
            item for item in config["people"] if item["person"] != person["person"]
        ]
        config["people"].append(person)
        await self._async_commit(config)

    async def async_update_general(self, data: dict[str, Any]) -> None:
        """Save the general settings."""
        try:
            general = GENERAL_SCHEMA(data)
        except Exception as err:
            raise ConfigValidationError(f"general: {err}") from err
        config = self._copy()
        config["general"] = general
        await self._async_commit(config)

    # -- Import and export --------------------------------------------------

    def export_yaml(self) -> str:
        """Return the whole configuration as YAML."""
        data = {"version": EXPORT_VERSION, **self._config}
        return str(yaml_util.dump(data))

    async def async_import_yaml(self, text: str) -> None:
        """Replace the whole configuration with the one in a YAML text.

        The previous configuration is kept in the backup store. Nothing
        changes if the YAML is not valid.
        """
        try:
            data = yaml_util.parse_yaml(text)
        except Exception as err:
            raise ConfigValidationError(f"not valid YAML: {err}") from err
        if not isinstance(data, dict):
            raise ConfigValidationError("the YAML must be a mapping")
        version = data.pop("version", EXPORT_VERSION)
        if version not in (1, EXPORT_VERSION):
            raise ConfigValidationError(f"unknown export version {version}")
        if version < 2:
            upgrade_button_actions(data)
        unknown = set(data) - set(SECTIONS)
        if unknown:
            raise ConfigValidationError(
                "unknown sections: " + ", ".join(sorted(map(str, unknown)))
            )
        notifications = data.get("notifications")
        if isinstance(notifications, list):
            data["notifications"] = [
                normalize_notification(self.hass, data, item)
                if isinstance(item, dict) and item.get("id")
                else item
                for item in notifications
            ]
        validated = await async_validate_config(self.hass, data)
        await self._backup_store.async_save(
            {"saved_at": dt_util.utcnow().isoformat(), "config": self._config}
        )
        await self._async_commit(validated)

    @property
    def has_data(self) -> bool:
        """Return whether anything beyond the default data was set up."""
        defaults = default_config()
        return any(self._config[section] != defaults[section] for section in SECTIONS)

    # -- Entity renames -----------------------------------------------------

    async def _async_entity_registry_updated(
        self, event: Event[er.EventEntityRegistryUpdatedData]
    ) -> None:
        """Follow an entity id change made in the entity settings."""
        data = event.data
        if data["action"] != "update" or "old_entity_id" not in data:
            return
        old, new = data["old_entity_id"], data["entity_id"]
        config = self._copy()
        if _replace_value(config, old, new):
            await self._async_commit(config)


def _replace_value(data: Any, old: str, new: str) -> bool:
    """Replace every value equal to ``old`` with ``new``; return if any was."""
    changed = False
    if isinstance(data, dict):
        for key, value in data.items():
            if value == old:
                data[key] = new
                changed = True
            else:
                changed |= _replace_value(value, old, new)
    elif isinstance(data, list):
        for index, value in enumerate(data):
            if value == old:
                data[index] = new
                changed = True
            else:
                changed |= _replace_value(value, old, new)
    return changed


def _channel_lists(config: ConfigData) -> list[dict[str, dict[str, Any]]]:
    """Return the channel settings of every category and step."""
    return [category["channels"] for category in config["categories"]] + [
        step["channels"]
        for notification in config["notifications"]
        for step in notification["steps"]
    ]


def _category(config: ConfigData, category_id: str) -> dict[str, Any] | None:
    return next(
        (item for item in config["categories"] if item["id"] == category_id), None
    )


def _remove_references(config: ConfigData, section: str, item_id: str) -> None:
    """Remove the references to a deleted mode, device or chime."""
    channel_lists = _channel_lists(config)
    if section == "modes":
        for channels in channel_lists:
            for channel in channels.values():
                if item_id in channel.get("modes", []):
                    channel["modes"] = [
                        mode for mode in channel["modes"] if mode != item_id
                    ]
    elif section in DEVICE_PREFIXES:
        prefix = DEVICE_PREFIXES[section]
        for channels in channel_lists:
            channels.pop(prefix + item_id, None)
    elif section == "chimes":
        for item in [*config["categories"], *config["notifications"]]:
            if item.get("chime") == item_id:
                item["chime"] = None
    elif section == "colors":
        for item in [*config["categories"], *config["notifications"]]:
            if item.get("color") == item_id:
                item["color"] = None
        for light in config["lights"]:
            light.get("colors", {}).pop(item_id, None)


@callback
def async_people_view(hass: HomeAssistant, config: ConfigData) -> list[dict[str, Any]]:
    """Return every person of Home Assistant with their settings.

    The list follows the person entities, so people are never added by
    hand. Settings of a person who was removed stay stored but are not shown.
    """
    settings = {item["person"]: item for item in config["people"]}
    people = []
    for state in sorted(
        hass.states.async_all("person"), key=lambda state: state.name.casefold()
    ):
        stored = settings.get(state.entity_id, {})
        people.append(
            {
                "person": state.entity_id,
                "name": state.name,
                "picture": state.attributes.get("entity_picture"),
                "user_id": state.attributes.get("user_id"),
                "notify": stored.get("notify"),
                "device_type": stored.get("device_type", "other"),
                "sleep": stored.get("sleep"),
            }
        )
    return people
