"""Tests for storage and the websocket API."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import yaml as yaml_util
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    MockHAClientWebSocket,
    WebSocketGenerator,
)

from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.store import BACKUP_KEY, CONFIG_KEY

EXAMPLE = Path(__file__).parent / "fixtures" / "example_config.yaml"


class Client:
    """A websocket client that sends Notification Center commands."""

    def __init__(self, ws: MockHAClientWebSocket) -> None:
        self.ws = ws

    async def call(self, command: str, **data: Any) -> dict[str, Any]:
        await self.ws.send_json_auto_id({"type": f"{DOMAIN}/{command}", **data})
        return await self.ws.receive_json()  # type: ignore[no-any-return]

    async def ok(self, command: str, **data: Any) -> Any:
        response = await self.call(command, **data)
        assert response["success"], response
        return response["result"]

    async def error(self, command: str, **data: Any) -> dict[str, Any]:
        response = await self.call(command, **data)
        assert not response["success"], response
        return response["error"]  # type: ignore[no-any-return]

    async def config(self) -> dict[str, Any]:
        return (await self.ok("config/get"))["config"]  # type: ignore[no-any-return]


@pytest.fixture
async def client(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> Client:
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return Client(await hass_ws_client(hass))


async def _create_notification(client: Client, name: str = "Dishwasher") -> Any:
    return await client.ok(
        "item/create",
        section="notifications",
        data={"name": name, "steps": [{"message": "Unload the dishwasher"}]},
    )


async def test_new_installation_has_default_data(
    hass: HomeAssistant, client: Client, hass_storage: dict[str, Any]
) -> None:
    result = await client.ok("config/get")
    assert result["has_data"] is False
    config = result["config"]
    assert [mode["id"] for mode in config["modes"]] == ["home"]
    assert [category["name"] for category in config["categories"]] == ["General"]
    assert hass_storage[CONFIG_KEY]["data"]["modes"][0]["id"] == "home"


async def test_create_update_delete(
    hass: HomeAssistant, client: Client, hass_storage: dict[str, Any]
) -> None:
    created = await _create_notification(client)
    assert created["id"]
    assert created["steps"][0]["id"]

    updated = await client.ok(
        "item/update",
        section="notifications",
        item_id=created["id"],
        data={**created, "name": "Dishwasher done"},
    )
    assert updated["name"] == "Dishwasher done"
    assert updated["id"] == created["id"]
    stored = hass_storage[CONFIG_KEY]["data"]["notifications"]
    assert stored[0]["name"] == "Dishwasher done"

    await client.ok("item/delete", section="notifications", item_id=created["id"])
    assert (await client.config())["notifications"] == []


async def test_invalid_change_is_refused_and_nothing_changes(
    hass: HomeAssistant, client: Client
) -> None:
    error = await client.error(
        "item/create",
        section="notifications",
        data={"name": "Bad", "category": "missing", "steps": [{"message": "x"}]},
    )
    assert error["code"] == "invalid_config"
    assert "no category 'missing'" in error["message"]
    assert (await client.config())["notifications"] == []


async def test_names_are_unique(hass: HomeAssistant, client: Client) -> None:
    await _create_notification(client)
    error = await client.error(
        "item/create",
        section="notifications",
        data={"name": "dishwasher", "steps": [{"message": "x"}]},
    )
    assert "used twice" in error["message"]


async def test_home_mode_and_used_category_cannot_be_deleted(
    hass: HomeAssistant, client: Client
) -> None:
    error = await client.error("item/delete", section="modes", item_id="home")
    assert "cannot be deleted" in error["message"]
    error = await client.error("item/delete", section="categories", item_id="general")
    assert "cannot be deleted" in error["message"]
    kitchen = await client.ok(
        "item/create", section="categories", data={"name": "Kitchen"}
    )
    await client.ok(
        "item/create",
        section="notifications",
        data={
            "name": "Dishwasher",
            "category": kitchen["id"],
            "steps": [{"message": "Unload the dishwasher"}],
        },
    )
    error = await client.error(
        "item/delete", section="categories", item_id=kitchen["id"]
    )
    assert "Dishwasher" in error["message"]


async def test_new_mode_goes_before_home_and_reorder(
    hass: HomeAssistant, client: Client
) -> None:
    away = await client.ok(
        "item/create",
        section="modes",
        data={
            "name": "Away",
            "condition": {"type": "state", "entity_id": "zone.home", "state": "0"},
        },
    )
    sleep = await client.ok(
        "item/create",
        section="modes",
        data={
            "name": "Sleep",
            "condition": {"type": "toggle", "entity_id": "input_boolean.sleep"},
        },
    )
    modes = [mode["id"] for mode in (await client.config())["modes"]]
    assert modes == [away["id"], sleep["id"], "home"]

    await client.ok(
        "item/reorder", section="modes", item_ids=[sleep["id"], away["id"], "home"]
    )
    modes = [mode["id"] for mode in (await client.config())["modes"]]
    assert modes == [sleep["id"], away["id"], "home"]

    # Home without a condition stays last: it applies when no other mode does.
    await client.ok(
        "item/reorder", section="modes", item_ids=["home", sleep["id"], away["id"]]
    )
    modes = [mode["id"] for mode in (await client.config())["modes"]]
    assert modes == [sleep["id"], away["id"], "home"]

    # With a condition, Home is ordered like any other mode.
    config = await client.config()
    home = next(mode for mode in config["modes"] if mode["id"] == "home")
    home["condition"] = {"type": "toggle", "entity_id": "input_boolean.home"}
    await client.ok("item/update", section="modes", item_id="home", data=home)
    await client.ok(
        "item/reorder", section="modes", item_ids=["home", sleep["id"], away["id"]]
    )
    modes = [mode["id"] for mode in (await client.config())["modes"]]
    assert modes == ["home", sleep["id"], away["id"]]


async def test_deleting_a_mode_removes_it_from_channels(
    hass: HomeAssistant, client: Client
) -> None:
    away = await client.ok(
        "item/create",
        section="modes",
        data={
            "name": "Away",
            "condition": {"type": "state", "entity_id": "zone.home", "state": "0"},
        },
    )
    # A new mode starts with Home's channels.
    channels = (await client.config())["categories"][0]["channels"]
    assert channels["dashboard"]["modes"] == ["home", away["id"]]
    await client.ok("item/delete", section="modes", item_id=away["id"])
    channels = (await client.config())["categories"][0]["channels"]
    assert channels["dashboard"]["modes"] == ["home"]


async def test_duplicate(hass: HomeAssistant, client: Client) -> None:
    original = await _create_notification(client)
    copy = await client.ok("notification/duplicate", notification_id=original["id"])
    assert copy["name"] == "Dishwasher (copy)"
    assert copy["id"] != original["id"]
    assert copy["steps"][0]["id"] != original["steps"][0]["id"]
    again = await client.ok("notification/duplicate", notification_id=original["id"])
    assert again["name"] == "Dishwasher (copy 2)"
    names = [item["name"] for item in (await client.config())["notifications"]]
    assert names == ["Dishwasher", "Dishwasher (copy 2)", "Dishwasher (copy)"]


async def test_set_enabled(hass: HomeAssistant, client: Client) -> None:
    created = await _create_notification(client)
    step_id = created["steps"][0]["id"]
    await client.ok(
        "notification/set_enabled", notification_id=created["id"], enabled=False
    )
    await client.ok(
        "notification/set_enabled",
        notification_id=created["id"],
        step_id=step_id,
        enabled=False,
    )
    notification = (await client.config())["notifications"][0]
    assert notification["enabled"] is False
    assert notification["steps"][0]["enabled"] is False


async def test_people_follow_person_entities(
    hass: HomeAssistant, client: Client
) -> None:
    hass.states.async_set("person.anna", "home", {"friendly_name": "Anna"})
    hass.states.async_set(
        "person.bob", "not_home", {"friendly_name": "Bob", "entity_picture": "/b.png"}
    )
    await client.ok(
        "person/update",
        data={
            "person": "person.bob",
            "push_devices": [{"notify": "notify.bob_phone", "device_type": "ios"}],
        },
    )
    people = (await client.config())["people"]
    assert [person["name"] for person in people] == ["Anna", "Bob"]
    assert people[0]["push_devices"] == []
    [device] = people[1]["push_devices"]
    assert device["notify"] == "notify.bob_phone"
    assert device["device_type"] == "ios"
    assert device["enabled"] is True
    assert device["id"]
    assert people[1]["picture"] == "/b.png"


async def test_general_settings(hass: HomeAssistant, client: Client) -> None:
    await client.ok(
        "general/update",
        data={"read_the_message": {"tts_service": "tts.cloud", "language": "en-US"}},
    )
    general = (await client.config())["general"]
    assert general["read_the_message"]["tts_service"] == "tts.cloud"


async def test_import_export_round_trip(
    hass: HomeAssistant, client: Client, hass_storage: dict[str, Any]
) -> None:
    await client.ok("config/import", yaml=EXAMPLE.read_text())
    result = await client.ok("config/get")
    assert result["has_data"] is True
    assert len(result["config"]["notifications"]) == 28
    # The previous configuration is kept as a backup.
    assert hass_storage[BACKUP_KEY]["data"]["config"]["notifications"] == []

    exported = (await client.ok("config/export"))["yaml"]
    data = yaml_util.parse_yaml(exported)
    assert isinstance(data, dict)
    assert data["version"] == 11
    stored = hass_storage[CONFIG_KEY]["data"]
    assert {key: value for key, value in data.items() if key != "version"} == stored

    # Importing the export gives the same configuration again.
    await client.ok("config/import", yaml=exported)
    assert hass_storage[CONFIG_KEY]["data"] == stored


OLD_BUTTONS = """
- {type: tap, action: {type: navigate, path: /lovelace/0}}
- {type: done, action: {type: more_info, entity_id: light.hall}}
- {type: custom, id: mute, label: Mute, action: {type: entity_action}}
- type: custom
  id: "off"
  label: "Off"
  action: {type: ha_action, actions: [{action: light.turn_off}]}
