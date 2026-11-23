"""Push: notifications on the phones of the people, through a notify action.

A person gets push notifications on the phone set on the People page (a
notify action such as ``notify.mobile_app_dora_iphone``) with its device
type: iOS and Android get the buttons, the tap, the priority and the icon;
Other gets only the title and the text.

The Push channel follows the engine like the other device channels (see
``devices.py``), but per person: an active card goes to every person of the
audience in a ticked state who has a phone (``ChannelView.people``). Someone
who arrives home, wakes up or comes into a ticked mode later gets it then.

A push follows its card: it goes away from every phone when the card does
(Done, Dismiss, the end, Snooze, Hide while) and comes again when the card
comes back. A change of the mode or of where people are leaves a sent push as
it is, and so does Silence (it only stops new pushes).

Every push of a notification (one per listed entity) has the same tag on a
phone, so the push of a later step replaces the earlier one. iOS cannot
replace a critical push, so that one is removed first.

A button pressed on the push sends ``mobile_app_notification_action``; the
card changes as if the button was pressed on it, by the person of the user
who pressed it. A button that opens something (More info, Navigate), and the
tap when it runs the card's Tap, open the panel, which presses the button
there and opens the page.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
import logging
from typing import TYPE_CHECKING, Any, Final
from urllib.parse import quote

from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util, slugify

from .const import PANEL_URL_PATH
from .device_base import Device
from .device_colors import color_of, parse_color
from .device_speaker import _token
from .devices import DeviceManager
from .model import (
    CHANNEL_PUSH,
    PUSH_PRIORITY_DEFAULT,
    SYSTEM_COLORS,
    effective_buttons,
)

if TYPE_CHECKING:
    from .cards import Card

_LOGGER = logging.getLogger(__name__)

# The event of a pressed button, sent by the Home Assistant Companion app.
EVENT_NOTIFICATION_ACTION: Final = "mobile_app_notification_action"
# The identifier of a button of a push: ``NC|notification|step|entity|button``.
ACTION_PREFIX: Final = "NC"
ACTION_SEPARATOR: Final = "|"
# The panel presses a button given in this query parameter, then opens the
# page of ``nc_then`` (the tap).
QUERY_PRESS: Final = "nc_press"
QUERY_THEN: Final = "nc_then"

PANEL_PATH: Final = f"/{PANEL_URL_PATH}"
DEFAULT_ICON: Final = "mdi:bell"
DEFAULT_COLOR_HEX: Final = "#03A9F4"
# Android shows at most three buttons.
ANDROID_BUTTONS: Final = 3
# Android's own channel for alarms: it rings at the alarm volume, through
# silent mode and Do Not Disturb.
ANDROID_ALARM_CHANNEL: Final = "alarm_stream"
# The shared Android channels of the priorities other than Normal (a Normal
# push goes to its category's channel).
ANDROID_CHANNELS: Final = {
    "silent": ("Silent", "low"),
    "time_sensitive": ("Time-sensitive", "high"),
}
IOS_LEVELS: Final = {
    "silent": "passive",
    "normal": "active",
    "time_sensitive": "time-sensitive",
    "critical": "critical",
}
TEST_TAG: Final = "nc-test"
TEST_TITLE: Final = "Test notification"
TEST_MESSAGE: Final = "This is a test of the push notification."

DEFAULT_LABELS: Final = {"done": "Done", "dismiss": "Dismiss", "snooze": "Snooze"}


def color_hex(color: str, colors: Sequence[Mapping[str, Any]] | None) -> str:
    """Return a colour (a system colour's name or an own colour's id) as #rrggbb."""
    rgb = SYSTEM_COLORS.get(color)
    if rgb is None:
        for item in colors or []:
            if item.get("id") == color:
                rgb = parse_color(item.get("rgb"))
                break
    if rgb is None:
        rgb = parse_color(color)
    if rgb is None:
        return DEFAULT_COLOR_HEX
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def push_tag(card: Card) -> str:
    """Return the tag of a card's push: one per notification and listed entity."""
    tag = f"nc-{card.notification_id}"
    return f"{tag}-{card.entity_id}" if card.entity_id else tag


def action_id(card: Card, button_id: str) -> str:
    """Return the identifier of a button of a card's push."""
    return ACTION_SEPARATOR.join(
        (
            ACTION_PREFIX,
            card.notification_id,
            card.step_id,
            card.entity_id or "",
            button_id,
        )
    )


