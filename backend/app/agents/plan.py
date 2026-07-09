from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select, delete

from app.agents.base import AgentContext, BaseAgent, CompletionInfo
from app.agents.prompts.plan import SYSTEM_PROMPT
from app.agents.utils import extract_json
from app.db.utils import utcnow
from app.models.project import Character, Shot
from app.services.version_service import VersionService, character_snapshot, shot_snapshot

logger = logging.getLogger(__name__)


def _outline_context(project: Any) -> dict[str, Any] | None:
    if not getattr(project, "outline_approved", False):
        return None
    outline = getattr(project, "story_outline", None)
    if not isinstance(outline, dict) or not outline:
        return None
    return {
        "story_outline": outline,
        "visual_bible": getattr(project, "visual_bible", None),
        "summary": getattr(project, "summary", None),
    }


def _characters_context(characters: list[Character]) -> list[dict[str, Any]]:
    return [
        {
            "id": character.id,
            "name": character.name,
            "description": character.description,
            "visual_notes": character.visual_notes,
        }
        for character in characters
    ]


def _character_to_description(item: dict) -> str:
    parts: list[str] = []
    for key in ["personality_traits", "goals", "fears", "voice_notes", "costume_notes"]:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(f"{key}: {value.strip()}")
        elif isinstance(value, list):
            vals = [v for v in value if isinstance(v, str) and v.strip()]
            if vals:
                parts.append(f"{key}: {', '.join(vals)}")

    description = item.get("description")
    if isinstance(description, str) and description.strip():
        parts.insert(0, description.strip())

    return "\n".join(parts) if parts else json.dumps(item, ensure_ascii=False)


def _extract_visual_notes(item: dict) -> str | None:
    """Extract visual_notes from the plan LLM output for a character."""
    vn = item.get("visual_notes")
    if isinstance(vn, str) and vn.strip():
        return vn.strip()
    return None


def _compose_image_prompt(shot_data: dict, visual_bible: str) -> str:
    if isinstance(shot_data.get("image_prompt"), str) and shot_data["image_prompt"].strip():
        return shot_data["image_prompt"].strip()  # type: ignore[no-any-return]

    parts = []
    scene = shot_data.get("scene")
    if isinstance(scene, str) and scene.strip():
        parts.append(scene.strip())
    action = shot_data.get("action")
    if isinstance(action, str) and action.strip():
        parts.append(action.strip())
    expression = shot_data.get("expression")
    if isinstance(expression, str) and expression.strip():
        parts.append(expression.strip())
    camera = shot_data.get("camera")
    if isinstance(camera, str) and camera.strip():
        parts.append(camera.strip())
    lighting = shot_data.get("lighting")
    if isinstance(lighting, str) and lighting.strip():
        parts.append(lighting.strip())

    if parts:
        composed = "，".join(parts)
        if visual_bible:
            composed = f"{composed}。{visual_bible}"
        return composed

    return shot_data.get("description", "")  # type: ignore[no-any-return]


def _compose_video_prompt(shot_data: dict) -> str:
    if isinstance(shot_data.get("video_prompt"), str) and shot_data["video_prompt"].strip():
        return shot_data["video_prompt"].strip()  # type: ignore[no-any-return]

    parts = []
    camera = shot_data.get("camera")
    if isinstance(camera, str) and camera.strip():
        parts.append(camera.strip())
    action = shot_data.get("action")
    if isinstance(action, str) and action.strip():
        parts.append(action.strip())

    if parts:
        return "，".join(parts)

    return shot_data.get("description", "")  # type: ignore[no-any-return]


def _optional_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    return None


def _resolve_shot_character_ids(shot_data: dict, characters: list[Character]) -> list[int]:
    valid_ids = {character.id for character in characters if character.id is not None}
    raw_ids = shot_data.get("character_ids")
    if isinstance(raw_ids, list):
        ids = [int(value) for value in raw_ids if isinstance(value, int) and value in valid_ids]
        if ids:
            return list(dict.fromkeys(ids))

    names = shot_data.get("characters") or shot_data.get("character_names")
    if isinstance(names, list):
        normalized = {
            name.strip().lower() for name in names if isinstance(name, str) and name.strip()
        }
        ids = [
            character.id
            for character in characters
            if character.id is not None and character.name.strip().lower() in normalized
        ]
        if ids:
            return ids

    text = " ".join(
        value
        for value in (
            shot_data.get("description"),
            shot_data.get("action"),
            shot_data.get("dialogue"),
        )
        if isinstance(value, str)
    )
    mentioned = [
        character.id
        for character in characters
        if character.id is not None and character.name and character.name in text
    ]
    if mentioned:
        return mentioned

    return [character.id for character in characters if character.id is not None]


