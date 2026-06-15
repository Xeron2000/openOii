from __future__ import annotations

import pytest

from app.config import Settings
from app.services.image_factory import create_image_service


def test_create_image_service_openai():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://image.example.com",
        image_api_key="test",
    )
    svc = create_image_service(settings)
    from app.services.image import ImageService

    assert isinstance(svc, ImageService)


def test_create_image_service_modelscope():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="modelscope",
        image_base_url="https://api-inference.modelscope.cn",
        image_api_key="test",
    )
    svc = create_image_service(settings)
    from app.services.image import ImageService

    assert isinstance(svc, ImageService)


def test_create_image_service_fake():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="fake",
        fake_image_fixture_url="/static/images/dev.png",
    )
    svc = create_image_service(settings)
    from app.services.fake_image import FakeImageService

    assert isinstance(svc, FakeImageService)


def test_create_image_service_unsupported():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="unsupported",
    )
    with pytest.raises(ValueError, match="Unsupported image provider"):
        create_image_service(settings)
