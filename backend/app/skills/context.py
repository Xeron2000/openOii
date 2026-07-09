"""Skill payload builders for agent LLM context."""

from __future__ import annotations

from typing import Any

from app.skills.catalog import SkillDefinition, get_skill


def skill_payload(skill_id: str | None) -> dict[str, Any] | None:
    """Build the `skill` object injected into outline/plan LLM payloads."""
    skill = get_skill(skill_id)
    if skill is None:
        return None
    return {
        "id": skill.id,
        "title": skill.title,
        "description": skill.description,
        "directives": skill.directives,
        "pipeline_hints": dict(skill.pipeline_hints),
        "start_stage": skill.start_stage,
        "start_agent": skill.start_agent,
        "prefer_auto_mode": skill.prefer_auto_mode,
        "default_target_shot_count": skill.default_target_shot_count,
        "default_style": skill.default_style,
        "story_template": skill.story_template,
    }


def resolve_project_skill_id(
    *,
    request_skill_id: str | None,
    project_skill_id: str | None,
) -> str | None:
    """Prefer request override, else durable project skill."""
    if request_skill_id and str(request_skill_id).strip():
        return str(request_skill_id).strip()
    if project_skill_id and str(project_skill_id).strip():
        return str(project_skill_id).strip()
    return None


def apply_skill_defaults_to_create(
    *,
    skill_id: str | None,
    story: str | None,
    style: str | None,
    target_shot_count: int | None,
    creation_mode: str | None,
) -> dict[str, Any]:
    """Resolve create-time fields from skill when user left them empty."""
    skill = get_skill(skill_id)
    resolved_story = (story or "").strip() or None
    resolved_style = (style or "").strip() or None
    resolved_shots = target_shot_count
    resolved_mode = (creation_mode or "").strip() or None

    if skill is None:
        return {
            "skill_id": None,
            "story": resolved_story,
            "style": resolved_style or "anime",
            "target_shot_count": resolved_shots,
            "creation_mode": resolved_mode,
        }

    if not resolved_story:
        if skill.story_template.strip():
            resolved_story = skill.story_template.strip() + "\n"
        elif skill.story_prefix:
            resolved_story = skill.story_prefix.rstrip() + "\n"
    if not resolved_style and skill.default_style:
        resolved_style = skill.default_style
    if resolved_shots is None and skill.default_target_shot_count is not None:
        resolved_shots = skill.default_target_shot_count
    if not resolved_mode and skill.default_creation_mode:
        resolved_mode = skill.default_creation_mode

    return {
        "skill_id": skill.id,
        "story": resolved_story,
        "style": resolved_style or "anime",
        "target_shot_count": resolved_shots,
        "creation_mode": resolved_mode,
    }


def skill_system_appendix(skill: SkillDefinition | None) -> str:
    if skill is None or not skill.directives.strip():
        return ""
    hints = skill.pipeline_hints
    hint_lines = "\n".join(f"- {k}: {v}" for k, v in hints.items()) if hints else "- (none)"
    return (
        f"\n\n## Active Skill / 当前 Skill\n"
        f"- id: {skill.id}\n"
        f"- title: {skill.title}\n"
        f"### Directives (MUST follow)\n{skill.directives.strip()}\n"
        f"### Pipeline hints\n{hint_lines}\n"
    )
