"""Triggers for automations: Notification state and Notification entities.

The engine runs these triggers itself inside notifications. This platform
offers them to Home Assistant automations as well, so they show in the
automation editor. In an automation, the notification is given by its sensor
(``sensor.nc_...``) and the step by its number.
"""

from __future__ import annotations

from typing import Any, ClassVar, cast, override

from homeassistant.const import CONF_OPTIONS
from homeassistant.core import CALLBACK_TYPE, Context, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.automation import move_top_level_schema_fields_to_options
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.trigger import (
    Trigger,
    TriggerActionRunner,
    TriggerConfig,
    TriggerNotTriggeredReporter,
)
from homeassistant.helpers.typing import ConfigType
import voluptuous as vol

from .engine import StateWatch, async_add_state_watch, async_get_engine
from .listed import EntityList, ListedTracker
from .model import ENTITIES_NUMERIC_FIELDS, ENTITIES_STATE_FIELDS, NOTIFICATION_STATES

NOTIFICATION_STATE_OPTIONS: dict[vol.Marker, Any] = {
    vol.Required("notification"): cv.string,
    vol.Optional("step"): vol.Any(vol.All(vol.Coerce(int), vol.Range(min=1)), str),
    vol.Required("state"): vol.In(NOTIFICATION_STATES),
    vol.Optional("for"): cv.positive_time_period,
}

ENTITIES_STATE_OPTIONS: dict[vol.Marker, Any] = {
    vol.Required("notification"): cv.string,
    **ENTITIES_STATE_FIELDS,
}

ENTITIES_NUMERIC_OPTIONS: dict[vol.Marker, Any] = {
    vol.Required("notification"): cv.string,
    **ENTITIES_NUMERIC_FIELDS,
}


class _OptionsTrigger(Trigger):
    """A trigger whose fields are all options."""

    OPTIONS: ClassVar[dict[Any, Any]] = {}
    _options: dict[str, Any]

    @classmethod
    @override
    async def async_validate_complete_config(
        cls, hass: HomeAssistant, complete_config: ConfigType
    ) -> ConfigType:
        """Accept the fields at the top level too, as the engine stores them."""
        complete_config = move_top_level_schema_fields_to_options(
            complete_config, cls.OPTIONS
        )
        return await super().async_validate_complete_config(hass, complete_config)

    @classmethod
    @override
    async def async_validate_config(
        cls, hass: HomeAssistant, config: ConfigType
    ) -> ConfigType:
        """Validate the options."""
        schema = vol.Schema({vol.Required(CONF_OPTIONS): cls.OPTIONS})
        return cast(ConfigType, schema(config))

    def __init__(self, hass: HomeAssistant, config: TriggerConfig) -> None:
        """Keep the options."""
        super().__init__(hass, config)
        self._options = dict(config.options or {})


class NotificationStateTrigger(_OptionsTrigger):
    """Fire when a notification (or one of its steps) reaches a state."""

    OPTIONS = NOTIFICATION_STATE_OPTIONS

    @override
    async def async_attach_runner(
        self,
        run_action: TriggerActionRunner,
        did_not_trigger: TriggerNotTriggeredReporter | None = None,
    ) -> CALLBACK_TYPE:
        """Follow the cards of the notification."""
        options = self._options
        state: str = options["state"]

        @callback
        def action(variables: dict[str, Any], context: Context | None) -> None:
            run_action(variables, f"{variables['notification']} {state}", context)

        return async_add_state_watch(
            self._hass,
            StateWatch(
                notification=options["notification"],
                step=options.get("step"),
                state=state,
                for_=options.get("for"),
                action=action,
            ),
        )


class EntitiesStateTrigger(_OptionsTrigger):
    """Fire when an entity listed in a notification gets a state."""

    OPTIONS = ENTITIES_STATE_OPTIONS

    @override
    async def async_attach_runner(
        self,
        run_action: TriggerActionRunner,
        did_not_trigger: TriggerNotTriggeredReporter | None = None,
    ) -> CALLBACK_TYPE:
        """Follow the entities of the notification."""
        engine = async_get_engine(self._hass)
        if engine is None:
            raise HomeAssistantError("Notification Center is not loaded")
        reference: str = self._options["notification"]
        notification_id = engine.resolve_notification(reference)
        if notification_id is None:
            raise HomeAssistantError(f"No notification {reference}")
        hass = self._hass
        trackers: list[ListedTracker] = []

        @callback
        def matched(entity_id: str, variables: dict[str, Any]) -> None:
            run_action(
                {**variables, "notification": reference},
                f"{entity_id} of {reference}",
            )

        @callback
        def unmatched(_entity_id: str, _context: Context | None) -> None:
            """Do nothing: only matching fires."""

        @callback
        def start(*_: Any) -> None:
            for tracker in trackers:
                tracker.async_stop()
            trackers.clear()
            notification = engine.notification_config(notification_id)
            if notification is None:
                return
            tracker = ListedTracker(
                hass, EntityList(hass, notification), self._options, matched, unmatched
            )
            trackers.append(tracker)
            tracker.async_start(fire_matching=False)

        start()
        # The lists change when the notification is saved.
        unsub_config = engine.manager.async_add_listener(start)

        @callback
        def remove() -> None:
            unsub_config()
            for tracker in trackers:
                tracker.async_stop()
            trackers.clear()

        return remove


class EntitiesNumericStateTrigger(EntitiesStateTrigger):
    """Fire when an entity listed in a notification gets above or below a limit."""

    OPTIONS = ENTITIES_NUMERIC_OPTIONS


TRIGGERS: dict[str, type[Trigger]] = {
    "notification_state": NotificationStateTrigger,
    "entities_state": EntitiesStateTrigger,
    "entities_numeric_state": EntitiesNumericStateTrigger,
}


async def async_get_triggers(hass: HomeAssistant) -> dict[str, type[Trigger]]:
    """Return the triggers of Notification Center."""
    return TRIGGERS