- {type: custom, id: quiet, label: Quiet, action: {type: silence}}
- {type: custom, id: clips, label: Clips, action: {type: show_attachment}}
"""


async def test_import_of_an_older_export(
    client: Client, hass_storage: dict[str, Any]
) -> None:
    """A version 1 export's one button action becomes the button's actions."""
    data = yaml_util.parse_yaml(EXAMPLE.read_text())
    assert isinstance(data, dict)
    data["version"] = 1
    data["notifications"][0]["steps"][0]["buttons"] = yaml_util.parse_yaml(OLD_BUTTONS)
    await client.ok("config/import", yaml=yaml_util.dump(data))
    step = hass_storage[CONFIG_KEY]["data"]["notifications"][0]["steps"][0]
    actions = {
        button["id"] if button["type"] == "custom" else button["type"]: button.get(
            "actions"
        )
        for button in step["buttons"]
    }
    navigation = {
        button["id"] if button["type"] == "custom" else button["type"]: button.get(
            "navigation"
        )
        for button in step["buttons"]
    }
    assert all("action" not in button for button in step["buttons"])
    assert actions["tap"] == {}
    assert navigation["tap"] == {"type": "navigate", "path": "/lovelace/0"}
    # The built-in Done keeps no own actions; its navigation stays.
    assert actions["done"] is None
    assert navigation["done"] == {"type": "more_info", "entity_id": "light.hall"}
    assert actions["mute"] == {"entity_action": True}
    assert actions["off"] == {"ha_actions": [{"action": "light.turn_off"}]}
    assert actions["quiet"] == {"notification_state": {"type": "mute"}}
    assert actions["clips"] == {}


async def test_import_drops_the_unused_fields(
    client: Client, hass_storage: dict[str, Any]
) -> None:
    """A version 2 export's attachments, confirm and read volume are dropped."""
    data = yaml_util.parse_yaml(EXAMPLE.read_text())
    assert isinstance(data, dict)
    data["version"] = 2
    data["general"]["read_the_message"]["volume"] = 0.5
    step = data["notifications"][0]["steps"][0]
    step["attachments"] = [{"camera": "camera.front_door"}]
    step["buttons"] = [{"type": "custom", "label": "Go", "confirm": True}]
    await client.ok("config/import", yaml=yaml_util.dump(data))
    stored = hass_storage[CONFIG_KEY]["data"]
    assert "volume" not in stored["general"]["read_the_message"]
    saved = stored["notifications"][0]["steps"][0]
    assert "attachments" not in saved
    assert all("confirm" not in button for button in saved["buttons"])


