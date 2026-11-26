"""Tests for the engine: listed entities and the entities of a notification."""

from __future__ import annotations

from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from .common import DOOR_GROUP, Center, load, step, tick


async def test_listed_entities(center: Center) -> None:
    """Each listed entity gets its own card, closed when it stops matching."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.set("binary_sensor.back", "on", device_class="door")
    await center.set("binary_sensor.motion", "on", device_class="motion")
    await center.add(
        "Doors",
        step(
            "{Entity} is open",
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
            done_when={"activation_conditions_no_longer_true": True},
        ),
        entity_groups=[DOOR_GROUP],
    )
    # An entity that already matches gets a card right away.
    assert center.state("sensor.nc_doors") == "active"
    assert center.attrs("sensor.nc_doors")["entities"] == ["binary_sensor.back"]

    await center.set("binary_sensor.front", "on", device_class="door")
    attrs = center.attrs("sensor.nc_doors")
    assert attrs["active_count"] == 2
    assert sorted(attrs["entities"]) == ["binary_sensor.back", "binary_sensor.front"]
    assert center.state("sensor.notification_center") == "2"

    await center.set("binary_sensor.back", "off", device_class="door")
    assert center.attrs("sensor.nc_doors")["entities"] == ["binary_sensor.front"]
    assert center.events[-1][0] == "done"
    assert center.events[-1][1]["entity"] == "binary_sensor.back"
    assert center.events[-1][1]["source"] == "entity"


async def test_listed_entities_dismiss_waits(center: Center) -> None:
    """A dismissed listed card comes back only after the entity stops matching."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
        ),
        entity_groups=[DOOR_GROUP],
    )
    assert center.state("sensor.nc_doors") == "active"
    await center.call("clear", "sensor.nc_doors", entity="binary_sensor.front")
    assert center.state("sensor.nc_doors") == "idle"

    # A change that keeps it matching does not bring the card back.
    await center.set("binary_sensor.front", "on", device_class="door", other=1)
    assert center.state("sensor.nc_doors") == "idle"

    await center.set("binary_sensor.front", "off", device_class="door")
    await center.set("binary_sensor.front", "on", device_class="door")
    assert center.state("sensor.nc_doors") == "active"


async def test_listed_entities_for(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """With ``for``, the card opens when the entity matched long enough."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_state",
                        "to": "on",
                        "for": {"minutes": 5},
                    }
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    await tick(hass, freezer, timedelta(minutes=4))
    assert center.state("sensor.nc_doors") == "idle"
    await tick(hass, freezer, timedelta(minutes=2))
    assert center.state("sensor.nc_doors") == "active"


async def test_entities_numeric_state(center: Center) -> None:
    """A limit can be an entity, and the value can come from a template."""
    await center.set("input_number.limit", "20")
    await center.set("sensor.tank", "50")
    await center.add(
        "Tank",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_numeric_state",
                        "below": "input_number.limit",
                        "value_template": "{{ state.state | float * 2 }}",
                    }
                ],
            },
        ),
        entities=[{"entity_id": "sensor.tank"}],
    )
    # 15 * 2 = 30 is not below 20.
    await center.set("sensor.tank", "15")
    assert center.state("sensor.nc_tank") == "idle"
    # The limit rises: 30 is below 40 now.
    await center.set("input_number.limit", "40")
    assert center.state("sensor.nc_tank") == "active"


async def test_entities_of_another_notification(center: Center) -> None:
    """A step can watch the entities another notification lists."""
    await center.set("binary_sensor.leak", "off")
    leaks = await center.add(
        "Leaks", step(), entities=[{"entity_id": "binary_sensor.leak"}]
    )
    await center.add(
        "Main valve",
        step(
            "Close the main valve",
            activation={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_state",
                        "notification": leaks,
                        "to": "on",
                    }
                ],
            },
        ),
    )
    await center.set("binary_sensor.leak", "on")
    assert center.state("sensor.nc_main_valve") == "active"


async def test_entities_for_template(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """The ``for`` time can be a template."""
    await center.set("binary_sensor.front", "off", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {
                        "trigger": "notification_center.entities_state",
                        "to": "on",
                        "for": "{{ '00:05:00' }}",
                    }
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    await tick(hass, freezer, timedelta(minutes=4))
    assert center.state("sensor.nc_doors") == "idle"
    await tick(hass, freezer, timedelta(minutes=2))
    assert center.state("sensor.nc_doors") == "active"


async def test_done_when_closes_only_its_entity(center: Center) -> None:
    """A Done when trigger about one listed entity closes only its card."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.set("binary_sensor.back", "on", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
            done_when={
                "triggers": [
                    {
                        "trigger": "state",
                        "entity_id": ["binary_sensor.front", "binary_sensor.back"],
                        "attribute": "locked",
                        "to": True,
                    }
                ]
            },
        ),
        entity_groups=[DOOR_GROUP],
    )
    assert center.attrs("sensor.nc_doors")["active_count"] == 2
    await center.set("binary_sensor.front", "on", device_class="door", locked=True)
    assert center.attrs("sensor.nc_doors")["entities"] == ["binary_sensor.back"]


