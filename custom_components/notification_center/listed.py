"""The Listed entities trigger and condition.

A notification lists entities one by one (``entities``) and by group
(``entity_groups``: a domain with an optional device class, areas, floors
and labels).
The Listed entities trigger watches all of them: when one starts to match
(and keeps matching for the ``for`` time, if any) it fires for that entity,
so every entity gets its own card. It also reports when an entity stops
matching, which closes its card if the step asks for it.

Groups are resolved live, so a new matching entity is picked up without
saving the notification again.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from datetime import timedelta
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import (
    CALLBACK_TYPE,
    Context,
    Event,
    HomeAssistant,
    State,
    callback,
    split_entity_id,
)
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.event import (
    EventStateChangedData,
    TrackStates,
    async_call_later,
    async_track_state_change_filtered,
)
from homeassistant.util import dt as dt_util

from .model import TRIGGER_LISTED_ENTITIES

type MatchCallback = Callable[[str, dict[str, Any]], None]
type UnmatchCallback = Callable[[str, Context | None], None]


def _as_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


class ListedMatcher:
    """The state test of a Listed entities trigger or condition."""

    def __init__(self, config: Mapping[str, Any]) -> None:
        """Read the test from a trigger or condition."""
        self.to = _as_list(config.get("to"))
        self.not_to = _as_list(config.get("not_to"))
        self.above = _float(config.get("above"))
        self.below = _float(config.get("below"))
        self.attribute: str | None = config.get("attribute")
        period = config.get("for")
        self.for_: timedelta | None = _period(period)

    def matches(self, state: State | None) -> bool:
        """Return whether a state passes the test."""
        if state is None:
            return False
        value = state.attributes.get(self.attribute) if self.attribute else state.state
        if value is None:
            return False
        text = str(value)
        if self.to is not None and text not in self.to:
            return False
        if self.not_to is not None and text in self.not_to:
            return False
        if self.above is not None or self.below is not None:
            number = _float(value)
            if number is None:
                return False
            if self.above is not None and number <= self.above:
                return False
            if self.below is not None and number >= self.below:
                return False
        if self.to is None and self.not_to is None:
            # Without an explicit state, an entity that has no state does not
            # count, so a restart does not open a card for every entity.
            return text not in (STATE_UNAVAILABLE, STATE_UNKNOWN)
        return True


def _period(value: Any) -> timedelta | None:
    """Return a ``for`` time given as a duration dict or a timedelta."""
    if not value:
        return None
    if isinstance(value, timedelta):
        return value
    period: timedelta = cv.positive_time_period_dict(value)
    return period


def _context(state: State | None) -> Context | None:
    """Return the context of a state change, the cause of what follows."""
    return state.context if state is not None else None


def _float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


class EntityList:
    """The entities a notification lists, with its groups resolved."""

    def __init__(self, hass: HomeAssistant, notification: Mapping[str, Any]) -> None:
        """Read the lists of a notification."""
        self._hass = hass
        self.explicit: list[str] = [
            entity["entity_id"]
            for entity in notification.get("entities", [])
            if entity.get("enabled", True)
        ]
        self.groups: list[Mapping[str, Any]] = [
            group
            for group in notification.get("entity_groups", [])
            if group.get("enabled", True)
        ]

    @property
    def domains(self) -> set[str]:
        """Return the domains of the groups."""
        return {str(group["domain"]) for group in self.groups}

    @callback
    def contains(self, entity_id: str, state: State | None = None) -> bool:
        """Return whether an entity is on the list."""
        if entity_id in self.explicit:
            return True
        if not self.groups:
            return False
        if state is None:
            state = self._hass.states.get(entity_id)
        return any(self._in_group(group, entity_id, state) for group in self.groups)

    @callback
    def groups_of(self, entity_id: str) -> list[Mapping[str, Any]]:
        """Return the groups an entity belongs to."""
        state = self._hass.states.get(entity_id)
        return [
            group for group in self.groups if self._in_group(group, entity_id, state)
        ]

    @callback
    def members(self) -> list[str]:
        """Return every entity on the list now."""
        result = list(self.explicit)
        seen = set(result)
        for domain in sorted(self.domains):
            for state in self._hass.states.async_all(domain):
                if state.entity_id not in seen and self.contains(
                    state.entity_id, state
                ):
                    result.append(state.entity_id)
                    seen.add(state.entity_id)
        return result

    def _in_group(
        self, group: Mapping[str, Any], entity_id: str, state: State | None
    ) -> bool:
        if split_entity_id(entity_id)[0] != group["domain"]:
            return False
        if entity_id in group.get("excluded", []):
            return False
        entry = er.async_get(self._hass).async_get(entity_id)
        if entry is not None and entry.disabled_by is not None:
            return False
        device = (
            dr.async_get(self._hass).async_get(entry.device_id)
            if entry is not None and entry.device_id
            else None
        )
        if group.get("device_class"):
            device_class = state.attributes.get("device_class") if state else None
            if device_class is None and entry is not None:
                device_class = entry.device_class or entry.original_device_class
            if device_class != group["device_class"]:
                return False
        areas = list(group.get("areas") or [])
        floors = list(group.get("floors") or [])
        if (areas or floors) and not self._in_place(areas, floors, entry, device):
            return False
        if wanted_labels := group.get("labels"):
            labels: set[str] = set(entry.labels) if entry is not None else set()
            if device is not None:
                labels |= set(device.labels)
            if not labels.intersection(wanted_labels):
                return False
        if not group.get("add_new", True) and group.get("members") is not None:
            return entity_id in group["members"]
        return True

    def _in_place(
        self,
        areas: list[str],
        floors: list[str],
        entry: er.RegistryEntry | None,
        device: dr.BaseDeviceEntry | None,
    ) -> bool:
        """Return whether an entity is in one of the areas or floors."""
        area_id = (entry.area_id if entry is not None else None) or (
            device.area_id if device is not None else None
        )
        if area_id is None:
            return False
        area = ar.async_get(self._hass).async_get_area(area_id)
        if area_id in areas or (
            area is not None
            and area.name.casefold() in {name.casefold() for name in areas}
        ):
            return True
        return (
            area is not None and area.floor_id is not None and area.floor_id in floors
        )


class ListedTracker:
    """Watch the listed entities for one Listed entities trigger."""

    def __init__(
        self,
        hass: HomeAssistant,
        entities: EntityList,
        config: Mapping[str, Any],
        on_match: MatchCallback,
        on_unmatch: UnmatchCallback,
    ) -> None:
        """Set up the tracker; call ``async_start`` to begin."""
        self._hass = hass
        self._entities = entities
        self._config = dict(config)
        self.matcher = ListedMatcher(config)
        self._on_match = on_match
        self._on_unmatch = on_unmatch
        # Entities that match now, whether or not their ``for`` time passed.
        self._matching: set[str] = set()
        self._timers: dict[str, CALLBACK_TYPE] = {}
        self._tracker: Any = None
        self._unsub_registry: list[CALLBACK_TYPE] = []
        # While true, entities that match are noted without firing.
        self._quiet = False

    @callback
    def async_start(self, *, fire_matching: bool = True) -> None:
        """Check every listed entity now and follow their changes.

        With ``fire_matching`` off, the entities that already match do not
        fire, like a Home Assistant state trigger when it is set up.
        """
        self._tracker = async_track_state_change_filtered(
            self._hass,
            TrackStates(False, set(self._entities.explicit), self._entities.domains),
            self._state_changed,
        )
        if self._entities.groups:
            for event_type in (
                er.EVENT_ENTITY_REGISTRY_UPDATED,
                dr.EVENT_DEVICE_REGISTRY_UPDATED,
            ):
                self._unsub_registry.append(
                    self._hass.bus.async_listen(event_type, self._registry_updated)
                )
        self._quiet = not fire_matching
        try:
            self._check_all()
        finally:
            self._quiet = False

    @callback
    def async_stop(self) -> None:
        """Stop following changes and cancel the waiting timers."""
        if self._tracker is not None:
            self._tracker.async_remove()
            self._tracker = None
        for unsub in self._unsub_registry:
            unsub()
        self._unsub_registry.clear()
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()
        self._matching.clear()

    def is_matching(self, entity_id: str) -> bool:
        """Return whether an entity matches now (``for`` not counted)."""
        return entity_id in self._matching

    @callback
    def _check_all(self) -> None:
        members = set(self._entities.members())
        for entity_id in sorted(members):
            self._evaluate(
                entity_id, None, self._hass.states.get(entity_id), initial=True
            )
        for entity_id in sorted(self._matching - members):
            self._stop_matching(entity_id)

    @callback
    def _registry_updated(self, _event: Event[Any]) -> None:
        self._check_all()

    @callback
    def _state_changed(self, event: Event[EventStateChangedData]) -> None:
        entity_id = event.data["entity_id"]
        new_state = event.data["new_state"]
        if not self._entities.contains(entity_id, new_state):
            if entity_id in self._matching:
                self._stop_matching(entity_id, _context(new_state))
            return
        self._evaluate(entity_id, event.data["old_state"], new_state)

    @callback
    def _evaluate(
        self,
        entity_id: str,
        old_state: State | None,
        new_state: State | None,
        *,
        initial: bool = False,
    ) -> None:
        if not self.matcher.matches(new_state):
            if entity_id in self._matching:
                self._stop_matching(entity_id, _context(new_state))
            return
        if entity_id in self._matching:
            return
        self._matching.add(entity_id)
        if self._quiet:
            return
        variables = self._variables(entity_id, old_state, new_state)
        if initial:
            variables["initial"] = True
        if self.matcher.for_ is None:
            self._on_match(entity_id, variables)
            return

        @callback
        def fire(_now: Any) -> None:
            self._timers.pop(entity_id, None)
            current = self._hass.states.get(entity_id)
            self._on_match(
                entity_id, {**variables, "to_state": current or variables["to_state"]}
            )

        self._timers[entity_id] = async_call_later(self._hass, self.matcher.for_, fire)

    @callback
    def _stop_matching(self, entity_id: str, context: Context | None = None) -> None:
        self._matching.discard(entity_id)
        if (cancel := self._timers.pop(entity_id, None)) is not None:
            cancel()
        self._on_unmatch(entity_id, context)

    def _variables(
        self, entity_id: str, old_state: State | None, new_state: State | None
    ) -> dict[str, Any]:
        return {
            "platform": TRIGGER_LISTED_ENTITIES,
            "entity_id": entity_id,
            "from_state": old_state,
            "to_state": new_state,
            "for": self.matcher.for_,
            "attribute": self.matcher.attribute,
        }


def matching_entities(
    hass: HomeAssistant, entities: EntityList, config: Mapping[str, Any]
) -> Iterable[str]:
    """Return the listed entities that match a Listed entities condition."""
    matcher = ListedMatcher(config)
    for entity_id in entities.members():
        state = hass.states.get(entity_id)
        if not matcher.matches(state):
            continue
        if (
            matcher.for_ is not None
            and state is not None
            and dt_util.utcnow() - state.last_changed < matcher.for_
        ):
            continue
        yield entity_id


@callback
def group_members(hass: HomeAssistant, group: Mapping[str, Any]) -> list[str]:
    """Return the entities a group matches now, ignoring Add new matching."""
    probe = {**group, "add_new": True, "excluded": [], "enabled": True}
    entities = EntityList(hass, {"entity_groups": [probe]})
    return entities.members()
