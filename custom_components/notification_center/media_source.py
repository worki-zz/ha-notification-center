"""The built-in sounds as a folder of the media browser.

The Chimes of the Speaker settings and any media picker of Home Assistant
show them under "Notification Center".
"""

from __future__ import annotations

from homeassistant.components.media_player import BrowseError, MediaClass
from homeassistant.components.media_source import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.core import HomeAssistant

from .const import DOMAIN, NAME, SOUNDS_URL_BASE
from .model import BUILTIN_CHIMES

MIME_TYPE = "audio/mpeg"


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    """Return the media source of the built-in sounds."""
    return SoundsMediaSource()


def sound_url(chime_id: str) -> str | None:
    """Return the URL of a built-in sound, by chime id."""
    sound = BUILTIN_CHIMES.get(chime_id)
    return f"{SOUNDS_URL_BASE}/{sound[0]}" if sound else None


def sound_media_id(chime_id: str) -> str:
    """Return the media source id of a built-in sound."""
    return f"media-source://{DOMAIN}/{chime_id}"


class SoundsMediaSource(MediaSource):
    """The sounds that come with Notification Center."""

    name = NAME

    def __init__(self) -> None:
        """Set up the source."""
        super().__init__(DOMAIN)

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Return the URL of a sound."""
        url = sound_url(item.identifier)
        if url is None:
            raise Unresolvable(f"Unknown sound: {item.identifier}")
        return PlayMedia(url, MIME_TYPE)

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Return the folder of the sounds."""
        if item.identifier:
            raise BrowseError("Sounds have no folders")
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=None,
            media_class=MediaClass.DIRECTORY,
            media_content_type="",
            title=NAME,
            can_play=False,
            can_expand=True,
            children_media_class=MediaClass.MUSIC,
            children=[
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=chime_id,
                    media_class=MediaClass.MUSIC,
                    media_content_type=MIME_TYPE,
                    title=name,
                    can_play=True,
                    can_expand=False,
                )
                for chime_id, (_file, name) in BUILTIN_CHIMES.items()
            ],
        )