def _shot_fields(
    ctx: AgentContext, shot_data: dict, visual_bible: str, characters: list[Character]
) -> dict[str, Any]:
    image_prompt = _compose_image_prompt(shot_data, visual_bible)
    video_prompt = _compose_video_prompt(shot_data)
    motion_note = _optional_text(shot_data.get("motion_note")) or video_prompt
    return {
        "project_id": ctx.project.id,
        "description": str(shot_data["description"]).strip(),
        "prompt": video_prompt,
        "image_prompt": image_prompt,
        "duration": _optional_float(shot_data.get("duration")),
        "camera": _optional_text(shot_data.get("camera")) or "中景",
        "motion_note": motion_note,
        "scene": shot_data.get("scene"),
        "action": shot_data.get("action"),
        "expression": shot_data.get("expression"),
        "lighting": shot_data.get("lighting"),
        "dialogue": shot_data.get("dialogue"),
        "sfx": shot_data.get("sfx"),
        "character_ids": _resolve_shot_character_ids(shot_data, characters),
        "video_url": None,
        "image_url": None,
    }


class PlanAgent(BaseAgent):
    name = "plan"

    def __init__(self):
        super().__init__()
        self.version_service = VersionService()

    async def _get_universe_context(self, ctx: AgentContext) -> dict | None:
        """If project belongs to a universe, return universe context for LLM."""
        if not getattr(ctx.project, "universe_id", None):
            return None
        try:
            from app.models.universe import Universe
            from app.services.universe_service import UniverseService

            universe = await ctx.session.get(Universe, ctx.project.universe_id)
            if not universe:
                return None

            svc = UniverseService(ctx.session)
            shared_chars = await svc.get_universe_shared_characters(universe.id)

            result: dict[str, Any] = {
                "universe_name": universe.name,
                "universe_id": universe.id,
            }
            if universe.world_setting:
                result["world_setting"] = universe.world_setting
            if universe.style_rules:
                result["style_rules"] = universe.style_rules
            if shared_chars:
                result["shared_characters"] = [
                    {
                        "name": sc.name,
                        "description": sc.description,
                        "visual_notes": sc.visual_notes,
                        "canonical_image_url": sc.canonical_image_url,
                        "tags": sc.character_tags,
                    }
                    for sc in shared_chars
                ]
            return result
        except Exception:
            return None

    async def _get_existing_state(self, ctx: AgentContext) -> dict[str, Any]:
        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        characters = [
            {"id": c.id, "name": c.name, "description": c.description}
            for c in char_res.scalars().all()
        ]

        shot_res = await ctx.session.execute(
            select(Shot).where(Shot.project_id == ctx.project.id).order_by(Shot.order)
        )
        shots = [
            {
                "id": s.id,
                "order": s.order,
                "description": s.description,
                "scene": s.scene,
                "action": s.action,
                "expression": s.expression,
                "camera": s.camera,
                "lighting": s.lighting,
                "dialogue": s.dialogue,
                "sfx": s.sfx,
            }
            for s in shot_res.scalars().all()
        ]

        return {"characters": characters, "shots": shots}

    async def _apply_incremental_changes(
        self, ctx: AgentContext, data: dict, visual_bible: str
    ) -> tuple[int, int]:
        preserve_ids = data.get("preserve_ids") or {}
        preserve_char_ids = set(preserve_ids.get("characters") or [])
        preserve_shot_ids = set(preserve_ids.get("shots") or [])

        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        deleted_char_ids = []
        for char in char_res.scalars().all():
            if char.id not in preserve_char_ids:
                deleted_char_ids.append(char.id)
                await ctx.session.delete(char)

        deleted_shot_ids = []
        shot_res = await ctx.session.execute(select(Shot).where(Shot.project_id == ctx.project.id))
        for shot in shot_res.scalars().all():
            if shot.id not in preserve_shot_ids:
                deleted_shot_ids.append(shot.id)
                await ctx.session.delete(shot)

        await ctx.session.flush()

        for char_id in deleted_char_ids:
            await ctx.ws.send_event(
                ctx.project.id,
                {"type": "character_deleted", "data": {"character_id": char_id}},
            )
        for shot_id in deleted_shot_ids:
            await ctx.ws.send_event(
                ctx.project.id,
                {"type": "shot_deleted", "data": {"shot_id": shot_id}},
            )

        new_char_count = 0
        raw_characters = data.get("characters") or []
        if isinstance(raw_characters, list):
            for item in raw_characters:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not (isinstance(name, str) and name.strip()):
                    continue
                char_id = item.get("id")
                if char_id is None:
                    new_char = Character(
                        project_id=ctx.project.id,
                        name=name.strip(),
                        description=_character_to_description(item),
                        visual_notes=_extract_visual_notes(item),
                        image_url=None,
                    )
                    ctx.session.add(new_char)
                    new_char_count += 1
                else:
                    existing_char = await ctx.session.get(Character, char_id)
                    if existing_char and existing_char.project_id == ctx.project.id:
                        version = await self.version_service.auto_snapshot_character(
                            ctx.session,
                            existing_char,
                            run_id=ctx.run.id,
                            trigger="feedback",
                        )
                        if version is not None:
                            await ctx.ws.send_event(
                                ctx.project.id,
                                {
                                    "type": "version_created",
                                    "data": {
                                        "entity_type": "character",
                                        "entity_id": existing_char.id,
                                        "version": version.version,
                                        "trigger": version.trigger,
                                    },
                                },
                            )
                        existing_char.name = name.strip()
                        existing_char.description = _character_to_description(item)
                        vn = _extract_visual_notes(item)
                        if vn is not None:
                            existing_char.visual_notes = vn
                        ctx.session.add(existing_char)
                        await ctx.session.flush()
                        current_version = await self.version_service.create_version(
                            ctx.session,
                            "character",
                            existing_char.id,
                            character_snapshot(existing_char),
                            run_id=ctx.run.id,
                            trigger="feedback",
                        )
                        await ctx.ws.send_event(
                            ctx.project.id,
                            {
                                "type": "version_created",
                                "data": {
                                    "entity_type": "character",
                                    "entity_id": existing_char.id,
                                    "version": current_version.version,
                                    "trigger": current_version.trigger,
                                },
                            },
                        )

        await ctx.session.flush()

        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        project_characters = list(char_res.scalars().all())

        new_shot_count = 0
        raw_shots = data.get("shots") or []
        if isinstance(raw_shots, list):
            for idx, shot_data in enumerate(raw_shots):
                if not isinstance(shot_data, dict):
                    continue
                shot_id = shot_data.get("id")
                shot_desc = shot_data.get("description")
                if not (isinstance(shot_desc, str) and shot_desc.strip()):
                    continue
                shot_order = (
                    shot_data.get("order") if isinstance(shot_data.get("order"), int) else idx + 1
                )
                fields = _shot_fields(ctx, shot_data, visual_bible, project_characters)

                if shot_id is None:
                    new_shot = Shot(
                        order=shot_order,
                        **fields,
                    )
                    ctx.session.add(new_shot)
                    new_shot_count += 1
                else:
                    existing_shot = await ctx.session.get(Shot, shot_id)
                    if existing_shot and existing_shot.project_id == ctx.project.id:
                        version = await self.version_service.auto_snapshot_shot(
                            ctx.session,
                            existing_shot,
                            run_id=ctx.run.id,
                            trigger="feedback",
                        )
                        if version is not None:
                            await ctx.ws.send_event(
                                ctx.project.id,
                                {
                                    "type": "version_created",
                                    "data": {
                                        "entity_type": "shot",
                                        "entity_id": existing_shot.id,
                                        "version": version.version,
                                        "trigger": version.trigger,
                                    },
                                },
                            )
                        existing_shot.order = shot_order  # type: ignore[assignment]
                        for key, value in fields.items():
                            if key not in {"project_id", "video_url", "image_url"}:
                                setattr(existing_shot, key, value)
                        ctx.session.add(existing_shot)
                        await ctx.session.flush()
                        current_version = await self.version_service.create_version(
                            ctx.session,
                            "shot",
                            existing_shot.id,
                            shot_snapshot(existing_shot),
                            run_id=ctx.run.id,
                            trigger="feedback",
                        )
                        await ctx.ws.send_event(
                            ctx.project.id,
                            {
                                "type": "version_created",
                                "data": {
                                    "entity_type": "shot",
                                    "entity_id": existing_shot.id,
                                    "version": current_version.version,
                                    "trigger": current_version.trigger,
                                },
                            },
                        )

        await ctx.session.flush()
        return new_char_count, new_shot_count

    async def _call_plan_llm(
        self,
        ctx: AgentContext,
        *,
        task: str,
        characters: list[Character] | None = None,
    ) -> dict[str, Any]:
        """Call LLM for one planning sub-task and cache the result in ctx."""
        is_incremental = ctx.rerun_mode == "incremental"
        from app.skills.catalog import get_skill
        from app.skills.context import skill_payload, skill_system_appendix

        skill_id = getattr(ctx, "skill_id", None) or getattr(ctx.project, "skill_id", None)
        payload: dict[str, Any] = {
            "project": {
                "id": ctx.project.id,
                "title": ctx.project.title,
                "story": ctx.project.story,
                "style": ctx.project.style,
                "status": ctx.project.status,
                "target_shot_count": getattr(ctx.project, "target_shot_count", None),
                "character_hints": getattr(ctx.project, "character_hints", None) or None,
                "skill_id": skill_id,
            },
            "mode": ctx.rerun_mode,
            "task": task,
        }
        outline_context = _outline_context(ctx.project)
        if outline_context is not None:
            payload["approved_outline"] = outline_context
        if characters is not None:
            payload["approved_characters"] = _characters_context(characters)
        if ctx.user_feedback:
            payload["user_feedback"] = ctx.user_feedback
        skill_obj = skill_payload(skill_id)
        if skill_obj:
            payload["skill"] = skill_obj
        reimagine_meta = getattr(ctx.project, "reimagine_meta", None)
        if isinstance(reimagine_meta, dict) and reimagine_meta:
            payload["reimagine_meta"] = reimagine_meta
        if ctx.entity_type and ctx.entity_id is not None:
            payload["focus_entity"] = {
                "type": ctx.entity_type,
                "id": ctx.entity_id,
            }
            # Bias incremental preserve_ids toward the focused entity
            if is_incremental and ctx.target_ids:
                payload["preserve_hint"] = {
                    "characters": list(ctx.target_ids.character_ids or []),
                    "shots": list(ctx.target_ids.shot_ids or []),
                }

        # Inject universe context if project belongs to a universe
        universe_info = await self._get_universe_context(ctx)
        if universe_info:
            payload["universe_context"] = universe_info

        if is_incremental:
            existing_state = await self._get_existing_state(ctx)
            payload["existing_state"] = existing_state

        user_prompt = json.dumps(payload, ensure_ascii=False)
        system = SYSTEM_PROMPT + skill_system_appendix(get_skill(skill_id))
        resp = await self.call_llm(
            ctx, system_prompt=system, user_prompt=user_prompt, max_tokens=4096
        )
        data = extract_json(resp.text)

        project_update = data.get("project_update") or {}
        updated_fields: dict = {}
        if isinstance(project_update, dict):
            for key in ("title", "style", "status", "summary"):
                val = project_update.get(key)
                if isinstance(val, str) and val.strip():
                    if key == "style" and getattr(ctx.project, "style", None):
                        continue
                    setattr(ctx.project, key, val.strip())
                    updated_fields[key] = val.strip()

        if "status" not in updated_fields:
            ctx.project.status = "planning"
            updated_fields["status"] = ctx.project.status

        ctx.project.updated_at = utcnow()
        ctx.session.add(ctx.project)
        await ctx.session.commit()

        if updated_fields:
            await ctx.ws.send_event(
                ctx.project.id,
                {
                    "type": "project_updated",
                    "data": {"project": {"id": ctx.project.id, **updated_fields}},
                },
            )

        ctx.plan_data = data
        return data

    async def run_characters(self, ctx: AgentContext) -> None:
        is_incremental = ctx.rerun_mode == "incremental"
        if is_incremental:
            await self.send_message(ctx, "正在增量更新角色...", progress=0.0, is_loading=True)
        else:
            await self.send_message(ctx, "正在规划角色设定...", progress=0.0, is_loading=True)

        # Auto-import shared characters from universe if project belongs to one
        if getattr(ctx.project, "universe_id", None) and not is_incremental:
            try:
                from app.services.universe_service import UniverseService

                svc = UniverseService(ctx.session)
                imported = await svc.auto_import_shared_characters(ctx.project.id)
                if imported:
                    for char in imported:
                        await self.send_character_event(ctx, char, "character_created")
                    await self.send_thinking(
                        ctx,
                        phase="planning",
                        content=f"已从宇宙导入 {len(imported)} 个共享角色：{', '.join(c.name for c in imported)}",
                    )
            except Exception as e:
                logger.warning("Failed to auto-import shared characters: %s", e)

        # Thinking: planning phase — before LLM call
        await self.send_thinking(
            ctx,
            phase="planning",
            content="正在根据已确认大纲规划角色设定...",
        )

        data = await self._call_plan_llm(ctx, task="characters")
        user_message = data.get("user_message") or ""

        # Thinking: decision phase — after LLM returns
        raw_characters = data.get("characters") or []
        char_count = len(raw_characters) if isinstance(raw_characters, list) else 0
        core_idea = user_message or ctx.project.summary or ""
        await self.send_thinking(
            ctx,
            phase="decision",
            content=f"已规划 {char_count} 个角色。核心创意：{core_idea[:80]}",
            details=f"故事风格：{ctx.project.style or '未指定'}",
        )

        if is_incremental:
            visual_bible = data.get("visual_bible") or ""
            new_char_count, _ = await self._apply_incremental_changes(ctx, data, visual_bible)

            char_res = await ctx.session.execute(
                select(Character).where(Character.project_id == ctx.project.id)
            )
            final_chars = list(char_res.scalars().all())
            for char in final_chars:
                await self.send_character_event(ctx, char, "character_updated")

            ctx.completion_info = CompletionInfo(
                completed=user_message or "角色增量更新完成",
                details=f"更新后共 {len(final_chars)} 个角色",
                next="接下来生成分镜脚本",
                question="角色设定是否满意？",
            )
            await self.send_message(
                ctx,
                user_message or f"角色更新完成（{len(final_chars)} 个）",
                summary=f"{len(final_chars)} 个角色",
                progress=1.0,
            )
            return

        raw_characters = data.get("characters") or []
        lines: list[str] = []
        await ctx.session.execute(delete(Character).where(Character.project_id == ctx.project.id))
        await ctx.session.flush()

        new_characters: list[Character] = []
        if isinstance(raw_characters, list) and raw_characters:
            char_names: list[str] = []
            for item in raw_characters:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not (isinstance(name, str) and name.strip()):
                    continue
                char_names.append(name.strip())
                new_characters.append(
                    Character(
                        project_id=ctx.project.id,
                        name=name.strip(),
                        description=_character_to_description(item),
                        visual_notes=_extract_visual_notes(item),
                        image_url=None,
                    )
                )
            if new_characters:
                ctx.session.add_all(new_characters)
                await ctx.session.flush()
                for character in new_characters:
                    await self.send_character_event(ctx, character, "character_created")
                lines.append(f"角色：{', '.join(char_names)}")

        ctx.completion_info = CompletionInfo(
            completed=user_message or "角色设定已生成",
            details=f"共 {len(new_characters) if isinstance(raw_characters, list) else 0} 个角色",
            next="接下来生成分镜脚本",
            question="角色设定是否满意？",
        )
        await self.send_message(
            ctx, user_message or "\n".join(lines) or "角色规划完成", progress=1.0
        )

    async def run_shots(self, ctx: AgentContext) -> None:
        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        characters = list(char_res.scalars().all())
        cached_data = getattr(ctx, "plan_data", None)
        if (
            isinstance(cached_data, dict)
            and isinstance(cached_data.get("shots"), list)
            and cached_data.get("shots")
        ):
            data = cached_data
        else:
            data = await self._call_plan_llm(ctx, task="shots", characters=characters)

        is_incremental = ctx.rerun_mode == "incremental"
        visual_bible = data.get("visual_bible") or getattr(ctx.project, "visual_bible", None) or ""
        user_message = data.get("user_message") or ""

        if is_incremental:
            await self.send_message(ctx, "正在增量更新分镜...", progress=0.0, is_loading=True)
            _, new_shot_count = await self._apply_incremental_changes(ctx, data, visual_bible)

            shot_res = await ctx.session.execute(
                select(Shot).where(Shot.project_id == ctx.project.id).order_by(Shot.order.asc())
            )
            final_shots = list(shot_res.scalars().all())
            for shot in final_shots:
                await self.send_shot_event(ctx, shot, "shot_updated")

            lines = [f"{len(final_shots)} 个分镜"]
            summary = ctx.project.summary or f"{len(final_shots)}个分镜"
            ctx.completion_info = CompletionInfo(
                completed=user_message or "分镜增量更新完成",
                details=f"更新后共 {len(final_shots)} 个分镜",
                next="接下来为角色和分镜生成参考图片",
                question="分镜是否符合预期？",
            )
            await self.send_message(
                ctx,
                user_message or "\n".join(lines) or "分镜更新完成",
                summary=summary,
                progress=1.0,
            )
            return

        await self.send_message(ctx, "正在生成分镜脚本...", progress=0.0, is_loading=True)

        # Thinking: planning phase — before processing shots
        await self.send_thinking(
            ctx,
            phase="planning",
            content="正在根据角色设定生成分镜脚本...",
            details=f"视觉圣经长度：{len(visual_bible)} 字符",
        )

        raw_shots = data.get("shots") or []
        if not isinstance(raw_shots, list) or not raw_shots:
            raise ValueError("LLM 响应未返回任何分镜")

        await ctx.session.execute(delete(Shot).where(Shot.project_id == ctx.project.id))
        await ctx.session.flush()

        new_shots: list[Shot] = []
        fallback_order = 1
        for idx, shot_data in enumerate(raw_shots):
            if not isinstance(shot_data, dict):
                continue
            shot_desc = shot_data.get("description")
            if not (isinstance(shot_desc, str) and shot_desc.strip()):
                continue
            order = shot_data.get("order")
            if isinstance(order, int) and order > 0:
                shot_order = order
            else:
                shot_order = fallback_order
            fallback_order = max(fallback_order, shot_order + 1)

            fields = _shot_fields(ctx, shot_data, visual_bible, characters)

            new_shots.append(
                Shot(
                    order=shot_order,
                    **fields,
                )
            )

        if not new_shots:
            raise ValueError("LLM 响应的分镜列表为空或无效")

        new_shots.sort(key=lambda s: s.order)
        ctx.session.add_all(new_shots)
        await ctx.session.flush()
        for shot in new_shots:
            await self.send_shot_event(ctx, shot, "shot_created")
        await ctx.session.commit()

        char_count = len(characters)

        # Thinking: decision phase — shots generated
        await self.send_thinking(
            ctx,
            phase="decision",
            content=f"已生成 {len(new_shots)} 个分镜和 {char_count} 个角色",
            details=f"剧情摘要：{(ctx.project.summary or '')[:60]}",
        )

        summary = ctx.project.summary or f"{char_count}个角色，{len(new_shots)}个分镜"
        ctx.project.summary = summary
        ctx.project.updated_at = utcnow()
        ctx.session.add(ctx.project)

        ctx.completion_info = CompletionInfo(
            completed=user_message or "分镜脚本已生成",
            details=f"共 {len(new_shots)} 个分镜",
            next="接下来为角色和分镜生成参考图片",
            question="分镜是否符合预期？",
        )
        await self.send_message(
            ctx, user_message or f"{len(new_shots)} 个分镜已生成", summary=summary, progress=1.0
        )

    async def run(self, ctx: AgentContext) -> None:
        """Legacy entry point — runs both sub-steps sequentially."""
        await self.run_characters(ctx)
        await self.run_shots(ctx)
