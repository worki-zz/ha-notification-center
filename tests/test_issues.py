"""Tests for Repairs and diagnostics."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.notification_center.const import DOMAIN
from custom_components.notification_center.diagnostics import (
    async_get_config_entry_diagnostics,
)

from .common import Center, step


def _issues(hass: HomeAssistant) -> dict[str, ir.IssueEntry]:
    registry = ir.async_get(hass)
    return {
        issue_id: issue
        for (domain, issue_id), issue in registry.issues.items()
        if domain == DOMAIN
    }


async def test_missing_entity_issue(hass: HomeAssistant, center: Center) -> None:
    """A missing entity is listed, and the issue goes when it is back."""
    await center.add(
        "Bell",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "state", "entity_id": "binary_sensor.bell", "to": "on"}
                ],
            }
        ),
        entities=[{"entity_id": "lock.front"}],
    )
    issues = _issues(hass)
    assert len(issues) == 1
    issue = next(iter(issues.values()))
    assert issue.translation_key == "missing_entity"
    placeholders = dict(issue.translation_placeholders or {})
    link = placeholders.pop("link")
    assert placeholders == {
        "name": "Bell",
        "entities": "binary_sensor.bell, lock.front",
    }
    assert issue.learn_more_url is not None
    assert issue.learn_more_url.startswith(
        "/notification-center/settings/notifications/"
    )
    # The description ends with the link to the editor.
    assert not issue.is_fixable
    assert link == issue.learn_more_url

    await center.set("binary_sensor.bell", "off")
    await center.set("lock.front", "locked")
    center.engine.issues.refresh()
    assert _issues(hass) == {}


async def test_missing_device_issue(hass: HomeAssistant, center: Center) -> None:
    """A light, speaker or siren without its entity is listed."""
    item = await center.manager.async_create("lights", {"entity_id": "light.gone"})
    center.engine.issues.refresh()
    issues = _issues(hass)
    issue = issues[f"missing_device_{item['id']}"]
    assert issue.translation_placeholders == {
        "kind": "Light",
        "entity": "light.gone",
        "link": "/notification-center/settings/general/light",
    }
    assert issue.learn_more_url == "/notification-center/settings/general/light"

    await center.set("light.gone", "off")
    center.engine.issues.refresh()
    assert _issues(hass) == {}


async def test_template_and_every_issues(hass: HomeAssistant, center: Center) -> None:
    """A template error and an interval entity without a number are listed."""
    await center.set("input_text.interval", "soon")
    await center.add("Broken", step("{{ states('x' }}"))
    await center.add(
        "Filter",
        step(
            activation={
                "type": "schedule",
                "schedule": {
                    "type": "after_last_done",
                    "every": "input_text.interval",
                    "unit": "days",
                },
            }
        ),
    )
    await center.call("trigger", "sensor.nc_broken")
    keys = sorted(issue.translation_key or "" for issue in _issues(hass).values())
    assert keys == ["invalid_every", "template_error"]
    assert center.attrs("sensor.nc_filter")["next_due"] is None

    await center.set("input_text.interval", "2")
    keys = sorted(issue.translation_key or "" for issue in _issues(hass).values())
    assert keys == ["template_error"]
    assert center.attrs("sensor.nc_filter")["next_due"] is not None


async def test_issues_go_with_the_notification(
    hass: HomeAssistant, center: Center
) -> None:
    """Deleting the notification removes its issues."""
    nid = await center.add("Bell", step(), entities=[{"entity_id": "lock.front"}])
    assert len(_issues(hass)) == 1
    await center.manager.async_delete("notifications", nid)
    await hass.async_block_till_done()
    assert _issues(hass) == {}


async def test_diagnostics(
    hass: HomeAssistant, center: Center, config_entry: MockConfigEntry
) -> None:
    """Diagnostics hold the config and the cards, without people."""
    await center.manager.async_update_person(
        {"person": "person.someone", "notify": "notify.phone"}
    )
    await center.add("Plants", step())
    await center.call("trigger", "sensor.nc_plants")
    data = await async_get_config_entry_diagnostics(hass, config_entry)
    assert data["version"] == "0.7.5"
    assert data["config"]["people"] == [
        {"person": "**REDACTED**", "notify": "**REDACTED**", "device_type": "other"}
    ]
    assert [card["status"] for card in data["cards"]] == ["active"]
    assert len(data["steps"]) == 1
