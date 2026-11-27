"""The Image of a step: a still of a camera or image entity.

The still is taken when a card becomes active, so that the Notification
details and the push show the same picture, the one of that moment. It is
kept for a week in the config folder and served behind Home Assistant's
login (or a signed path, which the push uses).
"""

from __future__ import annotations

from datetime import timedelta
import logging
from pathlib import Path
import re
import time
from typing import Any
from uuid import uuid4

from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.components.http.auth import async_sign_path
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

IMAGE_URL = f"/api/{DOMAIN}/image"
# How long a still is kept, and how long its signed address works.
KEEP = timedelta(days=7)
CAPTURE_TIMEOUT = 10

_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif"}
_ID = re.compile(r"^[0-9a-f]{32}\.(jpg|png|gif|webp)$")


def image_entity(step: dict[str, Any] | None) -> str | None:
    """Return the camera or image entity of a step's Image, if it has one."""
    image = (step or {}).get("image") or {}
    entity_id = image.get("entity_id")
    return entity_id if isinstance(entity_id, str) and entity_id else None


def image_in_push(step: dict[str, Any] | None) -> bool:
    """Return whether a step's push carries its Image."""
    image = (step or {}).get("image") or {}
    return image_entity(step) is not None and bool(image.get("push", True))


def image_path(image_id: str) -> str:
    """Return the address of a still (behind the login)."""
    return f"{IMAGE_URL}/{image_id}"


class ImageStore:
    """Take, keep and find the stills."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Keep the stills in the config folder, next to the storage."""
        self.hass = hass
        self.folder = Path(hass.config.path(".storage", f"{DOMAIN}_images"))

    async def async_capture(self, entity_id: str) -> str | None:
        """Take a still of a camera or image entity; None when it fails."""
        try:
            image = await _async_get_image(self.hass, entity_id)
        except (HomeAssistantError, TimeoutError, OSError) as err:
            _LOGGER.warning("No image of %s: %s", entity_id, err)
            return None
        extension = _EXTENSIONS.get(image.content_type.split(";")[0].strip(), ".jpg")
        image_id = f"{uuid4().hex}{extension}"
        await self.hass.async_add_executor_job(self._write, image_id, image.content)
        return image_id

    def _write(self, image_id: str, content: bytes) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / image_id).write_bytes(content)

    def file_of(self, image_id: str) -> Path | None:
        """Return the file of a still, or None when there is none."""
        if not _ID.match(image_id):
            return None
        path = self.folder / image_id
        return path if path.is_file() else None

    def signed_path(self, image_id: str) -> str:
        """Return the address of a still that works without a login (a week)."""
        return async_sign_path(
            self.hass, image_path(image_id), KEEP, use_content_user=True
        )

    async def async_prune(self) -> None:
        """Delete the stills older than a week."""
        await self.hass.async_add_executor_job(self._prune)

    def _prune(self) -> None:
        if not self.folder.is_dir():
            return
        oldest = time.time() - KEEP.total_seconds()
        for path in self.folder.iterdir():
            try:
                if path.is_file() and path.stat().st_mtime < oldest:
                    path.unlink()
            except OSError:
                continue


async def _async_get_image(hass: HomeAssistant, entity_id: str) -> Any:
    """Return the image of a camera or image entity."""
    if entity_id.startswith("camera."):
        from homeassistant.components.camera import async_get_image  # noqa: PLC0415

        return await async_get_image(hass, entity_id, timeout=CAPTURE_TIMEOUT)
    if entity_id.startswith("image."):
        from homeassistant.components.image import (  # noqa: PLC0415
            async_get_image as async_get_entity_image,
        )

        return await async_get_entity_image(hass, entity_id, timeout=CAPTURE_TIMEOUT)
    raise HomeAssistantError(f"{entity_id} is not a camera or an image")


class ImageView(HomeAssistantView):
    """Serve a still to anyone logged in (or with its signed path)."""

    url = f"{IMAGE_URL}/{{image_id}}"
    name = f"api:{DOMAIN}:image"
    requires_auth = True

    async def get(self, request: web.Request, image_id: str) -> web.StreamResponse:
        """Return the still."""
        hass: HomeAssistant = request.app[KEY_HASS]
        from .engine import async_get_engine  # noqa: PLC0415

        engine = async_get_engine(hass)
        path = engine.images.file_of(image_id) if engine is not None else None
        if path is None:
            return web.Response(status=404, text="No such image")
        return web.FileResponse(
            path, headers={"Cache-Control": "private, max-age=604800"}
        )
