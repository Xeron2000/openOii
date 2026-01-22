"""图片拼接服务 - 用于图生视频"""
from __future__ import annotations

import io
import logging
from pathlib import Path
from uuid import uuid4

import httpx
from PIL import Image

from app.services.file_cleaner import STATIC_DIR, get_local_path, is_local_file

logger = logging.getLogger(__name__)


class ImageComposer:
    """图片拼接器 - 将分镜图和角色图拼接成参考图"""

    def __init__(self, max_width: int = 1920, max_height: int = 1080):
        self.max_width = max_width
        self.max_height = max_height

    async def _download_image(self, url: str) -> Image.Image:
        """下载图片"""
        if is_local_file(url):
            local_path = get_local_path(url)
            if local_path and local_path.exists():
                return Image.open(local_path).convert("RGB")
            raise FileNotFoundError(f"Local image not found: {local_path}")
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=30.0)
            response.raise_for_status()
            return Image.open(io.BytesIO(response.content)).convert("RGB")

    def _resize_to_fit(self, img: Image.Image, max_width: int, max_height: int) -> Image.Image:
        """等比例缩放图片以适应指定尺寸"""
        ratio = min(max_width / img.width, max_height / img.height)
        if ratio < 1:
            new_size = (int(img.width * ratio), int(img.height * ratio))
            return img.resize(new_size, Image.Resampling.LANCZOS)
        return img

    async def compose_reference_image(
        self,
        shot_image_url: str,
        character_image_urls: list[str],
    ) -> bytes:
        """
        拼接参考图：分镜图 + 角色图

        布局：
        ┌─────────────────────────┐
        │                         │
        │    分镜图（主图）        │
        │                         │
        ├─────────┬─────────┬─────┤
        │ 角色1   │ 角色2   │ ... │
        └─────────┴─────────┴─────┘

        Args:
            shot_image_url: 分镜图片 URL
            character_image_urls: 角色图片 URL 列表

        Returns:
            拼接后的图片字节流（PNG 格式）
        """
        # 下载分镜图
        shot_img = await self._download_image(shot_image_url)

        # 下载角色图
        char_imgs: list[Image.Image] = []
        for url in character_image_urls:
            try:
                img = await self._download_image(url)
                char_imgs.append(img)
            except Exception:
                # 下载失败则跳过该角色
                continue

        # 如果没有角色图，直接返回分镜图
        if not char_imgs:
            shot_img = self._resize_to_fit(shot_img, self.max_width, self.max_height)
            buffer = io.BytesIO()
            shot_img.save(buffer, format="PNG")
            return buffer.getvalue()

        # 计算布局
        # 主图占 70% 高度，角色图占 30% 高度
        main_height = int(self.max_height * 0.7)
        char_height = int(self.max_height * 0.3)

        # 缩放主图
        shot_img = self._resize_to_fit(shot_img, self.max_width, main_height)

        # 计算角色图宽度（平均分配）
        char_width = self.max_width // len(char_imgs)

        # 缩放角色图
        resized_chars: list[Image.Image] = []
        for img in char_imgs:
            resized = self._resize_to_fit(img, char_width, char_height)
            resized_chars.append(resized)

        # 创建画布
        canvas_height = shot_img.height + char_height
        canvas = Image.new("RGB", (self.max_width, canvas_height), color=(255, 255, 255))

        # 粘贴主图（居中）
        x_offset = (self.max_width - shot_img.width) // 2
        canvas.paste(shot_img, (x_offset, 0))

        # 粘贴角色图（底部横排）
        x_pos = 0
        for char_img in resized_chars:
            y_offset = shot_img.height + (char_height - char_img.height) // 2
            x_offset = x_pos + (char_width - char_img.width) // 2
            canvas.paste(char_img, (x_offset, y_offset))
            x_pos += char_width

        # 转换为字节流
        buffer = io.BytesIO()
        canvas.save(buffer, format="PNG")
        return buffer.getvalue()

    async def compose_and_save_reference_image(
        self,
        shot_image_url: str,
        character_image_urls: list[str],
    ) -> str:
        """
        拼接参考图并保存到本地，返回 URL

        Args:
            shot_image_url: 分镜图片 URL
            character_image_urls: 角色图片 URL 列表

        Returns:
            保存后的图片 URL（如 /static/images/composed_xxx.png）
        """
        # 生成拼接图
        image_bytes = await self.compose_reference_image(shot_image_url, character_image_urls)

        # 生成唯一文件名
        filename = f"composed_{uuid4().hex}.png"
        images_dir = STATIC_DIR / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        file_path = images_dir / filename

        # 保存到本地
        with open(file_path, "wb") as f:
            f.write(image_bytes)

        logger.info(f"Saved composed image to {file_path}")

        # 返回 URL
        return f"/static/images/{filename}"

    async def compose_character_reference_image(
        self,
        character_image_urls: list[str],
    ) -> bytes:
        """拼接角色参考图：多角色横向排列，等高缩放

        布局：
        ┌─────────┬─────────┬─────┐
        │ 角色1   │ 角色2   │ ... │
        └─────────┴─────────┴─────┘

        Args:
            character_image_urls: 角色图片 URL 列表

        Returns:
            拼接后的图片字节流（PNG 格式）
        """
        if not character_image_urls:
            raise ValueError("No character images provided for composing reference image")

        # 下载角色图
        char_imgs: list[Image.Image] = []
        for url in character_image_urls:
            try:
                img = await self._download_image(url)
                char_imgs.append(img)
            except Exception:
                continue

        if not char_imgs:
            raise RuntimeError("All character images failed to download")

        # 目标高度：使用与 I2V 相同的角色高度策略
        target_height = int(self.max_height * 0.3)
        if target_height <= 0:
            target_height = min(self.max_height, 256)

        # 等高缩放
        resized: list[Image.Image] = []
        for img in char_imgs:
            ratio = target_height / img.height
            new_w = max(1, int(img.width * ratio))
            resized.append(img.resize((new_w, target_height), Image.Resampling.LANCZOS))

        total_width = sum(i.width for i in resized)
        # 如果总宽超限，再整体等比缩小
        if total_width > self.max_width:
            ratio = self.max_width / total_width
            new_resized: list[Image.Image] = []
            for img in resized:
                new_w = max(1, int(img.width * ratio))
                new_h = max(1, int(img.height * ratio))
                new_resized.append(img.resize((new_w, new_h), Image.Resampling.LANCZOS))
            resized = new_resized
            total_width = sum(i.width for i in resized)

        height = max(i.height for i in resized)
        canvas = Image.new("RGB", (total_width, height), color=(255, 255, 255))

        x_pos = 0
        for img in resized:
            y_pos = (height - img.height) // 2
            canvas.paste(img, (x_pos, y_pos))
            x_pos += img.width

        buffer = io.BytesIO()
        canvas.save(buffer, format="PNG")
        return buffer.getvalue()
