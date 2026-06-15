from __future__ import annotations

import base64
import random

import pytest
from PIL import Image

from app.agents import critic as critic_module
from app.agents.critic import CriticAgent, _regeneration_reasons, _should_regenerate_review
from app.config import Settings
from app.services import file_cleaner

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def test_should_regenerate_when_consistency_dimension_is_below_threshold() -> None:
    settings = Settings(critique_score_threshold=6.0)
    result = {
        "score": 6.5,
        "dimensions": {"consistency": 3, "quality": 9, "composition": 9},
    }

    assert _should_regenerate_review(result, settings) is True
    assert _regeneration_reasons(result, 6.0) == ["一致性 3 低于阈值 6"]


def test_should_not_regenerate_when_score_and_dimensions_meet_threshold() -> None:
    settings = Settings(critique_score_threshold=6.0)
    result = {
        "score": 6.5,
        "dimensions": {"consistency": 6, "quality": 6, "composition": 7},
    }

    assert _should_regenerate_review(result, settings) is False
    assert _regeneration_reasons(result, 6.0) == []


def test_should_regenerate_when_quality_dimension_is_below_threshold() -> None:
    settings = Settings(critique_score_threshold=6.0)
    result = {
        "score": 7.8,
        "dimensions": {"consistency": 9, "quality": 4, "composition": 9},
    }

    assert _should_regenerate_review(result, settings) is True
    assert _regeneration_reasons(result, 6.0) == ["质量 4 低于阈值 6"]


@pytest.mark.asyncio
async def test_build_multimodal_message_inlines_local_static_image(
    tmp_path,
    monkeypatch,
) -> None:
    static_dir = tmp_path / "static"
    image_dir = static_dir / "images"
    image_dir.mkdir(parents=True)
    (image_dir / "cat.png").write_bytes(PNG_BYTES)
    monkeypatch.setattr(file_cleaner, "STATIC_DIR", static_dir)

    messages = await CriticAgent()._build_multimodal_message(
        text_prompt="请审查图片",
        image_url="/static/images/cat.png",
        settings=Settings(public_base_url=None),
    )

    content = messages[0]["content"]
    image_part = next(part for part in content if part["type"] == "image_url")
    data_url = image_part["image_url"]["url"]

    assert data_url.startswith("data:image/png;base64,")
    assert base64.b64decode(data_url.split(",", 1)[1]) == PNG_BYTES


@pytest.mark.asyncio
async def test_build_multimodal_message_keeps_remote_image_url() -> None:
    image_url = "https://example.com/cat.png"

    messages = await CriticAgent()._build_multimodal_message(
        text_prompt="请审查图片",
        image_url=image_url,
        settings=Settings(public_base_url=None),
    )

    content = messages[0]["content"]
    image_part = next(part for part in content if part["type"] == "image_url")
    assert image_part["image_url"]["url"] == image_url


@pytest.mark.asyncio
async def test_build_multimodal_message_compresses_large_local_static_image(
    tmp_path,
    monkeypatch,
) -> None:
    static_dir = tmp_path / "static"
    image_dir = static_dir / "images"
    image_dir.mkdir(parents=True)
    image_path = image_dir / "large.png"
    pixel_bytes = random.Random(0).randbytes(512 * 512 * 3)
    Image.frombytes("RGB", (512, 512), pixel_bytes).save(image_path)
    monkeypatch.setattr(file_cleaner, "STATIC_DIR", static_dir)

    messages = await CriticAgent()._build_multimodal_message(
        text_prompt="请审查图片",
        image_url="/static/images/large.png",
        settings=Settings(public_base_url=None),
    )

    content = messages[0]["content"]
    image_part = next(part for part in content if part["type"] == "image_url")
    data_url = image_part["image_url"]["url"]
    encoded = data_url.split(",", 1)[1]

    assert image_path.stat().st_size > critic_module.MAX_INLINE_IMAGE_BYTES
    assert data_url.startswith("data:image/jpeg;base64,")
    assert len(base64.b64decode(encoded)) <= critic_module.MAX_INLINE_IMAGE_BYTES
