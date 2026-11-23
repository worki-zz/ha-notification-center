"""Sensors: one per notification, and the summary sensor.

A notification's sensor shows its state (``active``, ``hidden``, ...). It is
``sensor.nc_<name>``; the entity id stays when the notification is renamed,
like any Home Assistant entity. The summary sensor
``sensor.notification_center`` counts the active cards and shows the mode.

Every channel has a diagnostic sensor, ``sensor.nc_channel_<channel>``: the
Dashboard's counts the cards it shows now, Push's
(``sensor.nc_channel_push``) the cards on the phones. A light, speaker or siren's is
named after its entity (``sensor.nc_channel_light_kitchen_strip``) and counts
the cards it sends now.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import slugify

from .const import (
    DOMAIN,
    PANEL_ICON,
    SENSOR_STATES,
    UNIQUE_ID_CHANNEL_PREFIX,
    UNIQUE_ID_NOTIFICATION_PREFIX,
    UNIQUE_ID_SUMMARY,
)
from .entity import device_info
from .model import CHANNEL_PUSH, DEVICE_PREFIXES, ConfigData

if TYPE_CHECKING:
    from . import NotificationCenterConfigEntry
    from .engine import Engine

DEFAULT_ICON = "mdi:bell"
PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: NotificationCenterConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the sensors, and follow the notifications as they are added."""
    runtime = entry.runtime_data
    engine = runtime.engine
    info = device_info(entry, runtime.version)
    sensors: dict[str, NotificationSensor] = {}

    @callback
    def sync(config: ConfigData) -> None:
        wanted = {item["id"]: item for item in config["notifications"]}
        new = [
            NotificationSensor(engine, item, info)
            for nid, item in wanted.items()
            if nid not in sensors
        ]
        for sensor in new:
            sensors[sensor.notification_id] = sensor
        if new:
            async_add_entities(new)
        registry = er.async_get(hass)
        for nid in list(sensors):
            if nid not in wanted:
                sensor = sensors.pop(nid)
                if sensor.registry_entry is not None:
                    registry.async_remove(sensor.entity_id)
                else:
                    hass.async_create_task(sensor.async_remove())
            else:
                sensors[nid].config_changed(wanted[nid])

    channels: dict[str, DeviceChannelSensor] = {}

    @callback
    def sync_devices(config: ConfigData) -> None:
        wanted = {
            prefix + item["id"]: item
            for section, prefix in DEVICE_PREFIXES.items()
            for item in config.get(section, [])
        }
        new = [
            DeviceChannelSensor(engine, key, item, info)
            for key, item in wanted.items()
            if key not in channels
        ]
        for sensor in new:
            channels[sensor.key] = sensor
        if new:
            async_add_entities(new)
        registry = er.async_get(hass)
        for key in list(channels):
            if key not in wanted:
                sensor = channels.pop(key)
                if sensor.registry_entry is not None:
                    registry.async_remove(sensor.entity_id)
                else:
                    hass.async_create_task(sensor.async_remove())

    async_add_entities(
        [
            SummarySensor(engine, info),
            DashboardChannelSensor(engine, info),
            PushChannelSensor(engine, info),
        ]
    )
    sync(runtime.manager.config)
    sync_devices(runtime.manager.config)
    entry.async_on_unload(runtime.manager.async_add_listener(sync))
    entry.async_on_unload(runtime.manager.async_add_listener(sync_devices))
    _remove_orphans(hass, entry, set(sensors), set(channels))


def _remove_orphans(
    hass: HomeAssistant,
    entry: NotificationCenterConfigEntry,
    ids: set[str],
    channels: set[str],
) -> None:
    """Remove the sensors of notifications and devices deleted while unloaded."""
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.domain != "sensor":
            continue
        unique_id = entity.unique_id
        if (
            unique_id.startswith(UNIQUE_ID_NOTIFICATION_PREFIX)
            and unique_id.removeprefix(UNIQUE_ID_NOTIFICATION_PREFIX) not in ids
        ) or (
            unique_id.startswith(UNIQUE_ID_CHANNEL_PREFIX)
            and ":" in unique_id
            and unique_id.removeprefix(UNIQUE_ID_CHANNEL_PREFIX) not in channels
        ):
            registry.async_remove(entity.entity_id)


