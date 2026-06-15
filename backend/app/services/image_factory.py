from __future__ import annotations

from typing import Any, Protocol

from app.config import Settings


class ImageServiceProtocol(Protocol):
    async def generate(self, **kwargs: Any) -> dict[str, Any]:
        ...

    async def generate_url(
        self,
        *,
        prompt: str,
        size: str = "1024x1024",
        image_bytes: bytes | None = None,
        **kwargs: Any,
    ) -> str:
        ...

    async def cache_external_image(self, url: str) -> str:
        ...


def create_image_service(settings: Settings) -> ImageServiceProtocol:
    provider = settings.image_provider.lower()
    if provider in {"openai", "modelscope"}:
        from app.services.image import ImageService

        return ImageService(settings)
    if provider == "fake":
        from app.services.fake_image import FakeImageService

        return FakeImageService(settings)
    raise ValueError(f"Unsupported image provider: {settings.image_provider}")
