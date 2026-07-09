from __future__ import annotations

import pytest

from app.agents.base import TargetIds
from app.agents.review_rules import (
    ALLOWED_START_AGENTS,
    ReviewRuleEngine,
    _decide_mode,
    _is_full_restart_feedback,
    _is_retry_merge_feedback,
    resolve_entity_start_agent,
)
from tests.agent_fixtures import make_context
from tests.factories import create_project, create_run


class TestIsRetryMergeFeedback:
    def test_retry_merge_keyword(self):
        assert _is_retry_merge_feedback("重试合成") is True

    def test_retry_merge_english(self):
        assert _is_retry_merge_feedback("retry merge") is True

    def test_final_output(self):
        assert _is_retry_merge_feedback("final-output") is True

    def test_normal_feedback(self):
        assert _is_retry_merge_feedback("please fix the colors") is False

    def test_empty_string(self):
        assert _is_retry_merge_feedback("") is False

    def test_case_insensitive(self):
        assert _is_retry_merge_feedback("RETRY MERGE") is True


class TestIsFullRestartFeedback:
    def test_chinese_keyword(self):
        assert _is_full_restart_feedback("推倒重来") is True

    def test_english_keyword(self):
        assert _is_full_restart_feedback("regenerate all") is True

    def test_normal_feedback(self):
        assert _is_full_restart_feedback("fix the shot") is False

    def test_empty(self):
        assert _is_full_restart_feedback("") is False

    def test_case_insensitive(self):
        assert _is_full_restart_feedback("REDO ALL") is True

    def test_partial_match(self):
        assert _is_full_restart_feedback("全部推翻") is True


class TestDecideMode:
    def test_full_restart(self):
        assert _decide_mode("plan", "推倒重来") == "full"

    def test_incremental_default(self):
        assert _decide_mode("plan", "fix the character") == "incremental"

    def test_render_type(self):
        assert _decide_mode("render", "adjust colors") == "incremental"


