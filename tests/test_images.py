"""The Image of a step: a still taken at activation, in the details and the push."""

from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path
import time
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
import pytest
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.notification_center.images import IMAGE_URL

from .common import Center, step
from .test_push import _setup

GET_IMAGE = "custom_components.notification_center.images._async_get_image"


@pytest.fixture
def camera() -> Iterator[AsyncMock]:
    """Give a camera that returns a JPEG."""
    still = SimpleNamespace(content_type="image/jpeg", content=b"\xff\xd8still")
    with patch(GET_IMAGE, AsyncMock(return_value=still)) as mock:
        yield mock


def _image(push: bool = True) -> dict[str, Any]:
    return {"entity_id": "camera.front_door", "push": push}


def _card(center: Center) -> Any:
    return next(iter(center.engine.cards.values()))


async def test_still_taken_and_pushed(
    hass: HomeAssistant, center: Center, camera: AsyncMock
) -> None:
    """The still is taken at activation; the push waits for it and carries it."""
    android, ios = await _setup(center, hass)
    await center.add("Doorbell", step("Someone is at the door", image=_image()))
    await center.call("trigger", "sensor.nc_doorbell")
    await hass.async_block_till_done()

    card = _card(center)
    assert card.image is not None
    assert not card.image_pending
    camera.assert_awaited_once_with(hass, "camera.front_door")
    path = center.engine.images.file_of(card.image)
    assert path is not None
    assert path.read_bytes() == b"\xff\xd8still"
    # One push each, with the still (a signed address).
    assert len(android) == 1
    assert len(ios) == 1
    for sent in (android[0], ios[0]):
        image = sent.data["data"]["image"]
        assert image.startswith(f"{IMAGE_URL}/{card.image}?authSig=")
    assert center.engine.snapshot()["notifications"][card.notification_id]["cards"][0][
        "image"
    ] == (card.image)

    # Triggered again while open: the same still.
    await center.call("trigger", "sensor.nc_doorbell")
    await hass.async_block_till_done()
    assert camera.await_count == 1


async def test_still_not_in_push(
    hass: HomeAssistant, center: Center, camera: AsyncMock
) -> None:
    """With Show in push off the push has no image; the details still have it."""
    android, _ios = await _setup(center, hass)
    await center.add("Doorbell", step("Ring", image=_image(push=False)))
    await center.call("trigger", "sensor.nc_doorbell")
    await hass.async_block_till_done()
    assert _card(center).image is not None
    assert len(android) == 1
    assert "image" not in android[0].data["data"]


async def test_no_still_the_push_goes_anyway(
    hass: HomeAssistant, center: Center
) -> None:
    """A camera that fails: the push goes without an image."""
    android, _ios = await _setup(center, hass)
    await center.add("Doorbell", step("Ring", image=_image()))
    with patch(GET_IMAGE, AsyncMock(side_effect=HomeAssistantError("offline"))):
        await center.call("trigger", "sensor.nc_doorbell")
        await hass.async_block_till_done()
    assert _card(center).image is None
    assert len(android) == 1
    assert "image" not in android[0].data["data"]


async def test_still_served_behind_the_login(
    hass: HomeAssistant,
    center: Center,
    camera: AsyncMock,
    hass_client: ClientSessionGenerator,
    hass_client_no_auth: ClientSessionGenerator,
) -> None:
    """Anyone logged in gets the still; others and unknown ids do not."""
    await center.add("Doorbell", step("Ring", image=_image()))
    await center.call("trigger", "sensor.nc_doorbell")
    await hass.async_block_till_done()
    image_id = _card(center).image
    client = await hass_client()
    response = await client.get(f"{IMAGE_URL}/{image_id}")
    assert response.status == 200
    assert await response.read() == b"\xff\xd8still"
    assert response.content_type == "image/jpeg"
    response = await client.get(f"{IMAGE_URL}/{'0' * 32}.jpg")
    assert response.status == 404
    response = await client.get(f"{IMAGE_URL}/..%2Fcore.config")
    assert response.status in (400, 404)
    anonymous = await hass_client_no_auth()
    response = await anonymous.get(f"{IMAGE_URL}/{image_id}")
    assert response.status == 401
    signed = center.engine.images.signed_path(str(image_id))
    response = await anonymous.get(signed)
    assert response.status == 200


async def test_stills_kept_for_a_week(hass: HomeAssistant, center: Center) -> None:
    """Stills older than a week are deleted; newer ones stay."""
    folder: Path = center.engine.images.folder
    await hass.async_add_executor_job(lambda: folder.mkdir(parents=True, exist_ok=True))
    old = folder / f"{'a' * 32}.jpg"
    new = folder / f"{'b' * 32}.jpg"

    def write() -> None:
        old.write_bytes(b"old")
        new.write_bytes(b"new")
        eight_days = time.time() - 8 * 86400
        os.utime(old, (eight_days, eight_days))

    await hass.async_add_executor_job(write)
    await center.engine.images.async_prune()
    assert not await hass.async_add_executor_job(old.exists)
    assert await hass.async_add_executor_job(new.exists)
