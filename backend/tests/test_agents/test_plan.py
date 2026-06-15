from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.agents.plan import (
    PlanAgent,
    _character_to_description,
    _compose_image_prompt,
    _compose_video_prompt,
)
from app.models.project import Character, Shot
from tests.agent_fixtures import FakeLLM, make_context
from tests.factories import create_character, create_project, create_run, create_shot


class TestCharacterToDescription:
    def test_plain_description(self):
        assert _character_to_description({"description": "a hero"}) == "a hero"

    def test_description_with_personality_traits(self):
        result = _character_to_description(
            {
                "description": "a hero",
                "personality_traits": ["brave", "kind"],
            }
        )
        assert "a hero" in result
        assert "brave, kind" in result

    def test_list_traits_only(self):
        result = _character_to_description({"personality_traits": ["cool"]})
        assert "cool" in result

    def test_empty_dict_falls_back_to_json(self):
        result = _character_to_description({})
        assert json.loads(result) == {}

    def test_goals_and_costume(self):
        result = _character_to_description(
            {
                "description": "warrior",
                "goals": "save world",
                "costume_notes": "armor",
            }
        )
        assert "warrior" in result
        assert "save world" in result
        assert "armor" in result

    def test_empty_list_traits_ignored(self):
        result = _character_to_description({"description": "x", "personality_traits": []})
        assert result == "x"

    def test_non_string_description_ignored(self):
        result = _character_to_description({"description": 123})
        assert "123" in result

    def test_non_string_list_items_filtered(self):
        result = _character_to_description({"personality_traits": ["ok", 42, None]})
        assert "ok" in result
        assert "42" not in result


class TestComposeImagePrompt:
    def test_existing_image_prompt(self):
        assert (
            _compose_image_prompt({"image_prompt": "  anime style girl  "}, "")
            == "anime style girl"
        )

    def test_compose_from_fields(self):
        result = _compose_image_prompt(
            {
                "scene": "forest",
                "action": "running",
                "expression": "happy",
            },
            "warm palette",
        )
        assert "forest" in result
        assert "running" in result
        assert "warm palette" in result

    def test_empty_shot_returns_description(self):
        result = _compose_image_prompt({"description": "fallback"}, "")
        assert result == "fallback"

    def test_no_visual_bible(self):
        result = _compose_image_prompt({"scene": "room", "action": "sitting"}, "")
        assert "room" in result
        assert "sitting" in result

    def test_camera_and_lighting(self):
        result = _compose_image_prompt(
            {
                "camera": "close-up",
                "lighting": "backlit",
            },
            "",
        )
        assert "close-up" in result
        assert "backlit" in result


class TestComposeVideoPrompt:
    def test_existing_video_prompt(self):
        assert _compose_video_prompt({"video_prompt": "  zoom in  "}) == "zoom in"

    def test_compose_from_camera_action(self):
        result = _compose_video_prompt({"camera": "pan left", "action": "walk"})
        assert "pan left" in result
        assert "walk" in result

    def test_fallback_to_description(self):
        assert _compose_video_prompt({"description": "fallback"}) == "fallback"

    def test_empty_fields(self):
        assert _compose_video_prompt({}) == ""