async def test_listed_card_closes_after_restart(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An entity that stopped matching while stopped closes its card (idle)."""
    center = await load(hass, config_entry)
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
            done_when={"activation_conditions_no_longer_true": True},
        ),
        entity_groups=[DOOR_GROUP],
    )
    assert center.state("sensor.nc_doors") == "active"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    hass.states.async_set("binary_sensor.front", "off", {"device_class": "door"})
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert Center(hass, config_entry).state("sensor.nc_doors") == "idle"


async def test_listed_done_stays_done_today(center: Center) -> None:
    """A listed card marked done stays done when its entity stops matching."""
    await center.set("binary_sensor.front", "on", device_class="door")
    await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
        ),
        entity_groups=[DOOR_GROUP],
    )
    await center.call("done", "sensor.nc_doors")
    await center.set("binary_sensor.front", "on", device_class="door", other=1)
    assert center.state("sensor.nc_doors") == "done"
    await center.set("binary_sensor.front", "off", device_class="door")
    assert center.state("sensor.nc_doors") == "done"
    await center.set("binary_sensor.front", "on", device_class="door")
    assert center.state("sensor.nc_doors") == "active"


async def test_switched_on_again_entities_match(
    hass: HomeAssistant, center: Center
) -> None:
    """On again, an entity that still matches gets its card back."""
    await center.set("binary_sensor.front", "off", device_class="door")
    nid = await center.add(
        "Doors",
        step(
            activation={
                "type": "triggers",
                "triggers": [
                    {"trigger": "notification_center.entities_state", "to": "on"}
                ],
            },
        ),
        entities=[{"entity_id": "binary_sensor.front"}],
    )
    await center.set("binary_sensor.front", "on", device_class="door")
    assert center.state("sensor.nc_doors") == "active"
    await center.manager.async_set_enabled(nid, False)
    await hass.async_block_till_done()
    await center.manager.async_set_enabled(nid, True)
    await hass.async_block_till_done()
    assert center.state("sensor.nc_doors") == "active"


def _low_battery(**extra: object) -> dict[str, object]:
    return step(
        activation={
            "type": "triggers",
            "triggers": [
                {
                    "trigger": "notification_center.entities_numeric_state",
                    "below": 20,
                    **extra,
                }
            ],
        },
        done_when={"activation_conditions_no_longer_true": True},
    )


async def test_numeric_unavailable_keeps_card(center: Center) -> None:
    """An unavailable value is no change: the card stays and does not reopen."""
    await center.set("sensor.battery", "50")
    await center.add(
        "Battery", _low_battery(), entities=[{"entity_id": "sensor.battery"}]
    )
    await center.set("sensor.battery", "10")
    assert center.state("sensor.nc_battery") == "active"
    await center.set("sensor.battery", "unavailable")
    assert center.state("sensor.nc_battery") == "active"
    await center.set("sensor.battery", "unknown")
    assert center.state("sensor.nc_battery") == "active"
    # Back with a value above the limit: the card closes as before.
    await center.set("sensor.battery", "60")
    assert center.state("sensor.nc_battery") != "active"


async def test_numeric_unavailable_does_not_start(center: Center) -> None:
    """An entity that is not matching does not start on unavailable."""
    await center.set("sensor.battery", "50")
    await center.add(
        "Battery", _low_battery(), entities=[{"entity_id": "sensor.battery"}]
    )
    await center.set("sensor.battery", "unavailable")
    assert center.state("sensor.nc_battery") == "idle"


async def test_numeric_unavailable_cancels_for(
    hass: HomeAssistant, center: Center, freezer: FrozenDateTimeFactory
) -> None:
    """Unavailable during ``for`` drops the wait: it restarts with a value."""
    await center.set("sensor.battery", "50")
    await center.add(
        "Battery",
        _low_battery(**{"for": {"minutes": 5}}),
        entities=[{"entity_id": "sensor.battery"}],
    )
    await center.set("sensor.battery", "10")
    await tick(hass, freezer, timedelta(minutes=3))
    await center.set("sensor.battery", "unavailable")
    await tick(hass, freezer, timedelta(minutes=10))
    assert center.state("sensor.nc_battery") == "idle"
    await center.set("sensor.battery", "10")
    await tick(hass, freezer, timedelta(minutes=4))
    assert center.state("sensor.nc_battery") == "idle"
    await tick(hass, freezer, timedelta(minutes=2))
    assert center.state("sensor.nc_battery") == "active"
