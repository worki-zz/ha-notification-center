"""Diagnostics: a JSON download for bug reports.

It holds the version, the whole configuration, the cards, the timers and the
next due times, and the open Repairs issues. Push services and people are
redacted, so the file can be attached to a public issue.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

if TYPE_CHECKING:
    from . import NotificationCenterConfigEntry

TO_REDACT = {"notify", "person", "audience", "sleep_entity", "user_id"}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: NotificationCenterConfigEntry
) -> dict[str, Any]:
    """Return the diagnostics of the integration."""
    runtime = entry.runtime_data
    engine = runtime.engine
    steps: dict[str, Any] = {}
    for runner in engine.runners.values():
        for step in runner.steps.values():
            schedule = step.schedule
            steps[f"{runner.id}/{step.step_id}"] = {
                "name": runner.name,
                "number": step.number,
                "next_due": (
                    schedule.next.isoformat()
                    if schedule is not None and schedule.next is not None
                    else None
                ),
                "errors": step.errors,
                "entities": sorted(step.referenced),
            }
    return {
        "version": runtime.version,
        "config": async_redact_data(runtime.manager.config, TO_REDACT),
        "mode": engine.modes.current["id"] if engine.modes.current else None,
        "cards": [
            async_redact_data(card.as_dict(), TO_REDACT)
            for card in engine.cards.values()
        ],
        "history": engine.history,
        "steps": steps,
        "issues": {
            issue_id: {"type": key, **placeholders}
            for issue_id, (key, placeholders) in engine.issues.active.items()
        },
    }
