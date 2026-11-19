"""Conditions for automations: Notification state and Notification entities.

The engine checks these conditions itself inside notifications. This
platform offers them to Home Assistant automations and scripts too. In an
automation, the notification is given by its sensor (``sensor.nc_...``) and
the step by its number.
"""

from __future__ import annotations

from typing import Any, ClassVar, Unpack, cast, override

from homeassistant.const import CONF_OPTIONS
from homeassistant.core import HomeAssistant
from homeassistant.helpers.automation import move_top_level_schema_fields_to_options
from homeassistant.helpers.condition import (
    Condition,
    ConditionCheckParams,
    ConditionConfig,
    condition_trace_set_result,
)
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.typing import ConfigType
import voluptuous as vol

from .engine import async_get_engine
from .listed import EntityList, matching_entities
from .model import ENTITIES_NUMERIC_FIELDS, ENTITIES_STATE_FIELDS, NOTIFICATION_STATES

NOTIFICATION_STATE_OPTIONS: dict[vol.Marker, Any] = {
    vol.Required("notification"): cv.string,
    vol.Optional("step"): vol.Any(vol.All(vol.Coerce(int), vol.Range(min=1)), str),
    vol.Required("state"): vol.In(NOTIFICATION_STATES),
    vol.Optional("for"): cv.positive_time_period,
    # True if the state was reached within this time.
    vol.Optional("within"): cv.positive_time_period,
}

ENTITIES_STATE_OPTIONS: dict[vol.Marker, Any] = {
    vol.Required("notification"): cv.string,
    **ENTITIES_STATE_FIELDS,
}

ENTITIES_NUMERIC_OPTIONS: dict[vol.Marker, Any] = {
    vol.Required("notification"): cv.string,
    **ENTITIES_NUMERIC_FIELDS,
}


class _OptionsCondition(Condition):
    """A condition whose fields are all options."""

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

    def __init__(self, hass: HomeAssistant, config: ConditionConfig) -> None:
        """Keep the options."""
        super().__init__(hass, config)
        self._options = dict(config.options or {})


class NotificationStateCondition(_OptionsCondition):
    """True if a notification (or one of its steps) is in a state."""

    OPTIONS = NOTIFICATION_STATE_OPTIONS

    @override
    def _async_check(self, **kwargs: Unpack[ConditionCheckParams]) -> bool:
        engine = async_get_engine(self._hass)
        if engine is None:
            condition_trace_set_result(False, message="not loaded")
            return False
        return engine.check_notification_state(self._options)


class EntitiesStateCondition(_OptionsCondition):
    """True if any entity listed in a notification is in a state."""

    OPTIONS = ENTITIES_STATE_OPTIONS

    @override
    def _async_check(self, **kwargs: Unpack[ConditionCheckParams]) -> bool:
        engine = async_get_engine(self._hass)
        if engine is None:
            condition_trace_set_result(False, message="not loaded")
            return False
        reference: str = self._options["notification"]
        notification_id = engine.resolve_notification(reference)
        notification = (
            engine.notification_config(notification_id) if notification_id else None
        )
        if notification is None:
            condition_trace_set_result(False, message=f"no notification {reference}")
            return False
        entities = EntityList(self._hass, notification)
        matching = list(matching_entities(self._hass, entities, self._options))
        condition_trace_set_result(bool(matching), entities=matching)
        return bool(matching)


class EntitiesNumericStateCondition(EntitiesStateCondition):
    """True if any entity listed in a notification is above or below a limit."""

    OPTIONS = ENTITIES_NUMERIC_OPTIONS


CONDITIONS: dict[str, type[Condition]] = {
    "notification_state": NotificationStateCondition,
    "entities_state": EntitiesStateCondition,
    "entities_numeric_state": EntitiesNumericStateCondition,
}


async def async_get_conditions(hass: HomeAssistant) -> dict[str, type[Condition]]:
    """Return the conditions of Notification Center."""
    return CONDITIONS