@pytest.mark.parametrize(("version", "kept"), [(6, False), (7, True)])
async def test_import_of_values_equal_to_the_category(
    client: Client, hass_storage: dict[str, Any], version: int, kept: bool
) -> None:
    """Up to version 6 they were stored unasked and follow the category again."""
    data = yaml_util.parse_yaml(EXAMPLE.read_text())
    assert isinstance(data, dict)
    data["version"] = version
    notification = data["notifications"][0]
    category = next(
        item for item in data["categories"] if item["id"] == notification["category"]
    )
    category["buttons"] = [
        button for button in category.get("buttons") or [] if button["type"] != "done"
    ] + [{"id": "done", "type": "done", "enabled": True}]
    notification["steps"][0]["buttons"] = [
        {"id": "done", "type": "done", "enabled": True}
    ]
    await client.ok("config/import", yaml=yaml_util.dump(data))
    saved = hass_storage[CONFIG_KEY]["data"]["notifications"][0]["steps"][0]
    entry = next(button for button in saved["buttons"] if button["type"] == "done")
    assert ("enabled" in entry) is kept


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("not: [valid", "not valid YAML"),
        ("- a list", "must be a mapping"),
        ("version: 12", "unknown export version"),
        ("display: []", "unknown sections: display"),
        ("notifications: [{name: x}]", "steps"),
    ],
)
async def test_bad_import_changes_nothing(
    hass: HomeAssistant, client: Client, text: str, message: str
) -> None:
    before = await client.config()
    error = await client.error("config/import", yaml=text)
    assert message in error["message"]
    assert await client.config() == before


