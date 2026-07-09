"""Skill catalog HTTP API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.skills.catalog import get_skill, list_skills

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillRead(BaseModel):
    id: str
    title: str
    description: str
    badge: str | None = None
    start_stage: str
    start_agent: str
    prefer_auto_mode: bool
    default_style: str | None = None
    default_creation_mode: str | None = None
    default_target_shot_count: int | None = None
    story_prefix: str = ""
    story_template: str = ""
    directives: str = ""
    pipeline_hints: dict[str, Any] = Field(default_factory=dict)
    placeholder: str = ""
    available: bool = True


def _skill_read(skill) -> SkillRead:
    return SkillRead(
        id=skill.id,
        title=skill.title,
        description=skill.description,
        badge=skill.badge,
        start_stage=skill.start_stage,
        start_agent=skill.start_agent,
        prefer_auto_mode=skill.prefer_auto_mode,
        default_style=skill.default_style,
        default_creation_mode=skill.default_creation_mode,
        default_target_shot_count=skill.default_target_shot_count,
        story_prefix=skill.story_prefix,
        story_template=getattr(skill, "story_template", "") or "",
        directives=skill.directives,
        pipeline_hints=dict(skill.pipeline_hints),
        placeholder=skill.placeholder,
        available=skill.available,
    )


@router.get("", response_model=list[SkillRead])
async def get_skills() -> list[SkillRead]:
    return [_skill_read(s) for s in list_skills()]


@router.get("/{skill_id}", response_model=SkillRead)
async def get_skill_by_id(skill_id: str) -> SkillRead:
    skill = get_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return _skill_read(skill)