def parse_action(action: Any) -> tuple[str, str, str | None, str] | None:
    """Return the card (notification, step, entity) and button of a push button."""
    if not isinstance(action, str):
        return None
    parts = action.split(ACTION_SEPARATOR)
    if len(parts) != 5 or parts[0] != ACTION_PREFIX:
        return None
    _, notification_id, step_id, entity_id, button_id = parts
    return notification_id, step_id, entity_id or None, button_id


def press_url(press: str, then: str | None = None) -> str:
    """Return the panel's address that presses a button, then maybe opens a page."""
    url = f"{PANEL_PATH}?{QUERY_PRESS}={quote(press, safe='')}"
    if then:
        url += f"&{QUERY_THEN}={quote(then, safe='')}"
    return url


def push_body(message: str | None, info: str | None) -> str:
    """Return the text of a push: the message, and the Info on its own line."""
    parts = [part.strip() for part in (message, info) if part and part.strip()]
    return "\n".join(parts) or " "


@dataclass(slots=True)
class Phone:
    """The phone of a person."""

    person: str
    service: str
    device_type: str

    @property
    def domain_service(self) -> tuple[str, str]:
        """Return the notify action as domain and service."""
        domain, _, service = self.service.partition(".")
        return (domain, service) if service else ("notify", domain)


@dataclass(slots=True)
class Content:
    """What a push shows, apart from the card's buttons."""

    title: str
    body: str
    icon: str
    color: str
    priority: str
    group: str
    category_name: str
    url: str


def phones_of(config: Mapping[str, Any]) -> dict[str, Phone]:
    """Return the phone of every person who has one, by person."""
    return {
        item["person"]: Phone(
            item["person"], str(item["notify"]), item.get("device_type", "other")
        )
        for item in config.get("people", [])
        if item.get("notify")
    }


