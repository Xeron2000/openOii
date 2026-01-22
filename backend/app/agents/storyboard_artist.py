from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.agents.base import AgentContext, BaseAgent
from app.models.project import Character, Scene, Shot
from app.services.image_composer import ImageComposer

logger = logging.getLogger(__name__)


class StoryboardArtistAgent(BaseAgent):
    """为分镜生成首帧图片"""
    name = "storyboard_artist"

    def __init__(self):
        super().__init__()
        self.image_composer = ImageComposer()

    def _build_image_prompt(self, shot: Shot, characters: list[Character]) -> str:
        """构建首帧图片生成 prompt"""
        style_hints = {
            "anime": "anime style, manga key visual, clean lines, vibrant colors",
            "realistic": "realistic style, cinematic still, detailed composition",
        }

        # 优先使用 image_prompt，否则使用 description
        desc = shot.image_prompt or shot.description

        parts: list[str] = [desc.strip()]

        # 添加角色外观描述（保持一致性）
        if characters:
            char_descriptions = []
            for char in characters:
                # 提取角色的关键外观特征
                char_info = f"{char.name}: {char.description}" if char.description else char.name
                char_descriptions.append(char_info)
            if char_descriptions:
                parts.append("Characters: " + "; ".join(char_descriptions))

        # 添加风格提示
        style_hint = style_hints.get(self._project_style(), "")
        if style_hint:
            parts.append(style_hint)

        return ", ".join(parts)

    def _project_style(self) -> str:
        """获取项目风格"""
        # 简化处理，实际可以从 project 获取
        return "anime"

    async def run(self, ctx: AgentContext) -> None:
        use_i2i = ctx.settings.use_i2i()

        # 查询项目的所有角色（用于保持视觉一致性）
        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        characters = list(char_res.scalars().all())

        # 收集有图片的角色 URL（用于 I2I 参考图）
        char_image_urls = [c.image_url for c in characters if c.image_url]
        reference_image_bytes: bytes | None = None

        if use_i2i:
            if not char_image_urls:
                logger.info("I2I enabled but no character images available; will fall back to text-to-image")
            else:
                try:
                    reference_image_bytes = await self.image_composer.compose_character_reference_image(
                        char_image_urls
                    )
                    logger.info("I2I enabled: composed character reference image with %d characters", len(char_image_urls))
                except Exception as exc:
                    reference_image_bytes = None
                    logger.warning(
                        "Failed to compose character reference image; falling back to text-to-image: %s",
                        exc,
                        exc_info=True,
                    )

        # 查找没有首帧图片的 Shot（可按目标分镜过滤）
        query = (
            select(Shot)
            .join(Scene, Shot.scene_id == Scene.id)
            .where(
                Scene.project_id == ctx.project.id,
                Shot.image_url.is_(None),
            )
            .order_by(Scene.order, Shot.order)
        )
        if ctx.target_ids and ctx.target_ids.shot_ids:
            query = query.where(Shot.id.in_(ctx.target_ids.shot_ids))
        res = await ctx.session.execute(query)
        shots = res.scalars().all()
        if not shots:
            await self.send_message(ctx, "所有分镜已有首帧图片。")
            return

        total = len(shots)
        updated_count = 0
        failed_count = 0

        # 发送带进度的消息
        await self.send_message(ctx, f"🖼️ 开始为 {total} 个分镜生成首帧图片...", progress=0.0, is_loading=True)

        for i, shot in enumerate(shots):
            try:
                # 计算进度（当前索引 / 总数）
                current_progress = i / total

                # 发送进度更新消息
                await self.send_message(
                    ctx,
                    f"   正在绘制分镜 {i+1}/{total}...",
                    progress=current_progress,
                    is_loading=True
                )

                image_prompt = self._build_image_prompt(shot, characters)

                # 添加超时机制（8分钟）
                try:
                    image_url = await asyncio.wait_for(
                        ctx.image.generate_url(
                            prompt=image_prompt,
                            image_bytes=reference_image_bytes if use_i2i else None,
                        ),
                        timeout=480.0  # 8 分钟超时
                    )
                    image_url = await ctx.image.cache_external_image(image_url)
                except asyncio.TimeoutError:
                    raise RuntimeError(f"图片生成超时（超过8分钟）")

                shot.image_url = image_url
                ctx.session.add(shot)
                await ctx.session.flush()  # 确保更新生效
                # 发送分镜更新事件
                await self.send_shot_event(ctx, shot, "shot_updated")
                updated_count += 1

                # 添加延迟避免 API 限流（每张图片后等待 1 秒）
                if i < total - 1:
                    await asyncio.sleep(1.0)

            except Exception as e:
                failed_count += 1
                error_msg = f"⚠️ 镜头 {shot.order} 首帧图片生成失败: {str(e)[:100]}"
                await self.send_message(ctx, error_msg)
                # 失败后等待更长时间再继续
                await asyncio.sleep(2.0)

        await ctx.session.commit()

        # 完成消息
        if updated_count > 0:
            msg = f"✅ 已为 {updated_count} 个分镜生成首帧图片，接下来将生成视频。"
            if failed_count > 0:
                msg += f"（{failed_count} 个失败）"
            await self.send_message(ctx, msg, progress=1.0, is_loading=False)
        elif failed_count > 0:
            await self.send_message(ctx, f"❌ 所有 {failed_count} 个分镜首帧图片生成均失败。", progress=1.0, is_loading=False)
