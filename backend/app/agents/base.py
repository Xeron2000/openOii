from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.agent_run import AgentRun
from app.models.message import Message
from app.models.project import Project
from app.services.image import ImageService
from app.services.llm import LLMResponse, LLMService
from app.services.video_factory import VideoServiceProtocol
from app.ws.manager import ConnectionManager


@dataclass
class TargetIds:
    """精细化控制的目标 ID"""
    character_ids: list[int] = field(default_factory=list)
    shot_ids: list[int] = field(default_factory=list)
    scene_ids: list[int] = field(default_factory=list)

    def has_targets(self) -> bool:
        """是否有指定的目标"""
        return bool(self.character_ids or self.shot_ids or self.scene_ids)


@dataclass
class AgentContext:
    settings: Settings
    session: AsyncSession
    ws: ConnectionManager
    project: Project
    run: AgentRun
    llm: LLMService
    image: ImageService
    video: VideoServiceProtocol
    user_feedback: str | None = None
    rerun_mode: str = "full"  # "full" or "incremental"
    target_ids: TargetIds | None = None  # 精细化控制的目标 ID


class BaseAgent:
    name: str = "base"

    async def send_message(self, ctx: AgentContext, content: str, progress: float | None = None, is_loading: bool = False) -> None:
        """发送消息

        Args:
            ctx: Agent 上下文
            content: 消息内容
            progress: 进度值（0-1 之间）
            is_loading: 是否显示加载动画
        """
        data: dict[str, Any] = {
            "agent": self.name,
            "role": "assistant",
            "content": content,
        }
        if progress is not None:
            data["progress"] = progress
        if is_loading:
            data["isLoading"] = True

        # 保存到数据库
        message = Message(
            project_id=ctx.project.id,
            run_id=ctx.run.id,
            agent=self.name,
            role="assistant",
            content=content,
            progress=progress,
            is_loading=is_loading,
        )
        ctx.session.add(message)
        await ctx.session.flush()

        # 发送 WebSocket 事件
        await ctx.ws.send_event(
            ctx.project.id,
            {"type": "run_message", "data": data},
        )

    async def send_character_event(self, ctx: AgentContext, character: Any, event_type: str = "character_created") -> None:
        """发送角色创建/更新事件"""
        await ctx.ws.send_event(
            ctx.project.id,
            {
                "type": event_type,
                "data": {
                    "character": {
                        "id": character.id,
                        "project_id": character.project_id,
                        "name": character.name,
                        "description": character.description,
                        "image_url": character.image_url,
                    }
                },
            },
        )

    async def send_scene_event(self, ctx: AgentContext, scene: Any, event_type: str = "scene_created") -> None:
        """发送场景创建/更新事件"""
        await ctx.ws.send_event(
            ctx.project.id,
            {
                "type": event_type,
                "data": {
                    "scene": {
                        "id": scene.id,
                        "project_id": scene.project_id,
                        "order": scene.order,
                        "description": scene.description,
                    }
                },
            },
        )

    async def send_shot_event(self, ctx: AgentContext, shot: Any, event_type: str = "shot_created") -> None:
        """发送分镜创建/更新事件"""
        await ctx.ws.send_event(
            ctx.project.id,
            {
                "type": event_type,
                "data": {
                    "shot": {
                        "id": shot.id,
                        "scene_id": shot.scene_id,
                        "order": shot.order,
                        "description": shot.description,
                        "prompt": shot.prompt,
                        "image_url": shot.image_url,
                        "video_url": shot.video_url,
                        "duration": shot.duration,
                    }
                },
            },
        )

    async def generate_and_cache_image(
        self,
        ctx: AgentContext,
        prompt: str,
        image_bytes: bytes | None = None,
        **kwargs: Any,
    ) -> str:
        """生成图片并缓存到本地

        Args:
            ctx: Agent 上下文
            prompt: 图片生成 prompt
            image_bytes: 可选的参考图片字节流（用于 I2I）
            **kwargs: 传递给 generate_url 的额外参数

        Returns:
            缓存后的图片 URL
        """
        url = await ctx.image.generate_url(
            prompt=prompt,
            image_bytes=image_bytes,
            **kwargs
        )
        return await ctx.image.cache_external_image(url)

    async def get_project_characters(self, ctx: AgentContext) -> list[Any]:
        """获取项目的所有角色

        Args:
            ctx: Agent 上下文

        Returns:
            角色列表
        """
        from app.models.project import Character
        from sqlalchemy import select

        res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        return list(res.scalars().all())

    async def send_progress_batch(
        self,
        ctx: AgentContext,
        total: int,
        current: int,
        message: str,
    ) -> None:
        """发送批处理进度消息

        Args:
            ctx: Agent 上下文
            total: 总数
            current: 当前索引（从 0 开始）
            message: 进度消息
        """
        progress = current / total if total > 0 else 0.0
        await self.send_message(ctx, message, progress=progress, is_loading=True)

    async def call_llm(
        self,
        ctx: AgentContext,
        system_prompt: str,
        user_prompt: str,
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2048,
        stream_to_ws: bool = False,
    ) -> LLMResponse:
        """调用 LLM 并返回最终响应。

        Args:
            stream_to_ws: 是否将流式文本推送到 WebSocket（默认关闭，因为 JSON 输出不适合直接展示）
        """

        messages: list[dict[str, Any]] = [{"role": "user", "content": user_prompt}]

        final: LLMResponse | None = None
        buffer = ""

        async for event in ctx.llm.stream(messages=messages, system=system_prompt, tools=tools, max_tokens=max_tokens):
            event_type = event.get("type")
            if event_type == "text":
                delta = event.get("text", "")
                if not isinstance(delta, str) or not delta:
                    continue
                buffer += delta
                # 只有明确要求时才流式推送（JSON 输出不适合直接展示给用户）
                if stream_to_ws and (len(buffer) >= 80 or buffer.endswith(("\n", "。", ".", "!", "?", "！", "？"))):
                    await self.send_message(ctx, buffer)
                    buffer = ""
            elif event_type == "final":
                resp = event.get("response")
                if isinstance(resp, LLMResponse):
                    final = resp

        if stream_to_ws and buffer:
            await self.send_message(ctx, buffer)

        if final is None:  # pragma: no cover
            raise RuntimeError("LLM stream finished without final response")
        return final

    async def run(self, ctx: AgentContext) -> None:  # pragma: no cover
        raise NotImplementedError