def build_payload(
    phone: Phone,
    content: Content,
    *,
    tag: str,
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return the data of a notify action for a phone."""
    payload: dict[str, Any] = {"title": content.title, "message": content.body}
    if phone.device_type not in ("ios", "android"):
        return payload
    data: dict[str, Any] = {
        "tag": tag,
        "group": content.group,
        "notification_icon": content.icon,
        "color": content.color,
    }
    if actions:
        data["actions"] = (
            actions[:ANDROID_BUTTONS] if phone.device_type == "android" else actions
        )
    priority = content.priority
    if phone.device_type == "ios":
        data["url"] = content.url
        # The icon is white on the colour, as a communication notification.
        data["notification_icon_color"] = "#FFFFFF"
        push: dict[str, Any] = {"interruption-level": IOS_LEVELS[priority]}
        if priority == "critical":
            push["sound"] = {"name": "default", "critical": 1, "volume": 1.0}
        data["push"] = push
    else:
        data["clickAction"] = content.url
        if priority == "critical":
            data["channel"] = ANDROID_ALARM_CHANNEL
            data["ttl"] = 0
            data["priority"] = "high"
            # Not swiped away while the card is active.
            data["persistent"] = True
            data["sticky"] = "true"
        elif priority in ANDROID_CHANNELS:
            name, importance = ANDROID_CHANNELS[priority]
            data["channel"] = name
            data["importance"] = importance
            if priority == "time_sensitive":
                data["ttl"] = 0
                data["priority"] = "high"
        else:
            data["channel"] = content.category_name
    payload["data"] = data
    return payload


class PushDevice(Device):
    """The Push channel: a push per card and person, on their phone."""

    def __init__(
        self,
        manager: DeviceManager,
        key: str,
        settings: dict[str, Any],
        *,
        standalone: bool = False,
    ) -> None:
        """Set up; read what was sent before a restart."""
        super().__init__(manager, key, settings, standalone=standalone)
        saved = manager.saved(CHANNEL_PUSH) or {}
        # Per card (its key joined by "|"): the token of the card's opening,
        # and the people it was sent to with the tag and the time.
        self._sent: dict[str, dict[str, Any]] = dict(saved.get("sent") or {})
        # Per phone and tag: the card whose push is there now.
        self._phones: dict[str, str] = dict(saved.get("phones") or {})
        self._categories: dict[str, str] = {}
        self.last_sent: dict[str, str] = dict(saved.get("last_sent") or {})
        self._unsub: Callable[[], None] | None = manager.hass.bus.async_listen(
            EVENT_NOTIFICATION_ACTION, self._action_pressed
        )
        self._remember_categories(manager.engine.manager.config)

    @property
    def entity_id(self) -> str:
        """Return no entity: the channel has none."""
        return ""

    def stop(self) -> None:
        """Stop following the buttons pressed on the phones."""
        if self._unsub is not None:
            self._unsub()
            self._unsub = None

    def summary(self) -> dict[str, Any]:
        """Return how many cards are on the phones, and when each person got one."""
        result: dict[str, Any] = {"state": len(self._sent)}
        for person, when in sorted(self.last_sent.items()):
            result[f"last_sent_{person.split('.', 1)[-1]}"] = when
        return result

    # -- Following the cards -----------------------------------------------

    def update(self, cards: list[Card]) -> None:
        """Send the cards that start to send; remove the ones that went away."""
        super().update(cards)
        engine = self.manager.engine
        config = engine.manager.config
        phones = phones_of(config)
        changed = False
        for card_key, old in list(self._sent.items()):
            card = engine.cards.get(_split_key(card_key))
            if (
                card is None
                or card.status != "active"
                or _token(card) != old.get("token")
            ):
                self._remove(card_key, old, phones)
                del self._sent[card_key]
                changed = True
        for card in cards:
            view = engine.channel_view(card, CHANNEL_PUSH)
            card_key = _join_key(card.key)
            token = _token(card)
            record: dict[str, Any] | None = self._sent.get(card_key)
            if record is not None and record.get("token") != token:
                record = None
            for person in view.people:
                phone = phones.get(person)
                if phone is None:
                    continue
                if record is not None and person in record["people"]:
                    continue
                if record is None:
                    record = {"token": token, "people": {}}
                    self._sent[card_key] = record
                self._send_card(card, phone)
                now = dt_util.utcnow().isoformat()
                record["people"][person] = {"tag": push_tag(card), "at": now}
                self._phones[_phone_key(person, push_tag(card))] = card_key
                self.last_sent[person] = now
                changed = True
        if changed:
            self._save()
            self.manager.changed()

    def _remove(
        self, card_key: str, record: Mapping[str, Any], phones: Mapping[str, Phone]
    ) -> None:
        """Take a card's push away from the phones it is still on."""
        for person, sent in (record.get("people") or {}).items():
            phone_key = _phone_key(person, sent["tag"])
            if self._phones.get(phone_key) != card_key:
                # A later push with the same tag replaced it.
                continue
            del self._phones[phone_key]
            phone = phones.get(person)
            if phone is not None:
                self._clear(phone, sent["tag"])

    def _save(self) -> None:
        self.manager.save(
            CHANNEL_PUSH,
            {"sent": self._sent, "phones": self._phones, "last_sent": self.last_sent},
        )

    def config_changed(self, config: Mapping[str, Any]) -> None:
        """Remove the Android channel of a renamed category from the phones."""
        old = dict(self._categories)
        self._remember_categories(config)
        renamed = [
            name
            for category_id, name in old.items()
            if self._categories.get(category_id, name) != name
        ]
        if not renamed:
            return
        for phone in phones_of(config).values():
            if phone.device_type != "android":
                continue
            for name in renamed:
                self._notify(
                    phone, {"message": "remove_channel", "data": {"channel": name}}
                )

    def _remember_categories(self, config: Mapping[str, Any]) -> None:
        self._categories = {
            item["id"]: item.get("name", item["id"])
            for item in config.get("categories", [])
        }

    # -- Sending ------------------------------------------------------------

    def _send_card(self, card: Card, phone: Phone) -> None:
        content = self.content_of(card)
        tag = push_tag(card)
        replaced = self._phones.get(_phone_key(phone.person, tag))
        payload = build_payload(phone, content, tag=tag, actions=self.actions_of(card))
        if replaced is not None and phone.device_type == "ios":
            # iOS cannot replace a critical push: take the earlier one away.
            self._clear(phone, tag)
        self._notify(phone, payload)

    def _clear(self, phone: Phone, tag: str) -> None:
        if phone.device_type not in ("ios", "android"):
            return
        self._notify(phone, {"message": "clear_notification", "data": {"tag": tag}})

    def _notify(self, phone: Phone, payload: dict[str, Any]) -> None:
        domain, service = phone.domain_service
        self.hass.async_create_background_task(
            self._call(domain, service, payload),
            f"push {phone.service}",
        )

    def content_of(
        self,
        card: Card | None,
        *,
        notification: Mapping[str, Any] | None = None,
        category: Mapping[str, Any] | None = None,
        settings: Mapping[str, Any] | None = None,
        title: str | None = None,
        message: str | None = None,
        info: str | None = None,
        url: str | None = None,
    ) -> Content:
        """Return what the push of a card (or a test) shows."""
        engine = self.manager.engine
        config = engine.manager.config
        if card is not None:
            notification = engine.notification_config(card.notification_id) or {}
            category = engine.category_of(notification) or {}
            settings = engine.channel_settings_of(card, CHANNEL_PUSH) or {}
            title = notification.get("name")
            message = card.message
            info = card.info
            url = self.tap_url(card)
        notification = notification or {}
        category = category or engine.category_of(notification) or {}
        settings = settings or {}
        icon = notification.get("icon") or category.get("icon") or DEFAULT_ICON
        return Content(
            title=title or TEST_TITLE,
            body=push_body(message, info),
            icon=str(icon),
            color=color_hex(
                color_of(notification, category), config.get("colors") or []
            ),
            priority=settings.get("priority") or PUSH_PRIORITY_DEFAULT,
            group=f"nc-{category.get('id', 'general')}",
            category_name=str(category.get("name") or "Notifications"),
            url=url or self.default_url(),
        )

    def default_url(self) -> str:
        """Return the page the app opens on a tap, as General sets it."""
        general = self.manager.engine.manager.config.get("general") or {}
        return str(general.get("open_on_tap") or PANEL_PATH)

    def _buttons(self, card: Card) -> list[dict[str, Any]]:
        engine = self.manager.engine
        notification = engine.notification_config(card.notification_id) or {}
        category = engine.category_of(notification)
        step: dict[str, Any] = next(
            (
                item
                for item in notification.get("steps", [])
                if item["id"] == card.step_id
            ),
            {},
        )
        return effective_buttons(category, step)

    def tap_url(self, card: Card) -> str:
        """Return what a tap on a card's push opens.

        The Tap's page (or the category's, or General's). When the Tap does
        something, the panel presses it first; a Tap that navigates opens its
        own page.
        """
        tap = next(
            (button for button in self._buttons(card) if button["type"] == "tap"),
            None,
        )
        page = (tap or {}).get("open_on_tap") or self.default_url()
        if tap is None or not tap.get("enabled"):
            return page
        action = tap.get("action") or {"type": "nothing"}
        if action["type"] == "nothing":
            return page
        if action["type"] == "navigate" and action.get("path"):
            return str(action["path"])
        return press_url(action_id(card, tap["id"]), page)

    def actions_of(self, card: Card) -> list[dict[str, Any]]:
        """Return the buttons of a card's push, in the order of the editor."""
        actions: list[dict[str, Any]] = []
        for button in self._buttons(card):
            if (
                button["type"] == "tap"
                or not button.get("enabled", True)
                or not button.get("show_in_push", True)
            ):
                continue
            title = (
                button.get("label") or DEFAULT_LABELS.get(button["type"]) or "Button"
            )
            identifier = action_id(card, button["id"])
            kind = (button.get("action") or {}).get("type")
            if kind in ("navigate", "more_info"):
                # It opens a page: the panel presses it and opens the page.
                actions.append(
                    {"action": "URI", "title": title, "uri": press_url(identifier)}
                )
            else:
                actions.append({"action": identifier, "title": title})
        return actions

    # -- Buttons pressed on a phone ------------------------------------------

    @callback
    def _action_pressed(self, event: Event[Mapping[str, Any]]) -> None:
        parsed = parse_action(event.data.get("action"))
        if parsed is None:
            return
        notification_id, step_id, entity_id, button_id = parsed
        engine = self.manager.engine
        card = engine.cards.get((notification_id, step_id, entity_id or ""))
        if card is None or not card.is_open:
            return
        context = Context(user_id=event.context.user_id, parent_id=event.context.id)
        self.hass.async_create_background_task(
            self._async_press(card, button_id, context), f"push press {button_id}"
        )

    async def _async_press(self, card: Card, button_id: str, context: Context) -> None:
        try:
            await self.manager.engine.async_press(card, button_id, None, context)
        except HomeAssistantError as err:
            _LOGGER.warning("Push button %s: %s", button_id, err)

    # -- Test ---------------------------------------------------------------

    async def async_test(self, data: dict[str, Any]) -> None:
        """Send a test push with the settings being edited.

        ``scope``: ``me`` (the person of the user who asked), ``all`` (every
        person of the audience who has a phone) or ``person`` (the phone in
        ``person``, as the People dialog edits it).
        """
        engine = self.manager.engine
        config = engine.manager.config
        phones = phones_of(config)
        scope = data.get("scope") or "me"
        targets: list[Phone]
        if scope == "person":
            person = data.get("person") or {}
            if not person.get("notify"):
                raise ServiceValidationError("Choose a push device first.")
            targets = [
                Phone(
                    person.get("person", ""),
                    str(person["notify"]),
                    person.get("device_type", "other"),
                )
            ]
        elif scope == "all":
            from .channels import audience_of  # noqa: PLC0415

            category = data.get("category") or {}
            step = data.get("step") or {}
            audience = audience_of(category, step, sorted(engine.person_states))
            targets = [
                phones[person]
                for person, ticks in audience.items()
                if any(ticks.values()) and person in phones
            ]
            if not targets and not engine.person_states:
                targets = list(phones.values())
            if not targets:
                raise ServiceValidationError(
                    "Nobody of the audience has a push device."
                )
        else:
            person = _person_of_user(self.hass, data.get("user_id"))
            if person is None:
                raise ServiceValidationError("Your user is not a person.")
            if person not in phones:
                raise ServiceValidationError(
                    "You have no push device: set it on the People page."
                )
            targets = [phones[person]]
        notification = data.get("notification") or {}
        category = data.get("category") or {}
        content = self.content_of(
            None,
            notification=notification,
            category=category or engine.category_of(notification) or {},
            settings=data.get("settings") or {},
            title=data.get("name") or notification.get("name") or TEST_TITLE,
            message=data.get("message") or TEST_MESSAGE,
            info=data.get("info"),
        )
        for phone in targets:
            domain, service = phone.domain_service
            if not self.hass.services.has_service(domain, service):
                raise ServiceValidationError(f"There is no {phone.service} action.")
            await self.hass.services.async_call(
                domain,
                service,
                build_payload(phone, content, tag=TEST_TAG),
                blocking=True,
            )


def _person_of_user(hass: HomeAssistant, user_id: str | None) -> str | None:
    if not user_id:
        return None
    for state in hass.states.async_all("person"):
        if state.attributes.get("user_id") == user_id:
            return state.entity_id
    return None


def _join_key(key: tuple[str, str, str]) -> str:
    return ACTION_SEPARATOR.join(key)


def _split_key(text: str) -> tuple[str, str, str]:
    notification_id, step_id, entity_id = [*text.split(ACTION_SEPARATOR), "", ""][:3]
    return (notification_id, step_id, entity_id)


def _phone_key(person: str, tag: str) -> str:
    return f"{person}{ACTION_SEPARATOR}{tag}"


def mobile_app_phones(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return the notify actions there are, with the phone's type when known.

    The Companion app's phones first (``notify.mobile_app_<name>``, their type
    from the app), then every other notify action.
    """
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in hass.config_entries.async_entries("mobile_app"):
        name = entry.data.get("device_name") or entry.title
        if not name:
            continue
        service = f"mobile_app_{slugify(str(name))}"
        os_name = str(entry.data.get("os_name") or "").lower()
        manufacturer = str(entry.data.get("manufacturer") or "").lower()
        device_type = (
            "ios"
            if os_name in ("ios", "ipados", "macos") or manufacturer == "apple"
            else "android"
            if os_name == "android" or os_name
            else "other"
        )
        seen.add(service)
        result.append(
            {
                "service": f"notify.{service}",
                "name": str(name),
                "device_type": device_type,
            }
        )
    for service in sorted(hass.services.async_services_for_domain("notify")):
        if service in seen or service in ("send_message", "persistent_notification"):
            continue
        result.append(
            {
                "service": f"notify.{service}",
                "name": service.replace("_", " ").capitalize(),
                "device_type": None,
            }
        )
    return result


__all__ = [
    "EVENT_NOTIFICATION_ACTION",
    "Content",
    "Phone",
    "PushDevice",
    "action_id",
    "build_payload",
    "color_hex",
    "mobile_app_phones",
    "parse_action",
    "press_url",
    "push_body",
    "push_tag",
]
