"""Text of a card: the message and the info line.

A text is a Home Assistant template. It can also hold short placeholders
that come from the card's entity: ``{Floor}``, ``{Area}``, ``{Device}``,
``{Device class}``, ``{Entity}`` and ``{State}``. The template is rendered first; the
placeholders are replaced in its result, so they never clash with Jinja.

While a card is open its text follows the changes of the entities the
template reads and of the card's own entity.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import logging
from typing import Any, Final

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import TemplateError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    floor_registry as fr,
    translation,
)
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResultInfo,
    async_track_state_change_event,
    async_track_template_result,
)
from homeassistant.helpers.template import Template, is_template_string

_LOGGER = logging.getLogger(__name__)
# Texts whose error was logged already.
_WARNED: set[str] = set()
_WARNED_MAX = 200

PLACEHOLDERS: Final = ("Floor", "Area", "Device", "Device class", "Entity", "State")


@callback
def device_class_name(hass: HomeAssistant, domain: str, device_class: str) -> str:
    """Return the name Home Assistant shows for a device class ("Moisture").

    From the domain's translations when they are loaded, otherwise made
    from the key itself.
    """
    key = f"component.{domain}.entity_component.{device_class}.name"
    name = translation.async_get_cached_translations(
        hass, hass.config.language, "entity_component", domain
    ).get(key)
    if not name and hass.config.language != "en":
        name = translation.async_get_cached_translations(
            hass, "en", "entity_component", domain
        ).get(key)
    return name or device_class.replace("_", " ").capitalize()


@callback
def entity_placeholders(hass: HomeAssistant, entity_id: str | None) -> dict[str, str]:
    """Return the placeholder values of an entity.

    A value that cannot be found (no device, no area) falls back to the
    next broader one that can, so the text never shows an empty gap.
    """
    if entity_id is None:
        return {}
    state = hass.states.get(entity_id)
    entity_name = state.name if state is not None else entity_id
    values = {
        "Entity": entity_name,
        "State": state.state if state is not None else "",
        "Device class": "",
        "Device": entity_name,
        "Area": "",
        "Floor": "",
    }
    device_class = state.attributes.get("device_class") if state is not None else None
    if isinstance(device_class, str) and device_class:
        values["Device class"] = device_class_name(
            hass, entity_id.split(".", 1)[0], device_class
        )
    entry = er.async_get(hass).async_get(entity_id)
    if entry is None:
        return values
    device = dr.async_get(hass).async_get(entry.device_id) if entry.device_id else None
    if device is not None:
        values["Device"] = device.name_by_user or device.name or entity_name
    area_id = entry.area_id or (device.area_id if device is not None else None)
    area = ar.async_get(hass).async_get_area(area_id) if area_id else None
    if area is not None:
        values["Area"] = area.name
        floor = (
            fr.async_get(hass).async_get_floor(area.floor_id) if area.floor_id else None
        )
        if floor is not None:
            values["Floor"] = floor.name
    return values


def replace_placeholders(text: str, values: Mapping[str, str]) -> str:
    """Replace ``{Name}`` placeholders with their values."""
    for name in PLACEHOLDERS:
        token = "{" + name + "}"
        if token in text:
            text = text.replace(token, values.get(name, ""))
    return text


@callback
def render_text(
    hass: HomeAssistant,
    text: str | None,
    variables: Mapping[str, Any],
    entity_id: str | None,
) -> tuple[str | None, str | None]:
    """Render a text; return it and the error, if the template failed.

    On an error the text is shown without rendering the template, so the
    card still says something.
    """
    if text is None:
        return None, None
    error: str | None = None
    rendered = text
    if is_template_string(text):
        try:
            rendered = str(
                Template(text, hass).async_render(dict(variables), parse_result=False)
            )
        except TemplateError as err:
            error = str(err)
            # Once per text: it is rendered again at every change.
            if text not in _WARNED and len(_WARNED) < _WARNED_MAX:
                _WARNED.add(text)
                _LOGGER.warning("Error rendering %r: %s", text, err)
    return replace_placeholders(rendered, entity_placeholders(hass, entity_id)), error


class TextTracker:
    """Follow the entities a card's texts depend on, and report changes."""

    def __init__(
        self,
        hass: HomeAssistant,
        texts: list[str],
        variables: Mapping[str, Any],
        entity_id: str | None,
        on_change: Callable[[], None],
    ) -> None:
        """Set up the tracker; call ``async_start`` to begin."""
        self._hass = hass
        self._texts = [text for text in texts if is_template_string(text)]
        self._variables = dict(variables)
        self._entity_id = entity_id
        self._on_change = on_change
        self._template_info: TrackTemplateResultInfo | None = None
        self._unsub_entity: CALLBACK_TYPE | None = None

    @callback
    def async_start(self) -> None:
        """Start following changes."""
        if self._texts:
            self._template_info = async_track_template_result(
                self._hass,
                [
                    TrackTemplate(Template(text, self._hass), self._variables)
                    for text in self._texts
                ],
                self._template_changed,
            )
            self._template_info.async_refresh()
        if self._entity_id is not None:
            self._unsub_entity = async_track_state_change_event(
                self._hass, [self._entity_id], self._entity_changed
            )

    @callback
    def async_stop(self) -> None:
        """Stop following changes."""
        if self._template_info is not None:
            self._template_info.async_remove()
            self._template_info = None
        if self._unsub_entity is not None:
            self._unsub_entity()
            self._unsub_entity = None

    @callback
    def _template_changed(self, *_: Any) -> None:
        self._on_change()

    @callback
    def _entity_changed(self, *_: Any) -> None:
        self._on_change()
