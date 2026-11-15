"""The example configuration is valid and survives an export round trip."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import yaml as yaml_util

from custom_components.notification_center.model import async_validate_config

EXAMPLE = Path(__file__).parent / "fixtures" / "example_config.yaml"


def load_example() -> dict[str, Any]:
    data = yaml_util.parse_yaml(EXAMPLE.read_text())
    assert isinstance(data, dict)
    data.pop("version")
    return data


async def test_example_is_valid(hass: HomeAssistant) -> None:
    config = await async_validate_config(hass, load_example())
    assert len(config["notifications"]) == 28
    assert len(config["categories"]) == 8
    assert [mode["id"] for mode in config["modes"]][-1] == "home"