async def test_subscribe_sends_changes(hass: HomeAssistant, client: Client) -> None:
    await client.ws.send_json_auto_id({"type": f"{DOMAIN}/config/subscribe"})
    assert (await client.ws.receive_json())["success"]
    first = await client.ws.receive_json()
    assert first["event"]["config"]["notifications"] == []

    await client.ws.send_json_auto_id(
        {
            "type": f"{DOMAIN}/item/create",
            "section": "notifications",
            "data": {"name": "Test", "steps": [{"message": "x"}]},
        }
    )
    messages = [await client.ws.receive_json(), await client.ws.receive_json()]
    events = [message for message in messages if message["type"] == "event"]
    assert events[0]["event"]["config"]["notifications"][0]["name"] == "Test"


async def test_changes_need_admin(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_access_token: str,
) -> None:
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    client = Client(await hass_ws_client(hass, hass_read_only_access_token))
    assert (await client.config())["modes"]
    error = await client.error("config/export")
    assert error["code"] == "unauthorized"
    error = await client.error(
        "item/create", section="notifications", data={"name": "x", "steps": []}
    )
    assert error["code"] == "unauthorized"


async def test_entity_rename_is_followed(
    hass: HomeAssistant,
    client: Client,
    entity_registry: er.EntityRegistry,
) -> None:
    entry = entity_registry.async_get_or_create(
        "binary_sensor", "test", "door", suggested_object_id="front_door"
    )
    await client.ok(
        "item/create",
        section="notifications",
        data={
            "name": "Door",
            "entities": [{"entity_id": entry.entity_id}],
            "steps": [
                {
                    "message": "Door open",
                    "activation": {
                        "type": "triggers",
                        "triggers": [
                            {
                                "trigger": "state",
                                "entity_id": entry.entity_id,
                                "to": "on",
                            }
                        ],
                    },
                }
            ],
        },
    )
    entity_registry.async_update_entity(
        entry.entity_id, new_entity_id="binary_sensor.entrance_door"
    )
    await hass.async_block_till_done()
    notification = (await client.config())["notifications"][0]
    assert notification["entities"][0]["entity_id"] == "binary_sensor.entrance_door"
    trigger = notification["steps"][0]["activation"]["triggers"][0]
    assert trigger["entity_id"] == "binary_sensor.entrance_door"


async def test_data_survives_a_restart(
    hass: HomeAssistant, client: Client, config_entry: MockConfigEntry
) -> None:
    await _create_notification(client)
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert [item["name"] for item in (await client.config())["notifications"]] == [
        "Dishwasher"
    ]


async def test_not_loaded(
    hass: HomeAssistant, client: Client, config_entry: MockConfigEntry
) -> None:
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()
    error = await client.error("config/get")
    assert error["code"] == "not_loaded"


async def test_export_download(
    hass: HomeAssistant,
    client: Client,
    hass_client: ClientSessionGenerator,
    hass_storage: dict[str, Any],
) -> None:
    """The YAML export downloads as a file from its address."""
    http = await hass_client()
    response = await http.get(f"/api/{DOMAIN}/export")
    assert response.status == 200
    assert "attachment" in response.headers["Content-Disposition"]
    data = yaml_util.parse_yaml(await response.text())
    assert isinstance(data, dict)
    assert data["version"] == 11
    assert data["categories"] == hass_storage[CONFIG_KEY]["data"]["categories"]
