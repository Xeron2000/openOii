from __future__ import annotations

import json
from typing import Any

from app.agents.base import AgentContext, BaseAgent, CompletionInfo
from app.agents.prompts.outline import SYSTEM_PROMPT
from app.agents.utils import extract_json
from app.db.utils import utcnow


def _clean_outline(data: dict[str, Any]) -> dict[str, Any]:
    outline = data.get("story_outline")
    if not isinstance(outline, dict):
        outline = {}

    acts = outline.get("acts")
    if not isinstance(acts, list):
        acts = []
    normalized_acts: list[dict[str, Any]] = []
    for idx, act in enumerate(acts[:3], start=1):
        if not isinstance(act, dict):
            continue
        normalized_acts.append(
            {
                "act": act.get("act") if isinstance(act.get("act"), int) else idx,
                "title": str(act.get("title") or f"第{idx}幕"),
                "summary": str(act.get("summary") or ""),
            }
        )

    return {
        "logline": str(outline.get("logline") or ""),
        "genre": [item for item in outline.get("genre") or [] if isinstance(item, str)],
        "themes": [item for item in outline.get("themes") or [] if isinstance(item, str)],
        "setting": str(outline.get("setting") or ""),
        "tone": str(outline.get("tone") or ""),
        "acts": normalized_acts,
        "emotional_arc": str(outline.get("emotional_arc") or ""),
    }


class OutlineAgent(BaseAgent):
    name = "outline"

    async def run_outline(self, ctx: AgentContext) -> None:
        await self.send_message(ctx, "正在生成故事大纲...", progress=0.0, is_loading=True)
        await self.send_thinking(
            ctx,
            phase="planning",
            content="正在提炼故事核心、三幕结构和视觉方向...",
        )

        from app.skills.catalog import get_skill
        from app.skills.context import skill_payload, skill_system_appendix

        payload: dict[str, Any] = {
            "project": {
                "id": ctx.project.id,
                "title": ctx.project.title,
                "story": ctx.project.story,
                "style": ctx.project.style,
                "skill_id": getattr(ctx, "skill_id", None)
                or getattr(ctx.project, "skill_id", None),
                "target_shot_count": getattr(ctx.project, "target_shot_count", None),
            }
        }
        if ctx.user_feedback:
            payload["user_feedback"] = ctx.user_feedback
        skill_id = payload["project"]["skill_id"]
        skill_obj = skill_payload(skill_id)
        if skill_obj:
            payload["skill"] = skill_obj
        try:
            from app.services.universe_context import build_universe_context

            universe_ctx = await build_universe_context(
                ctx.session, ctx.project, include_siblings=True
            )
            if universe_ctx:
                payload["universe_context"] = universe_ctx
        except Exception:
            pass

        system = SYSTEM_PROMPT + skill_system_appendix(get_skill(skill_id))
        resp = await self.call_llm(
            ctx,
            system_prompt=system,
            user_prompt=json.dumps(payload, ensure_ascii=False),
            max_tokens=2048,
        )
        data = extract_json(resp.text)
        outline = _clean_outline(data)
        visual_bible = data.get("visual_bible") if isinstance(data.get("visual_bible"), str) else ""
        user_message = data.get("user_message") if isinstance(data.get("user_message"), str) else ""
        project_update = data.get("project_update") if isinstance(data.get("project_update"), dict) else {}

        ctx.project.story_outline = dict(outline)
        ctx.project.visual_bible = visual_bible.strip() or None
        ctx.project.outline_approved = False
        updated_fields: dict[str, Any] = {
            "story_outline": outline,
            "visual_bible": ctx.project.visual_bible,
            "outline_approved": False,
        }
        for key in ("title", "summary"):
            value = project_update.get(key)
            if isinstance(value, str) and value.strip():
                setattr(ctx.project, key, value.strip())
                updated_fields[key] = value.strip()
        if not ctx.project.summary and outline.get("logline"):
            ctx.project.summary = str(outline["logline"])
            updated_fields["summary"] = ctx.project.summary
        ctx.project.status = "planning"
        ctx.project.updated_at = utcnow()
        updated_fields["status"] = ctx.project.status
        ctx.session.add(ctx.project)
        await ctx.session.commit()
        await ctx.session.refresh(ctx.project)

        await ctx.ws.send_event(
            ctx.project.id,
            {
                "type": "project_updated",
                "data": {"project": {"id": ctx.project.id, **updated_fields}},
            },
        )

        await self.send_thinking(
            ctx,
            phase="decision",
            content=f"大纲已形成：{outline.get('logline', '')[:80]}",
            details=f"三幕数量：{len(outline.get('acts') or [])}，风格：{ctx.project.style or '未指定'}",
        )
        ctx.completion_info = CompletionInfo(
            completed=user_message or "故事大纲已生成",
            details=f"一句话故事：{outline.get('logline') or '已完成'}",
            next="确认后将进入角色设计",
            question="大纲方向是否满意？",
        )
        await self.send_message(
            ctx,
            user_message or str(outline.get("logline") or "大纲已生成"),
            summary=str(outline.get("logline") or "故事大纲"),
            progress=1.0,
        )

    async def run(self, ctx: AgentContext) -> None:
        await self.run_outline(ctx)
