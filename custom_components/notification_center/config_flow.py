"""Config flow for the Notification Center integration."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, NAME


class NotificationCenterConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up Notification Center with a single confirmation step.

    The integration is single instance (see ``single_config_entry`` in the
    manifest), so Home Assistant aborts a second flow on its own.
    """

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm the setup."""
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title=NAME, data={})
