"""Skill catalog + graph driver unit tests (simple skills only)."""

from __future__ import annotations

import pytest

from app.orchestration.driver import gate_name_from_interrupt, drive_graph_until_idle
from app.skills.catalog import get_skill, list_skills, resolve_skill_entry
from app.skills.context import (
    apply_skill_defaults_to_create,
    resolve_project_skill_id,
    skill_payload,
)


SIMPLE_SKILL_IDS = (
    "story-anime",
    "character-design",
    "script-breakdown",
    "quick-short",
    "scene-design",
    "comedy-pet",
)


def test_skill_catalog_only_simple_skills():
    skills = list_skills()
    ids = {s.id for s in skills}
    assert ids == set(SIMPLE_SKILL_IDS)
    # experimental pipelines removed from product surface
    assert get_skill("video-reimagine") is None
    assert get_skill("product-ad") is None


def test_every_skill_has_real_directives_and_entry():
    for skill_id in SIMPLE_SKILL_IDS:
        skill = get_skill(skill_id)
        assert skill is not None
        assert skill.available is True
        assert len(skill.directives.strip()) >= 40
        assert skill.start_agent in {"outline", "plan"}
        assert skill.placeholder.strip()


def test_resolve_skill_quick_prefers_auto_mode():
    res = resolve_skill_entry("quick-short", auto_mode=False, outline_enabled=True)
    assert res.auto_mode is True
    assert res.start_stage == "plan_outline"
    assert res.default_target_shot_count == 5


def test_resolve_skill_character_design_entry():
    res = resolve_skill_entry("character-design", outline_enabled=True)
    assert res.start_agent == "plan"
    assert res.start_stage == "plan_characters"
    assert "visual_notes" in res.directives or "角色" in res.directives


def test_resolve_skill_outline_disabled_fallback():
    res = resolve_skill_entry("story-anime", outline_enabled=False)
    assert res.start_agent == "plan"
    assert res.start_stage == "plan_characters"


def test_resolve_unknown_skill_defaults():
    res = resolve_skill_entry(None, outline_enabled=True)
    assert res.skill is None
    assert res.start_agent == "outline"


def test_skill_payload_and_create_defaults():
    payload = skill_payload("character-design")
    assert payload is not None
    assert payload["id"] == "character-design"
    assert "directives" in payload
    assert payload["pipeline_hints"]["prioritize"] == "characters"
    assert payload.get("story_template")

    defaults = apply_skill_defaults_to_create(
        skill_id="quick-short",
        story=None,
        style=None,
        target_shot_count=None,
        creation_mode=None,
    )
    assert defaults["skill_id"] == "quick-short"
    assert defaults["style"] == "anime"
    assert defaults["target_shot_count"] == 5
    assert defaults["creation_mode"] == "quick"


def test_create_defaults_use_story_template():
    defaults = apply_skill_defaults_to_create(
        skill_id="story-anime",
        story=None,
        style=None,
        target_shot_count=None,
        creation_mode=None,
    )
    assert defaults["story"]
    assert "主角" in defaults["story"] or "目标" in defaults["story"]

    quick = apply_skill_defaults_to_create(
        skill_id="quick-short",
        story=None,
        style=None,
        target_shot_count=None,
        creation_mode=None,
    )
    assert quick["story"]
    assert "点子" in quick["story"] or "冲突" in quick["story"]


def test_resolve_project_skill_id_prefers_request():
    assert (
        resolve_project_skill_id(
            request_skill_id="quick-short",
            project_skill_id="story-anime",
        )
        == "quick-short"
    )
    assert (
        resolve_project_skill_id(
            request_skill_id=None,
            project_skill_id="character-design",
        )
        == "character-design"
    )


def test_gate_name_from_interrupt():
    class FakeInterrupt:
        value = {"gate": "outline_approval", "message": "ok"}

    assert gate_name_from_interrupt(FakeInterrupt()) == "outline_approval"


@pytest.mark.asyncio
async def test_drive_graph_until_idle_interrupt_loop():
    calls = {"n": 0}

    class FakeGraph:
        async def ainvoke(self, payload, config, context=None):
            calls["n"] += 1
            if calls["n"] == 1:
                class Interrupt:
                    value = {"gate": "characters_approval"}

                return {
                    "current_stage": "characters_approval",
                    "__interrupt__": [Interrupt()],
                }
            return {"current_stage": "compose_merge", "video_generation_skipped": False}

    async def on_interrupt(item):
        return {"action": "approve", "feedback": ""}

    result = await drive_graph_until_idle(
        FakeGraph(),
        initial_payload={"route_stage": "plan_characters"},
        graph_config={"configurable": {"thread_id": "t1"}},
        runtime_context=None,
        on_interrupt=on_interrupt,
        run_id=1,
    )
    assert result.final_stage == "compose_merge"
    assert result.interrupt_count == 1
    assert calls["n"] == 2
