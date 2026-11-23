"""Repairs: problems of the notifications, listed in Settings → Repairs.

Each problem names the notification and links to the panel. It goes away by
itself as soon as the problem does:

- an entity a trigger, condition or the Entities list uses does not exist;
- the entity that holds N of a schedule has no number (the schedule stops,
  as with N = 0);
- the message or the info line has a template error;
- a trigger or condition could not be set up;
- the notify action of a person's push device does not exist.
"""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING, Any, Final

from homeassistant.const import EVENT_SERVICE_REGISTERED, EVENT_SERVICE_REMOVED
from homeassistant.core import CALLBACK_TYPE, Event, callback
from homeassistant.helpers import entity_registry as er, issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN, PANEL_URL_PATH
from .schedule import every_entity, is_valid_every

if TYPE_CHECKING:
    from .engine import Engine

ISSUE_MISSING_ENTITY: Final = "missing_entity"
ISSUE_INVALID_EVERY: Final = "invalid_every"
ISSUE_TEMPLATE_ERROR: Final = "template_error"
ISSUE_SETUP_ERROR: Final = "setup_error"
ISSUE_MISSING_PUSH: Final = "missing_push_service"

_CHECK_INTERVAL: Final = timedelta(minutes=15)
_LINK: Final = f"/{PANEL_URL_PATH}"

type Issue = tuple[str, dict[str, str]]


class IssueTracker:
    """Keep the Repairs list in step with the notifications."""

    def __init__(self, engine: Engine) -> None:
        """Set up the tracker; call ``async_start`` after the start."""
        self._engine = engine
        self._hass = engine.hass
        self._active: dict[str, Issue] = {}
        self._started = False
        self._unsubs: list[CALLBACK_TYPE] = []

    @callback
    def async_start(self) -> None:
        """Check now, after entity registry changes and every 15 minutes."""
        self._started = True
        self._unsubs.append(
            self._hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_updated
            )
        )
        self._unsubs.append(
            async_track_time_interval(self._hass, self._interval, _CHECK_INTERVAL)
        )
        for event_type in (EVENT_SERVICE_REGISTERED, EVENT_SERVICE_REMOVED):
            self._unsubs.append(
                self._hass.bus.async_listen(
                    event_type, self._service_changed, event_filter=_is_notify
                )
            )
        self.refresh()

    @callback
    def async_stop(self) -> None:
        """Stop checking and remove the issues."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self._started = False
        for issue_id in list(self._active):
            ir.async_delete_issue(self._hass, DOMAIN, issue_id)
        self._active.clear()

    @callback
    def _registry_updated(self, _event: Event[Any]) -> None:
        self.refresh()

    @callback
    def _service_changed(self, _event: Event[Any]) -> None:
        self.refresh()

    @callback
    def _interval(self, _now: Any) -> None:
        self.refresh()

    @property
    def active(self) -> dict[str, Issue]:
        """Return the open issues by id."""
        return dict(self._active)

    @callback
    def refresh(self) -> None:
        """Work out the problems again and update the Repairs list."""
        if not self._started:
            return
        wanted = self._problems()
        for issue_id in set(self._active) - set(wanted):
            ir.async_delete_issue(self._hass, DOMAIN, issue_id)
            del self._active[issue_id]
        for issue_id, issue in wanted.items():
            if self._active.get(issue_id) == issue:
                continue
            key, placeholders = issue
            ir.async_create_issue(
                self._hass,
                DOMAIN,
                issue_id,
                is_fixable=False,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key=key,
                translation_placeholders=placeholders,
                learn_more_url=_LINK,
            )
            self._active[issue_id] = issue

    def _exists(self, entity_id: str) -> bool:
        return (
            self._hass.states.get(entity_id) is not None
            or er.async_get(self._hass).async_get(entity_id) is not None
        )

    def _problems(self) -> dict[str, Issue]:
        engine = self._engine
        problems: dict[str, Issue] = {}
        for runner in engine.runners.values():
            name = runner.name
            used: set[str] = set(runner.entities.explicit)
            for number, step in enumerate(runner.steps.values(), start=1):
                used |= step.referenced
                step_text = str(engine.step_number(runner.id, step.step_id) or number)
                if step.errors:
                    problems[f"{ISSUE_SETUP_ERROR}_{runner.id}_{step.step_id}"] = (
                        ISSUE_SETUP_ERROR,
                        {
                            "name": name,
                            "step": step_text,
                            "error": "; ".join(step.errors),
                        },
                    )
                if (
                    step.schedule is not None
                    and (every := every_entity(step.schedule.config)) is not None
                ):
                    used.add(every)
                    if self._exists(every) and not is_valid_every(
                        self._hass, step.schedule.config
                    ):
                        problems[
                            f"{ISSUE_INVALID_EVERY}_{runner.id}_{step.step_id}"
                        ] = (
                            ISSUE_INVALID_EVERY,
                            {"name": name, "step": step_text, "entity": every},
                        )
            missing = sorted(entity for entity in used if not self._exists(entity))
            if missing:
                problems[f"{ISSUE_MISSING_ENTITY}_{runner.id}"] = (
                    ISSUE_MISSING_ENTITY,
                    {"name": name, "entities": ", ".join(missing)},
                )
        for (notification_id, step_id), error in engine.template_errors.items():
            owner = engine.runners.get(notification_id)
            if owner is None:
                continue
            problems[f"{ISSUE_TEMPLATE_ERROR}_{notification_id}_{step_id}"] = (
                ISSUE_TEMPLATE_ERROR,
                {
                    "name": owner.name,
                    "step": str(engine.step_number(notification_id, step_id) or ""),
                    "error": error,
                },
            )
        for person in engine.manager.config.get("people", []):
            service = person.get("notify")
            if not service:
                continue
            domain, _, name = str(service).partition(".")
            if not name:
                domain, name = "notify", domain
            if self._hass.services.has_service(domain, name):
                continue
            state = self._hass.states.get(person["person"])
            if state is None:
                continue
            problems[f"{ISSUE_MISSING_PUSH}_{person['person']}"] = (
                ISSUE_MISSING_PUSH,
                {"name": state.name, "service": str(service)},
            )
        return problems


@callback
def _is_notify(event_data: Any) -> bool:
    return bool(event_data.get("domain") == "notify")
