from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.agents.render import RenderAgent
from app.agents.base import TargetIds
from tests.agent_fixtures import FakeImageService, make_context
from tests.factories import create_character, create_project, create_run, create_shot


@pytest.mark.asyncio
async def test_render_agent_generates_character_images(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    char = await create_character(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService(url="http://image.test/char.png")
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(return_value="http://image.test/char.png")
    )

    await agent._render_characters(ctx)

    await test_session.refresh(char)
    assert char.image_url == "http://image.test/char.png"


@pytest.mark.asyncio
async def test_render_agent_skips_characters_with_images(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    await create_character(
        test_session, project_id=project.id, image_url="http://img.test/already.png"
    )
    await test_session.commit()

    image = FakeImageService()
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    count = await agent._render_characters(ctx)
    assert count == 0


@pytest.mark.asyncio
async def test_render_agent_generates_shot_images(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    shot = await create_shot(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService(url="http://image.test/shot.png")
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(return_value="http://image.test/shot.png")
    )
    monkeypatch.setattr(
        "app.agents.render.resolve_shot_bound_approved_characters",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        agent.image_composer, "compose_character_reference_image", AsyncMock(return_value=b"bytes")
    )

    count = await agent._render_shots(ctx)
    assert count == 1

    await test_session.refresh(shot)
    assert shot.image_url == "http://image.test/shot.png"


@pytest.mark.asyncio
async def test_render_agent_skips_shots_with_images(test_session, test_settings):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    await create_shot(test_session, project_id=project.id, image_url="http://img.test/already.png")
    await test_session.commit()

    image = FakeImageService()
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    count = await agent._render_shots(ctx)
    assert count == 0


@pytest.mark.asyncio
async def test_render_agent_target_ids_character_filter(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    char1 = await create_character(test_session, project_id=project.id, image_url=None)
    char2 = await create_character(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService(url="http://image.test/char1.png")
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    ctx.target_ids = TargetIds(character_ids=[char1.id])
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(return_value="http://image.test/char1.png")
    )

    count = await agent._render_characters(ctx)
    assert count == 1

    await test_session.refresh(char1)
    await test_session.refresh(char2)
    assert char1.image_url is not None
    assert char2.image_url is None


@pytest.mark.asyncio
async def test_render_agent_target_ids_shot_filter(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    shot1 = await create_shot(test_session, project_id=project.id, image_url=None)
    await create_shot(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService(url="http://image.test/shot1.png")
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    ctx.target_ids = TargetIds(shot_ids=[shot1.id])
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(return_value="http://image.test/shot1.png")
    )
    monkeypatch.setattr(
        "app.agents.render.resolve_shot_bound_approved_characters",
        AsyncMock(return_value=[]),
    )

    count = await agent._render_shots(ctx)
    assert count == 1


@pytest.mark.asyncio
async def test_render_agent_character_image_failure(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    await create_character(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService()
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(side_effect=RuntimeError("API down"))
    )

    count = await agent._render_characters(ctx)
    assert count == 0

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert any("图片生成失败" in e["data"]["content"] for e in msg_events)


@pytest.mark.asyncio
async def test_render_agent_shot_image_failure(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    await create_shot(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService()
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(side_effect=RuntimeError("API down"))
    )
    monkeypatch.setattr(
        "app.agents.render.resolve_shot_bound_approved_characters",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr("asyncio.sleep", AsyncMock(return_value=None))

    count = await agent._render_shots(ctx)
    assert count == 0


@pytest.mark.asyncio
async def test_render_agent_full_run(test_session, test_settings, monkeypatch):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    char = await create_character(test_session, project_id=project.id, image_url=None)
    shot = await create_shot(test_session, project_id=project.id, image_url=None)
    await test_session.commit()

    image = FakeImageService(url="http://image.test/img.png")
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(return_value="http://image.test/img.png")
    )
    monkeypatch.setattr(
        "app.agents.render.resolve_shot_bound_approved_characters",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr("asyncio.sleep", AsyncMock(return_value=None))

    await agent.run(ctx)

    await test_session.refresh(char)
    await test_session.refresh(shot)
    assert char.image_url is not None
    assert shot.image_url is not None


def test_style_descriptor_anime():
    agent = RenderAgent()
    result = agent._style_descriptor("anime")
    assert "anime" in result


def test_style_descriptor_unknown():
    agent = RenderAgent()
    result = agent._style_descriptor("nonexistent_style")
    assert "nonexistent_style" in result
    assert "non-photorealistic" in result


def test_style_descriptor_cinematic():
    agent = RenderAgent()
    result = agent._style_descriptor("cinematic")
    assert "cinematic anime comic style" in result
    assert "cinematic, photorealistic" not in result


def test_style_descriptor_manga():
    agent = RenderAgent()
    result = agent._style_descriptor("manga")
    assert "manga" in result


@pytest.mark.asyncio
async def test_build_character_prompt(test_session):
    from app.models.project import Character as CharModel

    agent = RenderAgent()
    char = CharModel(id=1, project_id=1, name="Hero", description="brave warrior", image_url=None)
    result = await agent._build_character_prompt(char, style="anime", session=test_session)
    assert "brave warrior" in result
    assert "canonical character design sheet" in result
    assert "anime" in result
    assert "non-photorealistic" in result


@pytest.mark.asyncio
async def test_builtin_style_descriptor_ignores_stale_db_template(test_session):
    from app.models.style_template import StyleTemplate

    test_session.add(
        StyleTemplate(
            name="Old Cinematic",
            slug="cinematic",
            category="builtin",
            style_prompt="cinematic, photorealistic, 35mm film grain",
            color_palette=[],
            is_active=True,
        )
    )
    await test_session.commit()

    agent = RenderAgent()
    style_prompt, negative_prompt = await agent._style_descriptor_async(test_session, "cinematic")

    assert "cinematic anime comic style" in style_prompt
    assert "35mm film grain" not in style_prompt
    assert "live action" in negative_prompt


@pytest.mark.asyncio
async def test_custom_style_descriptor_preserves_custom_prompt(test_session):
    from app.models.style_template import StyleTemplate

    test_session.add(
        StyleTemplate(
            name="Noir Comic",
            slug="noir-comic",
            category="custom",
            style_prompt="noir brush comic, sharp shadows",
            color_palette=["black", "red"],
            is_active=True,
        )
    )
    await test_session.commit()

    agent = RenderAgent()
    style_prompt, negative_prompt = await agent._style_descriptor_async(test_session, "noir-comic")

    assert "noir brush comic, sharp shadows, black, red" in style_prompt
    assert "non-photorealistic" in style_prompt
    assert "style drift" in negative_prompt


@pytest.mark.asyncio
async def test_build_character_prompt_no_description(test_session):
    from app.models.project import Character as CharModel

    agent = RenderAgent()
    char = CharModel(id=1, project_id=1, name="Hero", description=None, image_url=None)
    result = await agent._build_character_prompt(char, style="anime", session=test_session)
    assert "Hero" in result


@pytest.mark.asyncio
async def test_build_shot_prompt(test_session):
    from app.models.project import Character as CharModel, Shot as ShotModel

    agent = RenderAgent()
    shot = ShotModel(
        id=1,
        project_id=1,
        order=1,
        description="test",
        image_prompt="hero in forest",
        prompt=None,
        scene=None,
        action=None,
        expression=None,
        camera=None,
        lighting=None,
        dialogue=None,
        sfx=None,
        duration=None,
        image_url=None,
        video_url=None,
        character_ids=[],
    )
    chars: list[CharModel] = []
    result = await agent._build_shot_prompt(shot, chars, style="anime", session=test_session)
    assert "hero in forest" in result
    assert "anime" in result
    assert "non-photorealistic" in result


@pytest.mark.asyncio
async def test_build_shot_prompt_no_image_prompt(test_session):
    from app.models.project import Shot as ShotModel

    agent = RenderAgent()
    shot = ShotModel(
        id=1,
        project_id=1,
        order=1,
        description="fallback desc",
        image_prompt=None,
        prompt=None,
        scene=None,
        action=None,
        expression=None,
        camera=None,
        lighting=None,
        dialogue=None,
        sfx=None,
        duration=None,
        image_url=None,
        video_url=None,
        character_ids=[],
    )
    result = await agent._build_shot_prompt(shot, [], style="cinematic", session=test_session)
    assert "fallback desc" in result


@pytest.mark.asyncio
async def test_build_shot_prompt_with_characters(test_session):
    from app.models.project import Character as CharModel, Shot as ShotModel

    agent = RenderAgent()
    shot = ShotModel(
        id=1,
        project_id=1,
        order=1,
        description="test",
        image_prompt="scene",
        prompt=None,
        scene=None,
        action=None,
        expression=None,
        camera=None,
        lighting=None,
        dialogue=None,
        sfx=None,
        duration=None,
        image_url=None,
        video_url=None,
        character_ids=[],
    )
    char = CharModel(id=1, project_id=1, name="Hero", description="warrior", image_url=None)
    result = await agent._build_shot_prompt(shot, [char], style="anime", session=test_session)
    assert "Hero" in result
    assert "identity anchor" in result
    assert "no redesign" in result


@pytest.mark.asyncio
async def test_render_agent_compose_reference_fails_fallback(
    test_session, test_settings, monkeypatch
):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)
    await create_shot(test_session, project_id=project.id, image_url=None)
    char = await create_character(
        test_session, project_id=project.id, image_url="http://img.test/char.png"
    )
    await test_session.commit()

    image = FakeImageService(url="http://image.test/shot.png")
    ctx = await make_context(test_session, test_settings, project=project, run=run, image=image)
    agent = RenderAgent()

    monkeypatch.setattr(
        agent, "generate_and_cache_image", AsyncMock(return_value="http://image.test/shot.png")
    )
    monkeypatch.setattr(
        "app.agents.render.resolve_shot_bound_approved_characters",
        AsyncMock(return_value=[char]),
    )
    monkeypatch.setattr(
        agent.image_composer,
        "compose_character_reference_image",
        AsyncMock(side_effect=RuntimeError("compose fail")),
    )
    monkeypatch.setattr("asyncio.sleep", AsyncMock(return_value=None))

    count = await agent._render_shots(ctx)
    assert count == 1