@pytest.mark.asyncio
async def test_review_no_feedback_defaults_to_plan(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = ""

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"
    assert result["mode"] == "full"


@pytest.mark.asyncio
async def test_review_no_feedback_attribute(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = None

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"
    assert result["mode"] == "full"


@pytest.mark.asyncio
async def test_review_full_restart_feedback(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "推倒重来"

    result = await ReviewRuleEngine().run(ctx)

    assert result["mode"] == "full"


@pytest.mark.asyncio
async def test_review_plan_feedback_type(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "add more characters"
    ctx.feedback_type = "plan"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"


@pytest.mark.asyncio
async def test_review_render_feedback_type(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix the image"
    ctx.feedback_type = "character"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "render"


@pytest.mark.asyncio
async def test_review_compose_feedback_type(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "redo the video"
    ctx.feedback_type = "compose"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "compose"


class TestResolveEntityStartAgent:
    def test_default_shot_is_render(self):
        assert resolve_entity_start_agent("shot", "再生成一下") == "render"

    def test_dialogue_routes_to_plan(self):
        assert resolve_entity_start_agent("shot", "把对白改成更冷一点") == "plan"

    def test_night_scene_routes_to_render(self):
        assert resolve_entity_start_agent("shot", "换成夜景光影") == "render"

    def test_video_keyword_routes_to_compose(self):
        assert resolve_entity_start_agent("shot", "重做视频运镜") == "compose"

    def test_video_entity_type(self):
        assert resolve_entity_start_agent("video", "anything") == "compose"

    def test_character_rename_to_plan(self):
        assert resolve_entity_start_agent("character", "改名为艾拉") == "plan"


@pytest.mark.asyncio
async def test_review_per_entity_character(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix this character"
    ctx.entity_type = "character"
    ctx.entity_id = 5

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "render"
    assert result["mode"] == "incremental"
    assert result["target_ids"] is not None
    assert result["target_ids"].character_ids == [5]
    assert ctx.user_feedback.startswith("[focus:character:5]")


@pytest.mark.asyncio
async def test_review_per_entity_shot(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "redo shot"
    ctx.entity_type = "shot"
    ctx.entity_id = 10

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "render"
    assert result["mode"] == "incremental"
    assert result["target_ids"] is not None
    assert result["target_ids"].shot_ids == [10]


@pytest.mark.asyncio
async def test_review_per_entity_shot_dialogue_routes_plan(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "对白改成低声呢喃"
    ctx.entity_type = "shot"
    ctx.entity_id = 10

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"
    assert result["mode"] == "incremental"
    assert result["target_ids"].shot_ids == [10]
    assert "plan" in result["reason"]


@pytest.mark.asyncio
async def test_review_per_entity_video(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "redo video"
    ctx.entity_type = "video"
    ctx.entity_id = 3

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "compose"
    assert result["mode"] == "incremental"


@pytest.mark.asyncio
async def test_review_retry_merge_feedback(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "重试合成"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "compose"
    assert result["mode"] == "incremental"


@pytest.mark.asyncio
async def test_review_unknown_feedback_type_defaults_to_plan(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "some feedback"
    ctx.feedback_type = "unknown_type"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"


@pytest.mark.asyncio
async def test_review_story_feedback_type_maps_to_plan(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "change story"
    ctx.feedback_type = "story"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"


@pytest.mark.asyncio
async def test_review_character_feedback_type_maps_to_render(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "change character"
    ctx.feedback_type = "character"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "render"


@pytest.mark.asyncio
async def test_review_video_feedback_type_maps_to_compose(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "change video"
    ctx.feedback_type = "video"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "compose"


def test_allowed_start_agents():
    assert ALLOWED_START_AGENTS == {"outline", "plan", "render", "compose"}


@pytest.mark.asyncio
async def test_review_sends_message(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix it"
    ctx.feedback_type = "plan"

    await ReviewRuleEngine().run(ctx)

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert len(msg_events) >= 1


@pytest.mark.asyncio
async def test_review_no_feedback_type_defaults_to_plan(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "change something"
    ctx.feedback_type = None

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"


@pytest.mark.asyncio
async def test_review_unallowed_start_agent_fallback(test_session, test_settings, monkeypatch):
    from app.agents import review_rules as rr

    original_map = rr._FEEDBACK_TYPE_MAP.copy()
    rr._FEEDBACK_TYPE_MAP["weird"] = "nonexistent_agent"

    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "test"
    ctx.feedback_type = "weird"

    result = await ReviewRuleEngine().run(ctx)

    assert result["start_agent"] == "plan"

    rr._FEEDBACK_TYPE_MAP.clear()
    rr._FEEDBACK_TYPE_MAP.update(original_map)


@pytest.mark.asyncio
async def test_review_target_ids_character_message(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix this character"
    ctx.entity_type = "character"
    ctx.entity_id = 5
    ctx.target_ids = TargetIds(character_ids=[5])

    await ReviewRuleEngine().run(ctx)

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert any("角色" in e["data"]["content"] for e in msg_events)


@pytest.mark.asyncio
async def test_review_target_ids_shot_message(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "redo shot"
    ctx.entity_type = "shot"
    ctx.entity_id = 10
    ctx.target_ids = TargetIds(shot_ids=[10])

    await ReviewRuleEngine().run(ctx)

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert any("分镜" in e["data"]["content"] for e in msg_events)


@pytest.mark.asyncio
async def test_review_target_info_in_message(test_session, test_settings, monkeypatch):


    def mock_infer(data, state):
        return TargetIds(character_ids=[1, 2], shot_ids=[3, 4, 5])

    monkeypatch.setattr("app.agents.review_rules.infer_feedback_targets", mock_infer)

    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix characters and shots"
    ctx.feedback_type = "plan"

    result = await ReviewRuleEngine().run(ctx)

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert any("2 个角色" in e["data"]["content"] and "3 个分镜" in e["data"]["content"] for e in msg_events)
    assert result["target_ids"].character_ids == [1, 2]
    assert result["target_ids"].shot_ids == [3, 4, 5]


@pytest.mark.asyncio
async def test_review_entity_type_character_sets_target_ids(test_session, test_settings, monkeypatch):

    def mock_infer(data, state):
        return TargetIds()

    monkeypatch.setattr("app.agents.review_rules.infer_feedback_targets", mock_infer)

    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix this character"
    ctx.entity_type = "character"
    ctx.entity_id = 7

    result = await ReviewRuleEngine().run(ctx)

    assert result["target_ids"].character_ids == [7]


@pytest.mark.asyncio
async def test_review_entity_type_shot_sets_target_ids(test_session, test_settings, monkeypatch):

    def mock_infer(data, state):
        return TargetIds()

    monkeypatch.setattr("app.agents.review_rules.infer_feedback_targets", mock_infer)

    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)
    ctx = await make_context(test_session, test_settings, project=project, run=run)
    ctx.user_feedback = "fix this shot"
    ctx.entity_type = "shot"
    ctx.entity_id = 12

    result = await ReviewRuleEngine().run(ctx)

    assert result["target_ids"].shot_ids == [12]
