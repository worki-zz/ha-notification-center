"""The engine: it decides when a notification shows and when it goes away.

Every step of a notification has cards. A step has one card, or, with the
Listed entities trigger, one card per entity. A card is:

- **open**: it shows (state ``active``), or it is hidden while the step's
  Conditions are not met (state ``hidden``);
- **snoozed** until a time;
- **closed**: done or dismissed. A done card stays until the end of
  the day, so it can be shown as done today.

The cards and the time each step last reached each state (the last done
time among them) are saved in ``.storage/notification_center.runtime``, so
they survive a restart.
"""

from __future__ import annotations

import calendar
from collections.abc import Callable, Mapping
from datetime import date, datetime, time, timedelta
import logging
from typing import TYPE_CHECKING, Any, Final

from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import (
    CALLBACK_TYPE,
    Context,
    Event,
    EventStateChangedData,
    HomeAssistant,
    State,
    callback,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_time_change,
)
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey

from .cards import (
    PHASE_CLOSED,
    PHASE_OPEN,
    PHASE_SNOOZED,
    Card,
    CardKey,
    Overrides,
    StateWatch,
    custom_data_text,
    parse_iso,
)
from .channels import (
    CHANNEL_DASHBOARD,
    PERSON_AWAY,
    PERSON_HOME,
    PERSON_SLEEP,
    REASON_AUDIENCE,
    REASON_DELAY,
    REASON_MODE,
    REASON_OFF,
    ChannelView,
    audience_of,
    channel_settings,
    channel_view,
    person_state,
)
from .const import (
    CLOSED_DISMISSED,
    CLOSED_DONE,
    DOMAIN,
    EVENT_ACTIVE,
    EVENT_DISMISSED,
    EVENT_DONE,
    EVENT_SNOOZED,
    SOURCE_ACTION,
    SOURCE_ENTITY,
    SOURCE_EXPIRES,
    SOURCE_SNOOZE_END,
    SOURCE_TRIGGER,
    STATE_ACTIVE,
    STATE_SNOOZED,
    UNIQUE_ID_NOTIFICATION_PREFIX,
)
from .engine_actions import EngineActions
from .engine_queries import EngineQueries
from .issues import IssueTracker
from .model import (
    CHANNEL_PUSH,
    GENERAL_CATEGORY_ID,
    TRIGGER_NOTIFICATION_STATE,
    ConfigData,
)
from .modes import ConditionTracker, ModeTracker
from .render import TextTracker, render_text
from .runner import NotificationRunner, StepRunner
from .schedule import step_expiry
from .store import RUNTIME_KEY, ConfigManager

if TYPE_CHECKING:
    from .devices import DeviceManager

_LOGGER = logging.getLogger(__name__)

RUNTIME_VERSION: Final = 1
SAVE_DELAY: Final = 1

# The Notification state triggers, of the engine and of automations. They
# live outside the engine so that an automation keeps its trigger when the
# integration is reloaded.
DATA_WATCHES: HassKey[list[StateWatch]] = HassKey(f"{DOMAIN}_watches")


@callback
def async_get_engine(hass: HomeAssistant) -> Engine | None:
    """Return the engine of the loaded integration."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        return None
    engine: Engine = entries[0].runtime_data.engine
    return engine


# The Notification entities triggers of automations: each one is given the
# engine (or none, while unloaded) whenever it is loaded or its configuration
# changes, so that it follows the lists of the engine that runs now.
type Refresher = Callable[[Engine | None], None]
DATA_REFRESHERS: HassKey[list[Refresher]] = HassKey(f"{DOMAIN}_refreshers")


@callback
def async_add_refresher(hass: HomeAssistant, refresh: Refresher) -> CALLBACK_TYPE:
    """Call ``refresh`` with the engine at each load and configuration change."""
    refreshers = hass.data.setdefault(DATA_REFRESHERS, [])
    refreshers.append(refresh)

    @callback
    def remove() -> None:
        if refresh in refreshers:
            refreshers.remove(refresh)

    return remove


@callback
def async_add_state_watch(hass: HomeAssistant, watch: StateWatch) -> CALLBACK_TYPE:
    """Report a Notification state trigger until the returned call."""
    watches = hass.data.setdefault(DATA_WATCHES, [])
    watches.append(watch)

    @callback
    def remove() -> None:
        watch.cancel_all()
        if watch in watches:
            watches.remove(watch)

    return remove


type ChangeListener = Callable[[], None]
type EventListener = Callable[[str, dict[str, Any]], None]


def _jsonable(value: Any) -> Any:
    """Return a value that can be stored as JSON and used in templates."""
    if isinstance(value, State):
        return {
            "entity_id": value.entity_id,
            "state": value.state,
            "name": value.name,
            "attributes": _jsonable(dict(value.attributes)),
            "last_changed": value.last_changed.isoformat(),
        }
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _add_month(day: date) -> date:
    """Return the same day a month later (or that month's last day)."""
    year, month = (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
    return day.replace(
        year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1])
    )


