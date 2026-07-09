from __future__ import annotations

from typing import Any

from app.agents.base import AgentContext, BaseAgent, TargetIds
from app.services.creative_control import infer_feedback_targets

ALLOWED_START_AGENTS = {"outline", "plan", "render", "compose"}

_FEEDBACK_TYPE_MAP = {
    "outline": "outline",
    "story_outline": "outline",
    "plan": "plan",
    "story": "plan",
    "script": "plan",
    "global": "plan",
    "render": "render",
    "character": "render",
    "shot": "render",
    "storyboard": "render",
    "compose": "compose",
    "video": "compose",
    "merge": "compose",
}

_RETRY_MERGE_KEYWORDS = (
    "retry merge",
    "重试合成",
    "重新合成",
    "重新拼接最终视频",
    "重新合并最终视频",
    "final-output",
)


def _is_retry_merge_feedback(feedback: str) -> bool:
    normalized = feedback.strip().lower()
    return any(keyword in normalized for keyword in _RETRY_MERGE_KEYWORDS)


_FULL_RESTART_KEYWORDS = (
    "重做",
    "全部重新",
    "推倒重来",
    "从头开始",
    "完全重新",
    "redo all",
    "restart from scratch",
    "regenerate all",
    "full restart",
    "全部推翻",
)


def _is_full_restart_feedback(feedback: str) -> bool:
    normalized = feedback.strip().lower()
    return any(kw in normalized for kw in _FULL_RESTART_KEYWORDS)


def _decide_mode(feedback_type: str, feedback: str) -> str:
    if _is_full_restart_feedback(feedback):
        return "full"
    return "incremental"


# Text / structure edits → replan the entity, then continue pipeline
_PLAN_ENTITY_KEYWORDS = (
    "对白",
    "台词",
    "旁白",
    "改描述",
    "改场景",
    "改动作",
    "改剧情",
    "改设定",
    "改人设",
    "改名字",
    "改名为",
    "重写",
    "改成",
    "dialogue",
    "description",
    "rewrite",
    "rename",
    "change the line",
    "change dialogue",
    "change scene",
    "change action",
    "update description",
)

# Explicit video / motion intent
_COMPOSE_ENTITY_KEYWORDS = (
    "重做视频",
    "重新生成视频",
    "视频太",
    "运镜",
    "时长",
    "动起来",
    "动作幅度",
    "redo video",
    "regenerate video",
    "camera move",
    "motion",
    "duration",
)

# Visual / still image intent
_RENDER_ENTITY_KEYWORDS = (
    "重画",
    "重做图",
    "重新画",
    "画面",
    "首帧",
    "换色",
    "颜色",
    "光影",
    "灯光",
    "夜景",
    "白天",
    "风格",
    "脸",
    "发型",
    "服装",
    "redraw",
    "recolor",
    "lighting",
    "night",
    "daytime",
    "outfit",
    "face",
    "hair",
    "image",
)


def _feedback_mentions(feedback: str, keywords: tuple[str, ...]) -> bool:
    text = feedback.strip().lower()
    if not text:
        return False
    return any(kw.lower() in text for kw in keywords)


def resolve_entity_start_agent(entity_type: str, feedback: str) -> str:
    """Choose plan / render / compose for a selected entity based on feedback text."""
    et = (entity_type or "").strip().lower()
    if et == "video":
        return "compose"
    if _feedback_mentions(feedback, _PLAN_ENTITY_KEYWORDS):
        return "plan"
    if _feedback_mentions(feedback, _COMPOSE_ENTITY_KEYWORDS):
        return "compose"
    if _feedback_mentions(feedback, _RENDER_ENTITY_KEYWORDS):
        return "render"
    # Default: still-image re-render is the most common selection action
    if et in {"character", "shot"}:
        return "render"
    return "plan"


def _entity_target_ids(entity_type: str, entity_id: int) -> TargetIds:
    """Build explicit target set for a canvas-selected entity."""
    if entity_type == "character":
        return TargetIds(character_ids=[entity_id], shot_ids=[])
    if entity_type in {"shot", "video"}:
        return TargetIds(character_ids=[], shot_ids=[entity_id])
    return TargetIds()


class ReviewRuleEngine(BaseAgent):
    name = "review"

    async def run(self, ctx: AgentContext) -> Any:
        feedback = ""
        if hasattr(ctx, "user_feedback") and ctx.user_feedback:
            feedback = ctx.user_feedback.strip()

        if not feedback:
            await self.send_message(ctx, "未找到用户反馈内容，将从规划阶段重新开始。")
            return {"start_agent": "plan", "mode": "full", "reason": "未提供具体反馈"}

        if ctx.entity_type and ctx.entity_id:
            start_agent = resolve_entity_start_agent(ctx.entity_type, feedback)
            mode = "incremental"
            if _is_full_restart_feedback(feedback):
                mode = "full"
            target_ids = _entity_target_ids(ctx.entity_type, ctx.entity_id)

            if ctx.entity_type == "character":
                entity_desc = f"角色#{ctx.entity_id}"
            elif ctx.entity_type == "video":
                entity_desc = f"分镜视频#{ctx.entity_id}"
            else:
                entity_desc = f"分镜#{ctx.entity_id}"

            stage_label = {
                "plan": "规划文案",
                "render": "重绘画面",
                "compose": "重做视频",
            }.get(start_agent, start_agent)
            await self.send_message(
                ctx,
                f"将对{entity_desc}进行增量更新（{stage_label}）。",
                summary=f"更新{entity_desc}",
            )
            # Help plan/render agents know which entity the user selected
            focus_prefix = f"[focus:{ctx.entity_type}:{ctx.entity_id}] "
            if not feedback.startswith("[focus:"):
                ctx.user_feedback = f"{focus_prefix}{feedback}"
            return {
                "start_agent": start_agent,
                "mode": mode,
                "reason": f"per-entity: {ctx.entity_type}#{ctx.entity_id} → {start_agent}",
                "target_ids": target_ids,
            }

        retry_merge_requested = _is_retry_merge_feedback(feedback)

        feedback_type = ctx.feedback_type or "plan"
        start_agent = _FEEDBACK_TYPE_MAP.get(feedback_type, "plan")

        mode = _decide_mode(feedback_type, feedback)

        target_ids = infer_feedback_targets(
            {"routing": {"start_agent": start_agent, "mode": mode}},
            {"project_id": ctx.project.id},
        )

        if retry_merge_requested:
            start_agent = "compose"
            mode = "incremental"

        if start_agent not in ALLOWED_START_AGENTS:
            start_agent = "plan"

        mode_desc = "增量更新" if mode == "incremental" else "重新生成"
        target_info = ""
        if target_ids and target_ids.has_targets():
            parts = []
            if target_ids.character_ids:
                parts.append(f"{len(target_ids.character_ids)} 个角色")
            if target_ids.shot_ids:
                parts.append(f"{len(target_ids.shot_ids)} 个分镜")
            target_info = f"（仅处理 {', '.join(parts)}）"

        await self.send_message(
            ctx,
            f"已收到反馈。将从 {start_agent} 阶段开始{mode_desc}{target_info}。",
            summary="已收到反馈",
        )

        return {
            "start_agent": start_agent,
            "mode": mode,
            "reason": f"feedback_type={feedback_type}",
            "target_ids": target_ids,
        }