@pytest.mark.asyncio
async def test_plan_agent_full_mode_creates_characters_and_shots(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"title": "New Title", "status": "planning"},
            "visual_bible": "anime style, warm palette",
            "story_breakdown": {
                "logline": "A hero saves the world",
                "genre": ["action"],
                "themes": ["courage"],
            },
            "characters": [
                {"name": "Hero", "description": "brave warrior", "personality_traits": ["brave"]},
            ],
            "shots": [
                {
                    "order": 1,
                    "description": "Hero enters the forest",
                    "scene": "forest",
                    "action": "walking",
                    "camera": "wide shot",
                    "lighting": "golden hour",
                    "dialogue": None,
                    "sfx": "wind",
                    "duration": 5.0,
                    "image_prompt": "anime style hero in forest",
                    "video_prompt": "slow zoom",
                },
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "full"

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "Hero"

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(shots) == 1
    assert shots[0].description == "Hero enters the forest"
    assert shots[0].scene == "forest"
    assert shots[0].image_prompt == "anime style hero in forest"
    assert shots[0].prompt == "slow zoom"
    assert shots[0].duration == 5.0
    assert shots[0].camera == "wide shot"
    assert shots[0].motion_note == "slow zoom"
    assert shots[0].character_ids == [chars[0].id]

    events = ctx.ws.events
    project_events = [e for pid, e in events if e["type"] == "project_updated"]
    assert len(project_events) >= 1


@pytest.mark.asyncio
async def test_plan_agent_shot_decision_counts_existing_characters(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    await create_character(test_session, project_id=project.id, name="Hero")
    await create_character(test_session, project_id=project.id, name="Guide")

    llm_output = json.dumps(
        {
            "agent": "plan",
            "visual_bible": "test",
            "shots": [{"order": 1, "description": "Hero follows the guide"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run_shots(ctx)

    thinking_events = [event for _, event in ctx.ws.events if event["type"] == "agent_thinking"]
    assert any(
        event["data"]["content"] == "已生成 1 个分镜和 2 个角色" for event in thinking_events
    )

    await test_session.refresh(project)
    assert project.summary == "2个角色，1个分镜"


@pytest.mark.asyncio
async def test_plan_agent_composes_image_prompt_when_missing(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "warm tones",
            "shots": [
                {
                    "order": 1,
                    "description": "A sunset scene",
                    "scene": "beach",
                    "action": "standing",
                    "expression": "calm",
                    "camera": "medium shot",
                    "lighting": "sunset",
                },
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(shots) == 1
    composed = shots[0].image_prompt
    assert "beach" in composed
    assert "warm tones" in composed


@pytest.mark.asyncio
async def test_plan_agent_composes_video_prompt_when_missing(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "cool tones",
            "shots": [
                {
                    "order": 1,
                    "description": "night scene",
                    "camera": "tracking shot",
                    "action": "running",
                },
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(shots) == 1
    assert "tracking shot" in shots[0].prompt
    assert "running" in shots[0].prompt
    assert shots[0].motion_note == shots[0].prompt


@pytest.mark.asyncio
async def test_plan_agent_no_shots_raises(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    with pytest.raises(ValueError, match="分镜"):
        await PlanAgent().run(ctx)


@pytest.mark.asyncio
async def test_plan_agent_empty_shots_raises(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [{"order": 1, "description": ""}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    with pytest.raises(ValueError, match="分镜"):
        await PlanAgent().run(ctx)


@pytest.mark.asyncio
async def test_plan_agent_incremental_mode(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    char1 = await create_character(test_session, project_id=project.id, name="Old Hero")
    shot1 = await create_shot(test_session, project_id=project.id, order=1, description="Old shot")
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "warm palette",
            "preserve_ids": {"characters": [char1.id], "shots": [shot1.id]},
            "characters": [
                {"id": char1.id, "name": "Updated Hero", "description": "stronger"},
            ],
            "shots": [
                {"id": shot1.id, "order": 1, "description": "New shot desc", "scene": "castle"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    await test_session.refresh(char1)
    assert char1.name == "Updated Hero"

    await test_session.refresh(shot1)
    assert shot1.description == "New shot desc"
    assert shot1.scene == "castle"


@pytest.mark.asyncio
async def test_plan_agent_incremental_deletes_unpreserved(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    char1 = await create_character(test_session, project_id=project.id, name="Keep")
    await create_character(test_session, project_id=project.id, name="Delete")
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "warm",
            "preserve_ids": {"characters": [char1.id], "shots": []},
            "characters": [],
            "shots": [
                {"order": 1, "description": "New shot"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "Keep"

    deleted_events = [e for pid, e in ctx.ws.events if e["type"] == "character_deleted"]
    assert len(deleted_events) == 1


@pytest.mark.asyncio
async def test_plan_agent_incremental_new_character(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "dark",
            "preserve_ids": {"characters": [], "shots": []},
            "characters": [
                {"name": "New Char", "description": "fresh face"},
            ],
            "shots": [
                {"order": 1, "description": "Opening"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "New Char"


@pytest.mark.asyncio
async def test_plan_agent_sends_ws_events(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "anime palette",
            "characters": [{"name": "A", "description": "desc"}],
            "shots": [{"order": 1, "description": "Shot 1"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    event_types = [e["type"] for pid, e in ctx.ws.events]
    assert "project_updated" in event_types
    assert "character_created" in event_types
    assert "shot_created" in event_types
    assert "run_message" in event_types


@pytest.mark.asyncio
async def test_plan_agent_with_user_feedback(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "v",
            "shots": [{"order": 1, "description": "Test"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.user_feedback = "Make it darker"

    await PlanAgent().run(ctx)

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert len(msg_events) >= 1


@pytest.mark.asyncio
async def test_plan_agent_keeps_existing_project_style(test_session, test_settings):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"style": "cinematic", "status": "planning"},
            "visual_bible": "film grain",
            "shots": [{"order": 1, "description": "Scene"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    await test_session.refresh(project)
    assert project.style == "anime"


@pytest.mark.asyncio
async def test_plan_agent_multiple_shots_sorted_by_order(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [
                {"order": 3, "description": "Third"},
                {"order": 1, "description": "First"},
                {"order": 2, "description": "Second"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (
            await test_session.execute(
                select(Shot).where(Shot.project_id == project.id).order_by(Shot.order)
            )
        )
        .scalars()
        .all()
    )
    assert [s.order for s in shots] == [1, 2, 3]


@pytest.mark.asyncio
async def test_plan_agent_shot_fallback_order(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [
                {"description": "No order given"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert shots[0].order == 1


@pytest.mark.asyncio
async def test_plan_agent_invalid_character_entry_ignored(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "characters": [
                "not a dict",
                {"description": "no name"},
                42,
                {"name": "Valid", "description": "ok"},
            ],
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "Valid"


@pytest.mark.asyncio
async def test_plan_agent_incremental_new_shot(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    existing_shot = await create_shot(
        test_session, project_id=project.id, order=1, description="Keep"
    )
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "preserve_ids": {"characters": [], "shots": [existing_shot.id]},
            "characters": [],
            "shots": [
                {"id": existing_shot.id, "order": 1, "description": "Updated"},
                {"order": 2, "description": "New shot"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    shots = (
        (
            await test_session.execute(
                select(Shot).where(Shot.project_id == project.id).order_by(Shot.order)
            )
        )
        .scalars()
        .all()
    )
    assert len(shots) == 2


@pytest.mark.asyncio
async def test_plan_agent_incremental_wrong_project_char_ignored(test_session, test_settings):
    project1 = await create_project(test_session, title="P1")
    project2 = await create_project(test_session, title="P2")
    run = await create_run(test_session, project_id=project2.id)

    char_p1 = await create_character(test_session, project_id=project1.id, name="P1 Char")
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "preserve_ids": {"characters": [], "shots": []},
            "characters": [
                {"id": char_p1.id, "name": "Hacked", "description": "should not update"},
            ],
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project2, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    await test_session.refresh(char_p1)
    assert char_p1.name == "P1 Char"


@pytest.mark.asyncio
async def test_plan_agent_project_update_summary(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning", "summary": "A brave hero story"},
            "visual_bible": "test",
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    await test_session.refresh(project)
    assert project.summary == "A brave hero story"


@pytest.mark.asyncio
async def test_plan_agent_default_status_planning(test_session, test_settings):
    project = await create_project(test_session, status="draft")
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {},
            "visual_bible": "test",
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    await test_session.refresh(project)
    assert project.status == "planning"
