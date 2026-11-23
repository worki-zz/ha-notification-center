"""Fix flow of the Repairs issues: a link to the place that fixes the problem."""

from __future__ import annotations

from typing import cast

from homeassistant.components.repairs import RepairsFlow, RepairsFlowResult
from homeassistant.core import HomeAssistant


class LinkFixFlow(RepairsFlow):
    """Show the link to the editor, the issue goes when the problem does."""

    def __init__(self, data: dict[str, str | int | float | None]) -> None:
        """Keep the link and the texts of the issue."""
        self._placeholders = {key: str(value) for key, value in data.items()}

    async def async_step_init(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        """Ask to go on."""
        return await self.async_step_confirm()

    async def async_step_confirm(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        """Show the link; closing leaves the issue, it goes by itself."""
        if user_input is not None:
            return self.async_abort(reason="fix_it_there")
        return self.async_show_form(
            step_id="confirm", description_placeholders=self._placeholders
        )


async def async_create_fix_flow(
    hass: HomeAssistant,
    issue_id: str,
    data: dict[str, str | int | float | None] | None,
) -> RepairsFlow:
    """Create the fix flow of an issue."""
    return LinkFixFlow(cast("dict[str, str | int | float | None]", data or {}))
