"""Storage of the Notification Center configuration and runtime state.

The configuration lives in ``.storage/notification_center``. It is saved
right after every change. The runtime state (last done times; later also
snoozes and active cards) lives in ``.storage/notification_center.runtime``.
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
    CHANNEL_LIGHT_PREFIX,
    CHANNEL_SPEAKER_PREFIX,
    COLLECTIONS,
    GENERAL_SCHEMA,
    HOME_MODE_ID,
    PERSON_SCHEMA,
    SECTIONS,
    ConfigData,
    ConfigValidationError,
    async_validate_config,
    default_config,
    new_id,
    validate_item,
)

STORAGE_VERSION: Final = 1
STORAGE_MINOR_VERSION: Final = 1
CONFIG_KEY: Final = DOMAIN
RUNTIME_KEY: Final = f"{DOMAIN}.runtime"
BACKUP_KEY: Final = f"{DOMAIN}.backup"

# The version written into YAML exports, so that an older export can be
# migrated when it is imported.
EXPORT_VERSION: Final = 1

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
        return old_data


class ConfigManager:
    """Hold the configuration, apply changes and notify listeners."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the manager."""
        self.hass = hass
        self._store = _ConfigStore(
            hass, STORAGE_VERSION, CONFIG_KEY, minor_version=STORAGE_MINOR_VERSION
        )
        self._runtime_store = Store[dict[str, Any]](hass, 1, RUNTIME_KEY)
        self._backup_store = Store[dict[str, Any]](hass, 1, BACKUP_KEY)
        self._config: ConfigData = {}
        self.runtime: dict[str, Any] = {"last_done": {}}
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
        runtime = await self._runtime_store.async_load()
        if runtime is not None:
            self.runtime = {"last_done": {}, **runtime}
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
        item = validate_item(section, {**data, "id": data.get("id") or new_id()})
        config = self._copy()
        config[section].append(item)
        if section == "modes":
            # A new mode goes before Home, which is always the last fallback.
            config["modes"].sort(key=lambda mode: mode["id"] == HOME_MODE_ID)
        committed = await self._async_commit(config)
        index = self._index(committed, section, item["id"])
        return cast(dict[str, Any], committed[section][index])

    async def async_update(
        self, section: str, item_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Replace an item of a collection, keeping its id and place."""
        config = self._copy()
        index = self._index(config, section, item_id)
        config[section][index] = validate_item(section, {**data, "id": item_id})
        committed = await self._async_commit(config)
        return cast(dict[str, Any], committed[section][index])

    async def async_delete(self, section: str, item_id: str) -> None:
        """Delete an item and the references to it."""
        config = self._copy()
        index = self._index(config, section, item_id)
        if section == "modes" and item_id == HOME_MODE_ID:
            raise ConfigValidationError("the Home mode cannot be deleted")
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
        del config[section][index]
        _remove_references(config, section, item_id)
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
        if section == "modes" and item_ids[-1] != HOME_MODE_ID:
            raise ConfigValidationError("the Home mode stays the last one")
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
            step_ids[step["id"]] = step["id"] = new_id()
            for button in step["buttons"]:
                button["id"] = new_id()
        for group in copied["entity_groups"]:
            group["id"] = new_id()
        # Notification state triggers that point to the copied notification's
        # own steps now point to the copy.
        for step in copied["steps"]:
            for items in (
                step["start"].get("triggers", []),
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
        """Save the settings of a person (push, device type, sleep entity)."""
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
        if version != EXPORT_VERSION:
            raise ConfigValidationError(f"unknown export version {version}")
        unknown = set(data) - set(SECTIONS)
        if unknown:
            raise ConfigValidationError(
                "unknown sections: " + ", ".join(sorted(map(str, unknown)))
            )
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


def _remove_references(config: ConfigData, section: str, item_id: str) -> None:
    """Remove the references to a deleted mode, light, speaker or chime."""
    channel_lists = [category["channels"] for category in config["categories"]] + [
        step["channels"]
        for notification in config["notifications"]
        for step in notification["steps"]
    ]
    if section == "modes":
        for channels in channel_lists:
            for channel in channels.values():
                if item_id in channel.get("modes", []):
                    channel["modes"].remove(item_id)
    elif section in ("lights", "speakers"):
        prefix = CHANNEL_LIGHT_PREFIX if section == "lights" else CHANNEL_SPEAKER_PREFIX
        for channels in channel_lists:
            channels.pop(prefix + item_id, None)
    elif section == "chimes":
        for category in config["categories"]:
            if category.get("chime") == item_id:
                category["chime"] = None
        for channels in channel_lists:
            for channel in channels.values():
                if channel.get("chime") == item_id:
                    channel["chime"] = None


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
                "sleep_entity": stored.get("sleep_entity"),
            }
        )
    return people