class NotificationSensor(SensorEntity):
    """The state of one notification."""

    _attr_should_poll = False
    # On the service device, so the friendly name starts with the device name
    # ("Notification Center Dishwasher").
    _attr_has_entity_name = True
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_translation_key = "notification"
    _unrecorded_attributes = frozenset({"message", "entities"})

    def __init__(self, engine: Engine, notification: dict[str, Any], info: Any) -> None:
        """Set up the sensor of a notification."""
        self._engine = engine
        self._attr_device_info = info
        self.notification_id: str = notification["id"]
        self._attr_unique_id = UNIQUE_ID_NOTIFICATION_PREFIX + self.notification_id
        self._attr_options = list(SENSOR_STATES)
        self.entity_id = f"sensor.nc_{slugify(notification['name']) or 'notification'}"
        self._apply(notification)

    def _apply(self, notification: dict[str, Any]) -> None:
        self._attr_name = notification["name"]
        icon = notification.get("icon")
        if not icon:
            icon = next(
                (
                    category.get("icon")
                    for category in self._engine.manager.config["categories"]
                    if category["id"] == notification.get("category")
                ),
                None,
            )
        self._attr_icon = icon or DEFAULT_ICON

    @callback
    def config_changed(self, notification: dict[str, Any]) -> None:
        """Take the new name and icon of the notification."""
        self._apply(notification)
        if self.hass is not None and self.entity_id is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        """Follow the engine."""
        self.async_on_remove(self._engine.async_add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        # The Activity log then shows what caused the change.
        if (context := self._engine.contexts.get(self.notification_id)) is not None:
            self.async_set_context(context)
        self.async_write_ha_state()

    @property
    def native_value(self) -> str:
        """Return the state of the notification."""
        return self._engine.notification_state(self.notification_id)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the details of the notification."""
        return self._engine.notification_attributes(self.notification_id)


class SummarySensor(SensorEntity):
    """The number of active cards, the mode and the top notification."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_name = None
    _attr_icon = PANEL_ICON
    _attr_translation_key = "summary"
    # A measurement, so the Activity log does not list every count change;
    # the sensors of the notifications show what happened.
    _attr_state_class = SensorStateClass.MEASUREMENT
    _unrecorded_attributes = frozenset({"top_message", "categories"})

    def __init__(self, engine: Engine, info: Any) -> None:
        """Set up the summary sensor."""
        self._engine = engine
        self._attr_unique_id = UNIQUE_ID_SUMMARY
        self._attr_device_info = info
        self.entity_id = f"sensor.{DOMAIN}"

    async def async_added_to_hass(self) -> None:
        """Follow the engine."""
        self.async_on_remove(self._engine.async_add_listener(self._changed, late=True))

    @callback
    def _changed(self) -> None:
        # Caused by the sensor of the notification that changed.
        if (context := self._engine.summary_context) is not None:
            self.async_set_context(context)
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        """Return the number of active cards."""
        return int(self._engine.summary()["state"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the mode, the counts per category and the top notification."""
        summary = self._engine.summary()
        summary.pop("state")
        return summary


class DashboardChannelSensor(SensorEntity):
    """The cards the Dashboard channel shows now, and the ones it holds back."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_icon = "mdi:view-dashboard-outline"
    _attr_translation_key = "dashboard_channel"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, engine: Engine, info: Any) -> None:
        """Set up the sensor."""
        self._engine = engine
        self._attr_unique_id = f"{UNIQUE_ID_CHANNEL_PREFIX}dashboard"
        self._attr_device_info = info
        self.entity_id = "sensor.nc_channel_dashboard"

    async def async_added_to_hass(self) -> None:
        """Follow the engine."""
        self.async_on_remove(self._engine.async_add_listener(self._changed, late=True))

    @callback
    def _changed(self) -> None:
        if (context := self._engine.summary_context) is not None:
            self.async_set_context(context)
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        """Return the number of cards shown."""
        return int(self._engine.dashboard_summary()["state"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the cards held back (upcoming, by what they wait for) and off."""
        summary = self._engine.dashboard_summary()
        summary.pop("state")
        return summary


class PushChannelSensor(SensorEntity):
    """The cards on the phones now, and the ones Push holds back."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_icon = "mdi:cellphone-message"
    _attr_translation_key = "push_channel"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, engine: Engine, info: Any) -> None:
        """Set up the sensor."""
        self._engine = engine
        self._attr_unique_id = f"{UNIQUE_ID_CHANNEL_PREFIX}{CHANNEL_PUSH}"
        self._attr_device_info = info
        self.entity_id = "sensor.nc_channel_push"

    async def async_added_to_hass(self) -> None:
        """Follow the engine and the phones."""
        self.async_on_remove(self._engine.async_add_listener(self._changed, late=True))
        if self._engine.devices is not None:
            self.async_on_remove(self._engine.devices.add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        if (context := self._engine.summary_context) is not None:
            self.async_set_context(context)
        self.async_write_ha_state()

    def _summary(self) -> dict[str, Any]:
        summary = self._engine.dashboard_summary(CHANNEL_PUSH)
        if self._engine.devices is not None:
            summary.update(self._engine.devices.summary(CHANNEL_PUSH))
        return summary

    @property
    def native_value(self) -> int:
        """Return the number of cards on the phones."""
        return int(self._summary()["state"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return when each person got a push, and the cards held back."""
        summary = self._summary()
        summary.pop("state")
        return summary


_DEVICE_ICONS = {
    "light": "mdi:lightbulb-outline",
    "speaker": "mdi:speaker",
    "siren": "mdi:alarm-light-outline",
}


class DeviceChannelSensor(SensorEntity):
    """The cards a light, speaker or siren sends now."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self, engine: Engine, key: str, item: dict[str, Any], info: Any
    ) -> None:
        """Set up the sensor of a device channel."""
        self._engine = engine
        self.key = key
        kind = key.split(":", 1)[0]
        entity_id = str(item["entity_id"])
        object_id = entity_id.split(".", 1)[-1]
        self._attr_unique_id = f"{UNIQUE_ID_CHANNEL_PREFIX}{key}"
        self._attr_device_info = info
        self._attr_icon = _DEVICE_ICONS.get(kind)
        self._attr_name = f"{kind.capitalize()} channel {object_id.replace('_', ' ')}"
        self.entity_id = f"sensor.nc_channel_{kind}_{object_id}"

    async def async_added_to_hass(self) -> None:
        """Follow the engine and the device."""
        self.async_on_remove(self._engine.async_add_listener(self._changed, late=True))
        if self._engine.devices is not None:
            self.async_on_remove(self._engine.devices.add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        if (context := self._engine.summary_context) is not None:
            self.async_set_context(context)
        self.async_write_ha_state()

    def _summary(self) -> dict[str, Any]:
        summary = self._engine.dashboard_summary(self.key)
        if self._engine.devices is not None:
            summary.update(self._engine.devices.summary(self.key))
        return summary

    @property
    def native_value(self) -> int:
        """Return the number of cards the device sends."""
        return int(self._summary()["state"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return what the device does, and the cards it holds back."""
        summary = self._summary()
        summary.pop("state")
        return summary