class Engine(EngineQueries, EngineActions):
    """Hold every card and run the notifications."""

    def __init__(self, hass: HomeAssistant, manager: ConfigManager) -> None:
        """Set up the engine; call ``async_load`` and ``async_start``."""
        self.hass = hass
        self.manager = manager
        self.cards: dict[CardKey, Card] = {}
        # notification id -> step id -> state -> ISO time it was last reached
        self.history: dict[str, dict[str, dict[str, str]]] = {}
        self.runners: dict[str, NotificationRunner] = {}
        self._own_refreshing = False
        self._own_again = False
        self.modes = ModeTracker(hass, manager.config["modes"], self._mode_changed)
        self._store = Store[dict[str, Any]](hass, RUNTIME_VERSION, RUNTIME_KEY)
        self._listeners: list[ChangeListener] = []
        self._late_listeners: list[ChangeListener] = []
        self._event_listeners: list[EventListener] = []
        # For the Activity log every sensor that changes is written in the
        # context of the cause (the entity that started the change, or the
        # action). ``contexts`` is what the notification's sensor writes in;
        # ``summary_context`` is what the other sensors write in during that
        # change.
        self.contexts: dict[str, Context] = {}
        self.summary_context: Context | None = None
        self._watches = hass.data.setdefault(DATA_WATCHES, [])
        self._snooze_timers: dict[CardKey, CALLBACK_TYPE] = {}
        self._expiry_timers: dict[CardKey, CALLBACK_TYPE] = {}
        self.template_errors: dict[tuple[str, str], str] = {}
        self.issues = IssueTracker(self)
        self._text_trackers: dict[CardKey, TextTracker] = {}
        self._unsubs: list[CALLBACK_TYPE] = []
        self._started = False
        self._config = manager.config
        # The end of the next channel delay: the channels change then.
        self._delay_timer: CALLBACK_TYPE | None = None
        self._delay_at: datetime | None = None
        self._person_states: dict[str, str] = {}
        # The lights, speakers and sirens (set by the integration's setup).
        self.devices: DeviceManager | None = None
        self._sleep = ConditionTracker(
            hass, self._sleep_conditions(), self._presence_changed
        )

    # -- Life cycle ---------------------------------------------------------

    async def async_load(self) -> None:
        """Read the saved cards; start the timers that do not need triggers."""
        stored = await self._store.async_load() or {}
        self.history = {
            str(nid): {str(sid): dict(states) for sid, states in steps.items()}
            for nid, steps in (stored.get("history") or {}).items()
        }
        for item in stored.get("cards") or []:
            try:
                card = Card.from_dict(item)
            except KeyError, TypeError, ValueError:
                continue
            if self._step_config(card.notification_id, card.step_id) is None:
                continue
            self.cards[card.key] = card
        self._prune()
        for card in self.cards.values():
            if card.phase == PHASE_SNOOZED:
                self._schedule_unsnooze(card)
        self._unsubs.append(self.manager.async_add_listener(self._config_changed))
        self._refresh_triggers(self)
        self._unsubs.append(
            async_track_time_change(
                self.hass, self._midnight, hour=0, minute=0, second=0
            )
        )
        self._unsubs.append(async_track_time_change(self.hass, self._minute, second=0))
        self._unsubs.append(async_at_started(self.hass, self._async_started))
        self._unsubs.append(
            self.hass.bus.async_listen(
                EVENT_STATE_CHANGED,
                self._presence_changed,
                event_filter=self._is_presence_event,
            )
        )
        self._person_states = self._read_person_states()

    async def _async_started(self, _hass: HomeAssistant) -> None:
        self._started = True
        self.modes.async_start()
        self._sleep.async_start()
        self._person_states = self._read_person_states()
        for notification in self._config["notifications"]:
            await self._async_start_notification(notification)
        now = dt_util.utcnow()
        for card in list(self.cards.values()):
            if card.snoozed_until is not None and card.snoozed_until <= now:
                self._cancel_unsnooze(card)
                self._unsnooze(card)
        for card in list(self.cards.values()):
            if card.is_open:
                self._start_text(card)
        self.issues.async_start()
        self._notify()

    async def _async_start_notification(self, notification: dict[str, Any]) -> None:
        if not notification.get("enabled", True):
            return
        runner = NotificationRunner(self, notification)
        self.runners[runner.id] = runner
        await runner.async_start()
        if self.runners.get(runner.id) is not runner:
            runner.async_stop()
            return
        for step in runner.steps.values():
            for card in self.cards_of(runner.id, step.step_id):
                if card.phase == PHASE_OPEN:
                    self.set_hidden(card, step.is_hidden(card))
                if card.is_open:
                    self._schedule_expiry(card)
        runner.start_trackers()
        self.issues.refresh()
        self._notify()

    async def async_unload(self) -> None:
        """Stop everything and save the cards."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self.issues.async_stop()
        self._refresh_triggers(None)
        for runner in self.runners.values():
            runner.async_stop()
        self.runners.clear()
        self.modes.async_stop()
        self._sleep.async_stop()
        if self._delay_timer is not None:
            self._delay_timer()
            self._delay_timer = None
        for timers in (self._snooze_timers, self._expiry_timers):
            for cancel in timers.values():
                cancel()
            timers.clear()
        for tracker in self._text_trackers.values():
            tracker.async_stop()
        self._text_trackers.clear()
        await self._store.async_save(self._data_to_save())

    @callback
    def _refresh_triggers(self, engine: Engine | None) -> None:
        refreshers = self.hass.data.setdefault(DATA_REFRESHERS, [])
        for refresh in list(refreshers):
            refresh(engine)

    @callback
    def _config_changed(self, config: ConfigData) -> None:
        old = {item["id"]: item for item in self._config["notifications"]}
        self._config = config
        self._refresh_triggers(self)
        sleep = self._sleep_conditions()
        if sleep != self._sleep.conditions:
            self._sleep.async_stop()
            self._sleep = ConditionTracker(self.hass, sleep, self._presence_changed)
            if self._started:
                self._sleep.async_start()
        self._person_states = self._read_person_states()
        if config["modes"] != self.modes.modes:
            self.modes.async_stop()
            self.modes = ModeTracker(self.hass, config["modes"], self._mode_changed)
            if self._started:
                self.modes.async_start()
        new = {item["id"]: item for item in config["notifications"]}
        changed = {nid for nid in set(old) | set(new) if new.get(nid) != old.get(nid)}
        for nid in list(self.runners):
            # A notification watching another one's entities follows its list.
            if nid in changed or self.runners[nid].references & changed:
                self.runners.pop(nid).async_stop()
        for card in list(self.cards.values()):
            notification = new.get(card.notification_id)
            step = self._step_config(card.notification_id, card.step_id)
            if (
                notification is None
                or not notification.get("enabled", True)
                or step is None
                or not step.get("enabled", True)
            ):
                self.forget(card)
            elif self._started and card.is_open and card.notification_id in changed:
                # The texts (message, Info, Data) follow the edited step.
                self._start_text(card)
        if self._started:
            for nid, notification in new.items():
                if nid not in self.runners:
                    self.hass.async_create_task(
                        self._async_start_notification(notification),
                        eager_start=True,
                    )
        self.issues.refresh()
        self._save()
        self._notify()

    # -- Listeners ----------------------------------------------------------

    @callback
    def async_add_listener(
        self, listener: ChangeListener, *, late: bool = False
    ) -> CALLBACK_TYPE:
        """Call the listener after every change of a card or the mode.

        A late listener is called after the others: the summary sensor is
        caused by the sensor of the notification, so it changes after it.
        """
        listeners = self._late_listeners if late else self._listeners
        listeners.append(listener)

        @callback
        def remove() -> None:
            listeners.remove(listener)

        return remove

    @callback
    def async_add_event_listener(self, listener: EventListener) -> CALLBACK_TYPE:
        """Call the listener with every event (active, done, ...)."""
        self._event_listeners.append(listener)

        @callback
        def remove() -> None:
            self._event_listeners.remove(listener)

        return remove

    @callback
    def _notify(self) -> None:
        self._schedule_delay_timer()
        for listener in [*self._listeners, *self._late_listeners]:
            listener()

    # -- Channels -----------------------------------------------------------

    def _sleep_conditions(self) -> dict[str, dict[str, Any]]:
        return {
            person["person"]: person["sleep"]
            for person in self._config.get("people", [])
            if person.get("sleep")
        }

    def _read_person_states(self) -> dict[str, str]:
        return {
            state.entity_id: person_state(
                self.hass, state.entity_id, self._sleep.is_true(state.entity_id)
            )
            for state in self.hass.states.async_all("person")
        }

    @callback
    def _is_presence_event(self, event_data: EventStateChangedData) -> bool:
        return event_data["entity_id"].startswith("person.")

    @callback
    def _presence_changed(
        self, _event: Event[EventStateChangedData] | None = None
    ) -> None:
        states = self._read_person_states()
        if states != self._person_states:
            self._person_states = states
            self._notify()

    @property
    def person_states(self) -> dict[str, str]:
        """Return whether each person is at home, asleep or away."""
        return dict(self._person_states)

    def channel_view(self, card: Card, key: str = CHANNEL_DASHBOARD) -> ChannelView:
        """Return whether a channel sends an active card now, and to whom."""
        notification = self.notification_config(card.notification_id) or {}
        step = self._step_config(card.notification_id, card.step_id)
        category = self._category_of(notification)
        states = self._person_states
        if card.only_people is not None and key not in (
            CHANNEL_DASHBOARD,
            CHANNEL_PUSH,
        ):
            # A test for one person: the devices are not used.
            return ChannelView(reason=REASON_OFF)
        audience = audience_of(category, step, sorted(states))
        if card.only_people is not None:
            audience = {
                person: {PERSON_HOME: True, PERSON_SLEEP: True, PERSON_AWAY: True}
                for person in card.only_people
            }
        return channel_view(
            channel_settings(category, step, key),
            mode_id=self.modes.current["id"] if self.modes.current else None,
            active_since=card.active_since or card.state_since,
            now=dt_util.utcnow(),
            audience=audience,
            states=states,
        )

    def _category_of(self, notification: Mapping[str, Any]) -> dict[str, Any] | None:
        categories = self._config["categories"]
        return next(
            (item for item in categories if item["id"] == notification.get("category")),
            next(
                (item for item in categories if item["id"] == GENERAL_CATEGORY_ID), None
            ),
        )

    @property
    def started(self) -> bool:
        """Return whether Home Assistant started and the notifications run."""
        return self._started

    def category_of(self, notification: Mapping[str, Any]) -> dict[str, Any] | None:
        """Return a notification's category (General when it has none)."""
        return self._category_of(notification)

    def channel_settings_of(self, card: Card, key: str) -> dict[str, Any] | None:
        """Return a channel's settings for a card's step (None: off)."""
        notification = self.notification_config(card.notification_id) or {}
        step = self._step_config(card.notification_id, card.step_id)
        return channel_settings(self._category_of(notification), step, key)

    def dashboard_summary(self, key: str = CHANNEL_DASHBOARD) -> dict[str, Any]:
        """Return what a channel sends now: its diagnostic sensor.

        Shown: the active cards the channel sends (the Dashboard: for at
        least one person); a device leaves out the muted cards and
        counts them as ``muted``.
        ``upcoming``: the active cards it holds back (shown under Upcoming),
        then the same by what they wait for: each mode they are ticked in
        (a card ticked in two modes counts in both), the delay, the
        audience. ``off``: cards with no mode ticked, never shown.
        """
        modes = [mode["id"] for mode in self._config.get("modes", [])]
        shown = upcoming = off = delay = audience = muted = 0
        by_mode = dict.fromkeys(modes, 0)
        for notification in self._config["notifications"]:
            if not notification.get("enabled", True):
                continue
            for card in self._visible_cards(notification["id"]):
                if card.status != STATE_ACTIVE:
                    continue
                view = self.channel_view(card, key)
                if view.sends:
                    if key != CHANNEL_DASHBOARD and card.muted:
                        muted += 1
                    else:
                        shown += 1
                    continue
                if view.reason == REASON_OFF:
                    off += 1
                    continue
                upcoming += 1
                if view.reason == REASON_DELAY:
                    delay += 1
                elif view.reason == REASON_AUDIENCE:
                    audience += 1
                elif view.reason == REASON_MODE:
                    settings = self.channel_settings_of(card, key) or {}
                    for mode_id in settings.get("modes") or []:
                        if mode_id in by_mode:
                            by_mode[mode_id] += 1
        return {
            "state": shown,
            "upcoming": upcoming,
            **{
                f"upcoming_waiting_for_{mode_id}_mode": count
                for mode_id, count in by_mode.items()
            },
            "upcoming_waiting_for_delay": delay,
            "upcoming_waiting_for_audience": audience,
            "off": off,
            **({} if key == CHANNEL_DASHBOARD else {"muted": muted}),
        }

    def _channel_keys(self, card: Card) -> set[str]:
        """Return the channels a card's category or step sets."""
        notification = self.notification_config(card.notification_id) or {}
        step = self._step_config(card.notification_id, card.step_id) or {}
        category = self._category_of(notification) or {}
        return set(category.get("channels") or {}) | set(step.get("channels") or {})

    @callback
    def _schedule_delay_timer(self) -> None:
        """Wake up when the next channel delay ends."""
        now = dt_util.utcnow()
        soonest: datetime | None = None
        for card in self.cards.values():
            if card.status != STATE_ACTIVE:
                continue
            for key in self._channel_keys(card):
                until = self.channel_view(card, key).until
                if (
                    until is not None
                    and until > now
                    and (soonest is None or until < soonest)
                ):
                    soonest = until
        if soonest == self._delay_at:
            return
        if self._delay_timer is not None:
            self._delay_timer()
            self._delay_timer = None
        self._delay_at = soonest
        if soonest is None:
            return

        @callback
        def fire(_now: datetime) -> None:
            self._delay_timer = None
            self._delay_at = None
            self._notify()

        self._delay_timer = async_track_point_in_utc_time(self.hass, fire, soonest)

    @callback
    def _mode_changed(self) -> None:
        self._notify()

    def add_watch(self, watch: StateWatch) -> None:
        """Start reporting a Notification state trigger."""
        self._watches.append(watch)

    def remove_watch(self, watch: StateWatch) -> None:
        """Stop reporting a Notification state trigger."""
        watch.cancel_all()
        if watch in self._watches:
            self._watches.remove(watch)

    # -- Config lookups -----------------------------------------------------

    def notification_config(self, notification_id: str) -> dict[str, Any] | None:
        """Return the configuration of a notification."""
        for item in self._config["notifications"]:
            if item["id"] == notification_id:
                return dict(item)
        return None

    def _step_config(self, notification_id: str, step_id: str) -> dict[str, Any] | None:
        notification = self.notification_config(notification_id)
        if notification is None:
            return None
        for step in notification["steps"]:
            if step["id"] == step_id:
                return dict(step)
        return None

    def step_number(self, notification_id: str, step_id: str) -> int | None:
        """Return the number of a step (1 is the first)."""
        notification = self.notification_config(notification_id)
        if notification is None:
            return None
        for number, step in enumerate(notification["steps"], start=1):
            if step["id"] == step_id:
                return number
        return None

    def step_id_of(self, notification_id: str, number: int) -> str:
        """Return the id of a step by its number, or raise an error."""
        notification = self.notification_config(notification_id)
        if notification is None:
            raise ServiceValidationError(f"No notification {notification_id}")
        steps = notification["steps"]
        if not 1 <= number <= len(steps):
            raise ServiceValidationError(
                f"{notification['name']} has {len(steps)} step(s), not {number}"
            )
        return str(steps[number - 1]["id"])

    def entity_id_of(self, notification_id: str) -> str | None:
        """Return the entity id of a notification's sensor."""
        return er.async_get(self.hass).async_get_entity_id(
            "sensor", DOMAIN, UNIQUE_ID_NOTIFICATION_PREFIX + notification_id
        )

    def resolve_notification(self, reference: str) -> str | None:
        """Return a notification id from an id or its sensor's entity id."""
        if self.notification_config(reference) is not None:
            return reference
        entry = er.async_get(self.hass).async_get(reference)
        if (
            entry is not None
            and entry.platform == DOMAIN
            and entry.unique_id.startswith(UNIQUE_ID_NOTIFICATION_PREFIX)
        ):
            return entry.unique_id.removeprefix(UNIQUE_ID_NOTIFICATION_PREFIX)
        return None

    # -- Cards --------------------------------------------------------------

    def cards_of(self, notification_id: str, step_id: str | None = None) -> list[Card]:
        """Return the cards of a notification or of one of its steps."""
        return [
            card
            for card in self.cards.values()
            if card.notification_id == notification_id
            and (step_id is None or card.step_id == step_id)
        ]

    def variables(self, card: Card) -> dict[str, Any]:
        """Return the template variables of a card."""
        notification = self.notification_config(card.notification_id) or {}
        return {
            "entity": card.entity_id,
            "trigger": card.trigger or {},
            "data": card.data,
            "notification": {
                "id": card.notification_id,
                "name": notification.get("name"),
                "entity_id": self.entity_id_of(card.notification_id),
            },
        }

    @callback
    def open(
        self,
        step: StepRunner,
        entity_id: str | None,
        trigger: dict[str, Any] | None,
        source: str,
        overrides: Overrides | None = None,
        context: Context | None = None,
        *,
        since: datetime | None = None,
    ) -> Card | None:
        """Open a card of a step, or refresh it if it is already open.

        ``since`` is when it became active (a scheduled card: when it was
        due); the Expires rows of the step count from it. A refreshed card
        keeps its expiry, unless ``since`` is given again.

        Snooze wins: a snoozed card that is triggered again or has a new
        scheduled occurrence is only refreshed (content, trigger data); it
        stays snoozed and keeps its expiry. Only the trigger action (Run
        now) wakes it.
        """
        now = dt_util.utcnow()
        key = (step.notification.id, step.step_id, entity_id or "")
        card = self.cards.get(key)
        trigger_data = _jsonable(trigger) if trigger else None
        if card is not None and card.is_open:
            self._refresh(card, trigger_data, overrides)
            snoozed = card.phase == PHASE_SNOOZED
            if snoozed and source != SOURCE_ACTION:
                self._render(card)
                self._save()
                self._notify()
                return card
            if since is not None:
                self._set_expiry(card, step, since)
                self._schedule_expiry(card)
            if snoozed:
                self._cancel_unsnooze(card)
                self._change(
                    card,
                    source=source,
                    context=context,
                    phase=PHASE_OPEN,
                    snoozed_until=None,
                    hidden=step.is_hidden(card),
                )
            else:
                self._render(card)
                self._save()
                self._notify()
            return card
        if card is not None and card.blocked and source == SOURCE_ENTITY:
            return None
        if card is not None:
            # No state change in between: the new card follows at once.
            self.forget(card, notify=False)
        card = Card(
            notification_id=step.notification.id,
            step_id=step.step_id,
            entity_id=entity_id,
            phase=PHASE_CLOSED,
            since=since or now,
            state_since=now,
            source=source,
            closed_reason=CLOSED_DISMISSED,
            trigger=trigger_data,
        )
        self._set_expiry(card, step, card.since)
        self._refresh(card, trigger_data, overrides)
        self.cards[card.key] = card
        self._render(card)
        self._change(
            card,
            source=source,
            context=context,
            phase=PHASE_OPEN,
            closed_reason=None,
            hidden=step.is_hidden(card),
        )
        self._start_text(card)
        self._schedule_expiry(card)
        return card

    @staticmethod
    def _set_expiry(card: Card, step: StepRunner, since: datetime) -> None:
        expiry = step_expiry(step.step, since)
        card.expires_at = expiry[0] if expiry else None
        card.expires_as = expiry[1] if expiry else CLOSED_DISMISSED

    def _refresh(
        self,
        card: Card,
        trigger: dict[str, Any] | None,
        overrides: Overrides | None,
    ) -> None:
        if trigger is not None:
            card.trigger = trigger
        if overrides is None:
            return
        card.only_people = overrides.only_people
        if overrides.message is not None:
            card.message_override = overrides.message
        if overrides.info is not None:
            card.info_override = overrides.info
        if overrides.data is not None:
            card.data = overrides.data

    @callback
    def close(
        self,
        card: Card,
        reason: str,
        source: str,
        context: Context | None = None,
        *,
        transient: bool = False,
    ) -> None:
        """Close a card: done or dismissed.

        A transient card goes at once instead of staying as done today.
        """
        if not card.is_open:
            return
        card.transient = transient
        self._cancel_unsnooze(card)
        self._cancel_expiry(card)
        self._stop_text(card)
        runner = self.runners.get(card.notification_id)
        step = runner.steps.get(card.step_id) if runner else None
        blocked = (
            card.entity_id is not None
            and step is not None
            and step.has_listed_start
            and step.start_matching(card.entity_id)
        )
        self._change(
            card,
            source=source,
            context=context,
            phase=PHASE_CLOSED,
            closed_reason=reason,
            closed_at=dt_util.utcnow(),
            snoozed_until=None,
            hidden=False,
            blocked=blocked,
        )
        if transient or (reason != CLOSED_DONE and not card.blocked):
            self.cards.pop(card.key, None)
            self._save()
            self._notify()

    @callback
    def snooze(
        self,
        card: Card,
        until: datetime,
        source: str,
        context: Context | None = None,
    ) -> None:
        """Snooze a card until a time."""
        if not card.is_open:
            return
        self._cancel_unsnooze(card)
        self._change(
            card,
            source=source,
            context=context,
            phase=PHASE_SNOOZED,
            snoozed_until=dt_util.as_utc(until),
        )
        self._schedule_unsnooze(card)

    @callback
    def set_hidden(self, card: Card, hidden: bool) -> None:
        """Hide or show an open card."""
        if card.phase == PHASE_OPEN and card.hidden != hidden:
            self._change(card, source=SOURCE_TRIGGER, hidden=hidden)

    @callback
    def forget(self, card: Card, *, notify: bool = True) -> None:
        """Remove a card without any event (its notification changed)."""
        self._cancel_unsnooze(card)
        self._cancel_expiry(card)
        self._stop_text(card)
        for watch in self._watches:
            if (cancel := watch.timers.pop(card.key, None)) is not None:
                cancel()
        if self.cards.get(card.key) is card:
            del self.cards[card.key]
        self._save()
        if notify:
            self._notify()

    @callback
    def forget_block(self, card: Card) -> None:
        """Let a listed entity's card open again: the entity stopped matching."""
        if card.blocked:
            card.blocked = False
            if card.closed_reason != CLOSED_DONE:
                self.forget(card)
            else:
                self._save()

    def snooze_tomorrow(self, card: Card) -> datetime:
        """Return when a card snoozed until "Tomorrow" comes back."""
        return self.snooze_choice(card, "tomorrow")

    def snooze_choice(self, card: Card, choice: str) -> datetime:
        """Return when a card snoozed with one of the Snooze button's times comes back.

        Minutes and hours count from now. The days come back on that day, at
        the time the card first came for a scheduled step, otherwise at
        General's "Tomorrow" time, so an evening reminder does not return
        at night.
        """
        now = dt_util.now()
        if choice.endswith("m") and not choice.endswith("mo"):
            return dt_util.as_utc(now + timedelta(minutes=int(choice[:-1])))
        if choice.endswith("h"):
            return dt_util.as_utc(now + timedelta(hours=int(choice[:-1])))
        days = {"tomorrow": 1, "2d": 2, "3d": 3, "1w": 7, "2w": 14}
        if choice == "1mo":
            day = _add_month(now.date())
        else:
            day = now.date() + timedelta(days=days.get(choice, 1))
        step = self._step_config(card.notification_id, card.step_id) or {}
        if step.get("activation", {}).get("type") == "schedule":
            at = dt_util.as_local(card.since).time()
        else:
            at = dt_util.parse_time(
                self._config["general"].get("snooze_tomorrow_at", "08:00")
            ) or time(8)
        return dt_util.as_utc(
            datetime.combine(day, at, tzinfo=dt_util.get_default_time_zone())
        )

    def set_last_done(self, notification_id: str, step_id: str, when: datetime) -> None:
        """Set when a step was last done."""
        self._record(notification_id, step_id, CLOSED_DONE, when)
        self._done_recorded(notification_id, step_id)
        self._save()
        self._notify()

    def _done_recorded(self, notification_id: str, step_id: str) -> None:
        """Work out an after-last-done schedule again."""
        runner = self.runners.get(notification_id)
        step = runner.steps.get(step_id) if runner else None
        if (
            step is not None
            and step.schedule is not None
            and not step.schedule.is_calendar
        ):
            step.schedule.reschedule()

    def record(
        self, notification_id: str, step_id: str, state: str, when: datetime
    ) -> None:
        """Remember when a step reached a state (or was due)."""
        self._record(notification_id, step_id, state, when)
        self._save()

    @callback
    def schedule_changed(self) -> None:
        """Tell the listeners that a next due time changed."""
        self.issues.refresh()
        self._notify()

    def last_reached(
        self, notification_id: str, step_id: str | None, state: str
    ) -> datetime | None:
        """Return when a step (or any step) last reached a state."""
        steps = self.history.get(notification_id, {})
        times = [
            parsed
            for sid, states in steps.items()
            if step_id is None or sid == step_id
            if (parsed := parse_iso(states.get(state))) is not None
        ]
        return max(times) if times else None

    # -- Changing a card ----------------------------------------------------

    def _change(
        self,
        card: Card,
        *,
        source: str,
        context: Context | None = None,
        **changes: Any,
    ) -> None:
        old = card.status
        opened = changes.get("phase") == PHASE_OPEN and card.phase != PHASE_OPEN
        for name, value in changes.items():
            setattr(card, name, value)
        if opened:
            card.active_since = dt_util.utcnow()
            # Mute lasts until the card goes away (Snooze ends, a new card).
            if "muted" not in changes:
                card.muted = False
        new = card.status
        changed = new != old
        previous = self.summary_context
        if changed:
            now = dt_util.utcnow()
            card.state_since = now
            self._record(card.notification_id, card.step_id, new, now)
            if new == CLOSED_DONE:
                self._done_recorded(card.notification_id, card.step_id)
            # The notification's sensor is written in the context behind the
            # change (the entity's state change, the action call), so that
            # the Activity log's "What happened" finds that cause: the log
            # looks a cause up by the context's id, not by its parent. A
            # time driven change (a schedule, an expiry, the end of a
            # snooze) has none, the sensor just changes by itself. The
            # summary sensor and the event follow in the same context.
            cause = context or Context()
            self.contexts[card.notification_id] = cause
            self.summary_context = cause
            self._state_reached(card, old, new)
            self._refresh_own_conditions()
        self._save()
        try:
            self._notify()
            if changed:
                self._fire_event(card, new, source, context)
        finally:
            self.summary_context = previous

    def _record(
        self, notification_id: str, step_id: str, state: str, when: datetime
    ) -> None:
        self.history.setdefault(notification_id, {}).setdefault(step_id, {})[state] = (
            dt_util.as_utc(when).isoformat()
        )

    def _state_reached(self, card: Card, old: str, new: str) -> None:
        for watch in list(self._watches):
            if not watch.applies_to(self, card):
                continue
            if (
                old == watch.state
                and (cancel := watch.timers.pop(card.key, None)) is not None
            ):
                cancel()
            if new != watch.state:
                continue
            variables = {
                "platform": TRIGGER_NOTIFICATION_STATE,
                "notification": self.entity_id_of(card.notification_id),
                "step": self.step_number(card.notification_id, card.step_id),
                "entity_id": card.entity_id,
                "from_state": old,
                "to_state": new,
            }
            # The cause is the state of the notification's sensor.
            cause = self.contexts.get(card.notification_id)
            if watch.for_ is None:
                watch.action(variables, cause)
                continue
            watch.timers[card.key] = async_track_point_in_utc_time(
                self.hass,
                self._watch_timer(watch, card, variables, cause),
                dt_util.utcnow() + watch.for_,
            )

    def _watch_timer(
        self,
        watch: StateWatch,
        card: Card,
        variables: dict[str, Any],
        cause: Context | None,
    ) -> Callable[[datetime], None]:
        @callback
        def fire(_now: datetime) -> None:
            watch.timers.pop(card.key, None)
            # A dismissed card is gone at once: it still counts
            # unless a newer card took its place.
            if self.cards.get(card.key) in (None, card) and (
                card.status == watch.state
            ):
                watch.action(variables, cause)

        return fire

    def _fire_event(
        self, card: Card, state: str, source: str, context: Context | None
    ) -> None:
        event_type = {
            STATE_ACTIVE: EVENT_ACTIVE,
            STATE_SNOOZED: EVENT_SNOOZED,
            CLOSED_DONE: EVENT_DONE,
            CLOSED_DISMISSED: EVENT_DISMISSED,
        }.get(state)
        if event_type is None:
            return
        data = {
            "notification": self.entity_id_of(card.notification_id),
            "step": self.step_number(card.notification_id, card.step_id),
            "entity": card.entity_id,
            "source": source,
            "person": self.person_of(context),
            "message": card.message,
        }
        for listener in list(self._event_listeners):
            listener(event_type, data)

    def person_of(self, context: Context | None) -> str | None:
        """Return the person entity of the user behind a context."""
        if context is None or context.user_id is None:
            return None
        for state in self.hass.states.async_all("person"):
            if state.attributes.get("user_id") == context.user_id:
                return state.entity_id
        return None

    # -- Text ---------------------------------------------------------------

    def _render(self, card: Card) -> bool:
        step = self._step_config(card.notification_id, card.step_id)
        if step is None:
            return False
        variables = self.variables(card)
        message, message_error = render_text(
            self.hass,
            card.message_override or step["message"],
            variables,
            card.entity_id,
        )
        info, info_error = render_text(
            self.hass, card.info_override or step.get("info"), variables, card.entity_id
        )
        data_text, data_error = render_text(
            self.hass, custom_data_text(step), variables, card.entity_id
        )
        error = message_error or info_error or data_error
        key = (card.notification_id, card.step_id)
        if error != self.template_errors.get(key):
            if error is None:
                self.template_errors.pop(key, None)
            else:
                self.template_errors[key] = error
            self.issues.refresh()
        changed = (message, info, data_text) != (
            card.message,
            card.info,
            card.data_text,
        )
        card.message, card.info, card.data_text = message, info, data_text
        return changed

    def _start_text(self, card: Card) -> None:
        self._stop_text(card)
        step = self._step_config(card.notification_id, card.step_id)
        if step is None:
            return
        texts = [
            text
            for text in (
                card.message_override or step["message"],
                card.info_override or step.get("info"),
                custom_data_text(step),
            )
            if text
        ]
        entity_id = card.entity_id or (card.trigger or {}).get("entity_id")

        @callback
        def changed() -> None:
            if self.cards.get(card.key) is card and self._render(card):
                self._save()
                self._notify()

        tracker = TextTracker(
            self.hass,
            texts,
            self.variables(card),
            entity_id if isinstance(entity_id, str) else None,
            changed,
        )
        self._text_trackers[card.key] = tracker
        tracker.async_start()
        if self._render(card):
            self._save()
            self._notify()

    def _stop_text(self, card: Card) -> None:
        if (tracker := self._text_trackers.pop(card.key, None)) is not None:
            tracker.async_stop()

    # -- Timers -------------------------------------------------------------

    def _schedule_unsnooze(self, card: Card) -> None:
        if card.snoozed_until is None:
            return

        @callback
        def wake(_now: datetime) -> None:
            self._snooze_timers.pop(card.key, None)
            # Before Home Assistant started, ``_async_started`` wakes the cards
            # whose time has passed.
            if self._started:
                self._unsnooze(card)

        self._snooze_timers[card.key] = async_track_point_in_utc_time(
            self.hass, wake, card.snoozed_until
        )

    def _unsnooze(self, card: Card) -> None:
        if self.cards.get(card.key) is not card or card.phase != PHASE_SNOOZED:
            return
        runner = self.runners.get(card.notification_id)
        step = runner.steps.get(card.step_id) if runner else None
        self._change(
            card,
            source=SOURCE_SNOOZE_END,
            phase=PHASE_OPEN,
            snoozed_until=None,
            hidden=step.is_hidden(card) if step else False,
        )
        self._start_text(card)

    def _schedule_expiry(self, card: Card) -> None:
        self._cancel_expiry(card)
        if card.expires_at is None or not self._started:
            return

        @callback
        def expire(_now: datetime) -> None:
            self._expiry_timers.pop(card.key, None)
            if self.cards.get(card.key) is card and card.is_open:
                self.close(card, card.expires_as, SOURCE_EXPIRES)

        self._expiry_timers[card.key] = async_track_point_in_utc_time(
            self.hass, expire, card.expires_at
        )

    def _cancel_expiry(self, card: Card) -> None:
        if (cancel := self._expiry_timers.pop(card.key, None)) is not None:
            cancel()

    def _cancel_unsnooze(self, card: Card) -> None:
        if (cancel := self._snooze_timers.pop(card.key, None)) is not None:
            cancel()

    @callback
    def _midnight(self, _now: datetime) -> None:
        self._prune()
        # A Notification state condition on Done or Dismissed counts the
        # day's cards only: check those conditions again on the new day.
        self._refresh_own_conditions()
        self._save()
        self._notify()

    @callback
    def _minute(self, _now: datetime) -> None:
        """Check the time-dependent Conditions again."""
        for runner in self.runners.values():
            for step in runner.steps.values():
                if step.hide_timed:
                    step.refresh_hidden()

    def _refresh_own_conditions(self) -> None:
        """Check Conditions on notification states again: a card changed."""
        if self._own_refreshing:
            self._own_again = True
            return
        self._own_refreshing = True
        try:
            for _ in range(10):
                self._own_again = False
                for runner in list(self.runners.values()):
                    for step in list(runner.steps.values()):
                        if step.watches_own:
                            step.refresh_hidden()
                if not self._own_again:
                    break
        finally:
            self._own_refreshing = False

    def _prune(self) -> None:
        """Forget the cards closed before today (except blocking ones)."""
        start = dt_util.start_of_local_day()
        for card in list(self.cards.values()):
            if (
                not card.is_open
                and not card.blocked
                and (card.closed_at is None or card.closed_at < start)
            ):
                del self.cards[card.key]

    # -- Storage ------------------------------------------------------------

    def _save(self) -> None:
        self._store.async_delay_save(self._data_to_save, SAVE_DELAY)

    def _data_to_save(self) -> dict[str, Any]:
        return {
            "cards": [card.as_dict() for card in self.cards.values()],
            "history": self.history,
        }
