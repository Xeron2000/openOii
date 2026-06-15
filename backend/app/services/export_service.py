"""漫画导出服务 — PDF 漫画册和竖屏 Webtoon 长图

使用 reportlab 生成 PDF，Pillow 拼接 Webtoon 长图。
字体使用开源 Noto Sans CJK / Noto Sans SC。
所有文件存储在本地 static/exports/ 目录。
"""
from __future__ import annotations

import logging
import textwrap
import uuid
from io import BytesIO
from typing import TYPE_CHECKING

import httpx
from PIL import Image, ImageDraw, ImageFont

from app.services.file_cleaner import STATIC_DIR
from app.services.font_utils import get_pillow_font_path, get_reportlab_font_name

if TYPE_CHECKING:
    from app.models.project import Character, Project, Shot

logger = logging.getLogger(__name__)

EXPORTS_DIR = STATIC_DIR / "exports"

# A4 尺寸（point，1 point = 1/72 inch）
A4_WIDTH = 595.28
A4_HEIGHT = 841.89

# 页面边距
MARGIN_LEFT = 40
MARGIN_RIGHT = 40
MARGIN_TOP = 50
MARGIN_BOTTOM = 50

# 内容区域
CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
CONTENT_HEIGHT = A4_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM


class ExportService:
    """漫画导出服务 — PDF 和 Webtoon"""

    def __init__(self) -> None:
        self._http_client: httpx.AsyncClient | None = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=60.0, follow_redirects=True)
        return self._http_client

    async def close(self) -> None:
        if self._http_client is not None and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None

    async def _download_image(self, url: str) -> bytes | None:
        """下载图片，返回 bytes。失败时返回 None。"""
        if not url:
            return None

        # 本地文件路径
        if url.startswith("/static/"):
            from app.services.file_cleaner import get_local_path
            local_path = get_local_path(url)
            if local_path and local_path.exists():
                return local_path.read_bytes()
            return None

        # 外部 URL
        if not url.startswith(("http://", "https://")):
            return None

        try:
            client = await self._get_http_client()
            res = await client.get(url)
            res.raise_for_status()
            return res.content
        except Exception as e:
            logger.warning(f"Failed to download image {url}: {e}")
            return None

    def _load_pil_image(self, data: bytes) -> Image.Image | None:
        """加载 PIL Image，失败时返回 None"""
        try:
            return Image.open(BytesIO(data)).convert("RGB")
        except Exception as e:
            logger.warning(f"Failed to load image: {e}")
            return None

    # ----------------------------------------------------------------
    # PDF 导出
    # ----------------------------------------------------------------
    async def export_pdf(
        self,
        project: Project,
        shots: list[Shot],
        characters: list[Character],
        include_dialogue: bool = True,
        include_character_info: bool = True,
    ) -> str:
        """导出 PDF 漫画册

        布局规则：
        - A4 纵向页面
        - 每页 1-4 个分镜（根据分镜数量自动决定）
        - 分镜图片占主要区域
        - 对白气泡叠加在图片上方
        - 角色名标注在对白旁
        - 页码
        - 封面页：项目标题 + 风格

        Returns:
            导出文件的本地 URL（如 /static/exports/xxx.pdf）
        """
        from reportlab.lib.colors import black
        from reportlab.lib.enums import TA_CENTER
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.pdfgen import canvas
        from reportlab.platypus import Paragraph

        EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

        export_id = uuid.uuid4().hex[:12]
        filename = f"{project.id}_{export_id}.pdf"
        filepath = EXPORTS_DIR / filename

        # 获取字体
        font_name = get_reportlab_font_name()

        # 创建 PDF
        c = canvas.Canvas(str(filepath), pagesize=(A4_WIDTH, A4_HEIGHT))

        # ---- 封面页 ----
        c.setFont(font_name, 36)
        c.drawCentredString(A4_WIDTH / 2, A4_HEIGHT / 2 + 60, project.title or "无标题")

        c.setFont(font_name, 18)
        style_text = f"风格: {project.style or '未指定'}"
        c.drawCentredString(A4_WIDTH / 2, A4_HEIGHT / 2, style_text)

        shot_count = len(shots)
        c.setFont(font_name, 14)
        c.drawCentredString(A4_WIDTH / 2, A4_HEIGHT / 2 - 40, f"共 {shot_count} 个分镜")

        if project.summary:
            c.setFont(font_name, 12)
            # 自动换行摘要
            summary_style = ParagraphStyle(
                "summary",
                fontName=font_name,
                fontSize=12,
                leading=18,
                alignment=TA_CENTER,
            )
            summary_para = Paragraph(project.summary, summary_style)
            summary_para.wrapOn(c, CONTENT_WIDTH, 100)
            summary_para.drawOn(c, MARGIN_LEFT, A4_HEIGHT / 2 - 120)

        c.showPage()

        # ---- 构建 character_id -> name 映射 ----
        char_map: dict[int, str] = {}
        if include_character_info:
            for ch in characters:
                if ch.id is not None:
                    char_map[ch.id] = ch.name

        # ---- 计算每页分镜数量 ----
        n = len(shots)
        if n <= 4:
            per_page = 1
        elif n <= 8:
            per_page = 2
        elif n <= 16:
            per_page = 3
        else:
            per_page = 4

        # ---- 内容页 ----
        page_num = 2  # 封面是第1页
        for page_start in range(0, n, per_page):
            page_shots = shots[page_start : page_start + per_page]
            num_on_page = len(page_shots)

            # 计算格子布局
            cell_height = CONTENT_HEIGHT / num_on_page - 8  # 格间距
            cell_width = CONTENT_WIDTH

            for idx, shot in enumerate(page_shots):
                y_base = A4_HEIGHT - MARGIN_TOP - idx * (cell_height + 8)

                # 分镜编号
                c.setFont(font_name, 10)
                c.setFillColor(black)
                c.drawString(MARGIN_LEFT, y_base - 2, f"#{shot.order}")

                # 下载并绘制分镜图片
                image_data = await self._download_image(shot.image_url or "")
                if image_data:
                    try:
                        from reportlab.lib.utils import ImageReader

                        img_reader = ImageReader(BytesIO(image_data))
                        iw, ih = img_reader.getSize()

                        # 等比缩放填满格子
                        scale_x = cell_width / iw
                        scale_y = (cell_height - 20) / ih  # 留出对白空间
                        scale = min(scale_x, scale_y)

                        draw_w = iw * scale
                        draw_h = ih * scale
                        draw_x = MARGIN_LEFT + (cell_width - draw_w) / 2
                        draw_y = y_base - draw_h - 15

                        c.drawImage(
                            img_reader,
                            draw_x,
                            draw_y,
                            draw_w,
                            draw_h,
                            preserveAspectRatio=True,
                            mask="auto",
                        )

                        # 边框
                        c.setStrokeColor(black)
                        c.setLineWidth(0.5)
                        c.rect(draw_x, draw_y, draw_w, draw_h)
                    except Exception as e:
                        logger.warning(f"Failed to draw image for shot {shot.id}: {e}")
                        # 降级：绘制占位框
                        c.setStrokeColor(black)
                        c.setDash(3, 3)
                        c.rect(MARGIN_LEFT, y_base - cell_height + 15, cell_width, cell_height - 35)
                        c.setDash()
                        c.setFont(font_name, 12)
                        c.drawCentredString(
                            MARGIN_LEFT + cell_width / 2,
                            y_base - cell_height / 2,
                            "[图片加载失败]",
                        )
                else:
                    # 无图片时绘制占位框
                    c.setStrokeColor(black)
                    c.setDash(3, 3)
                    c.rect(MARGIN_LEFT, y_base - cell_height + 15, cell_width, cell_height - 35)
                    c.setDash()
                    c.setFont(font_name, 12)
                    c.drawCentredString(
                        MARGIN_LEFT + cell_width / 2,
                        y_base - cell_height / 2,
                        "[无图片]",
                    )

                # 对白气泡
                if include_dialogue and shot.dialogue:
                    speaker_name = None
                    if include_character_info and shot.character_ids:
                        first_char_id = shot.character_ids[0] if shot.character_ids else None
                        if first_char_id:
                            speaker_name = char_map.get(first_char_id)

                    self._draw_speech_bubble(
                        c, MARGIN_LEFT + 10, y_base - 18, shot.dialogue,
                        speaker_name=speaker_name, font_name=font_name,
                        max_width=cell_width - 20,
                    )

            # 页码
            c.setFont(font_name, 9)
            c.drawCentredString(A4_WIDTH / 2, MARGIN_BOTTOM / 2, f"- {page_num} -")
            c.showPage()
            page_num += 1

        c.save()
        logger.info(f"PDF exported: {filepath}")

        return f"/static/exports/{filename}"

    def _draw_speech_bubble(
        self,
        c,
        x: float,
        y: float,
        text: str,
        speaker_name: str | None = None,
        font_name: str = "Helvetica",
        max_width: float = 400,
    ) -> None:
        """在 PDF canvas 上绘制对白气泡

        圆角矩形 + 白色背景，黑色边框，文本自动换行
        """
        from reportlab.lib.colors import black, white
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.platypus import Paragraph

        # 文本处理
        display_text = text
        if speaker_name:
            display_text = f"【{speaker_name}】{text}"

        # 自动换行
        style = ParagraphStyle(
            "bubble",
            fontName=font_name,
            fontSize=11,
            leading=15,
            alignment=TA_LEFT,
        )

        para = Paragraph(display_text, style)
        w, h = para.wrap(max_width - 16, 200)  # 16 = 内边距

        # 气泡尺寸
        bubble_w = w + 16
        bubble_h = h + 12

        # 绘制气泡背景
        c.setFillColor(white)
        c.setStrokeColor(black)
        c.setLineWidth(0.8)

        # 圆角矩形
        c.roundRect(x, y - bubble_h, bubble_w, bubble_h, 6, fill=1, stroke=1)

        # 小尾巴（三角形）
        tail_x = x + 15
        tail_y = y - bubble_h
        c.setFillColor(white)
        p = c.beginPath()
        p.moveTo(tail_x, tail_y)
        p.lineTo(tail_x + 8, tail_y - 8)
        p.lineTo(tail_x + 15, tail_y)
        p.close()
        c.drawPath(p, fill=1, stroke=1)

        # 文本
        para.drawOn(c, x + 8, y - bubble_h + 6)

    # ----------------------------------------------------------------
    # Webtoon 导出
    # ----------------------------------------------------------------
    async def export_webtoon(
        self,
        project: Project,
        shots: list[Shot],
        include_dialogue: bool = True,
    ) -> str:
        """导出竖屏 Webtoon 长图

        布局规则：
        - 竖向拼接所有分镜图
        - 每个分镜之间加间距条（白色或黑色渐变）
        - 分镜编号标记
        - 对白文本叠加
        - 顶部加标题条
        - 最终输出 PNG

        Returns:
            导出文件的本地 URL（如 /static/exports/xxx.png）
        """
        if not shots:
            raise ValueError("没有可导出的分镜，请先生成分镜内容")

        EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

        export_id = uuid.uuid4().hex[:12]
        filename = f"{project.id}_{export_id}_webtoon.png"
        filepath = EXPORTS_DIR / filename

        # 目标宽度（Webtoon 标准：800px）
        TARGET_WIDTH = 800
        GAP_HEIGHT = 40  # 分镜间距
        TITLE_BAR_HEIGHT = 120  # 标题条高度

        # 下载所有分镜图片
        shot_images: list[tuple[Shot, Image.Image | None]] = []
        for shot in shots:
            data = await self._download_image(shot.image_url or "")
            img = self._load_pil_image(data) if data else None
            shot_images.append((shot, img))

        # 计算总高度
        total_height = TITLE_BAR_HEIGHT
        for shot, img in shot_images:
            if img:
                # 等比缩放到目标宽度
                ratio = TARGET_WIDTH / img.width
                scaled_h = int(img.height * ratio)
                total_height += scaled_h
            else:
                # 占位高度
                total_height += 400
            total_height += GAP_HEIGHT

        # 创建画布
        canvas_img = Image.new("RGB", (TARGET_WIDTH, total_height), (255, 255, 255))
        draw = ImageDraw.Draw(canvas_img)

        # 加载字体
        font_path = get_pillow_font_path()
        try:
            title_font = ImageFont.truetype(font_path or "", 36)
            label_font = ImageFont.truetype(font_path or "", 18)
        except Exception:
            title_font = ImageFont.load_default()
            label_font = ImageFont.load_default()

        # ---- 标题条 ----
        draw.rectangle([0, 0, TARGET_WIDTH, TITLE_BAR_HEIGHT], fill=(30, 30, 30))
        title_text = project.title or "无标题"
        # 居中绘制标题
        bbox = draw.textbbox((0, 0), title_text, font=title_font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (TARGET_WIDTH - tw) // 2
        ty = (TITLE_BAR_HEIGHT - th) // 2
        draw.text((tx, ty), title_text, fill=(255, 255, 255), font=title_font)

        # ---- 分镜拼接 ----
        y_offset = TITLE_BAR_HEIGHT

        for shot, img in shot_images:
            if img:
                # 等比缩放
                ratio = TARGET_WIDTH / img.width
                scaled_w = TARGET_WIDTH
                scaled_h = int(img.height * ratio)
                resized = img.resize((scaled_w, scaled_h), Image.LANCZOS)

                # 叠加对白
                if include_dialogue and shot.dialogue:
                    resized = self._overlay_dialogue_on_image(
                        resized, shot.dialogue, font_path=font_path,
                    )

                canvas_img.paste(resized, (0, y_offset))
                y_offset += scaled_h
            else:
                # 占位区域
                placeholder_h = 400
                draw.rectangle(
                    [0, y_offset, TARGET_WIDTH, y_offset + placeholder_h],
                    fill=(220, 220, 220),
                )
                draw.text(
                    (TARGET_WIDTH // 2 - 60, y_offset + placeholder_h // 2 - 10),
                    f"[分镜 #{shot.order} 无图片]",
                    fill=(150, 150, 150),
                    font=label_font,
                )
                y_offset += placeholder_h

            # 分镜编号标记
            label_text = f"#{shot.order}"
            # 背景
            label_bbox = draw.textbbox((0, 0), label_text, font=label_font)
            label_w = label_bbox[2] - label_bbox[0] + 12
            label_h = label_bbox[3] - label_bbox[1] + 8
            draw.rectangle(
                [8, y_offset + 2, 8 + label_w, y_offset + 2 + label_h],
                fill=(0, 0, 0, 180),
            )
            draw.text((14, y_offset + 4), label_text, fill=(255, 255, 255), font=label_font)

            # 间距条（渐变效果）
            for gy in range(GAP_HEIGHT):
                gray = int(255 - (gy / GAP_HEIGHT) * 30)
                draw.line(
                    [(0, y_offset + gy), (TARGET_WIDTH, y_offset + gy)],
                    fill=(gray, gray, gray),
                )
            y_offset += GAP_HEIGHT

        # 保存
        canvas_img.save(str(filepath), "PNG", optimize=True)
        logger.info(f"Webtoon exported: {filepath}")

        return f"/static/exports/{filename}"

    def _overlay_dialogue_on_image(
        self,
        image: Image.Image,
        dialogue: str,
        speaker: str | None = None,
        font_path: str | None = None,
    ) -> Image.Image:
        """在图片上叠加对白气泡

        Pillow 绘制圆角矩形 + 文本
        """
        draw = ImageDraw.Draw(image)
        margin = 16
        padding = 12

        # 加载字体
        try:
            font = ImageFont.truetype(font_path or "", 22)
            small_font = ImageFont.truetype(font_path or "", 16)
        except Exception:
            font = ImageFont.load_default()
            small_font = font

        # 构建显示文本
        display_text = dialogue
        if speaker:
            display_text = f"【{speaker}】{dialogue}"

        # 自动换行
        max_chars_per_line = max(1, (image.width - 2 * margin - 2 * padding) // 22)
        wrapped_lines = []
        for line in display_text.split("\n"):
            wrapped_lines.extend(textwrap.wrap(line, width=max_chars_per_line) or [""])

        # 计算气泡尺寸
        line_height = 28
        bubble_h = len(wrapped_lines) * line_height + 2 * padding
        if speaker:
            bubble_h += 20  # 角色名额外空间

        # 测量最大行宽
        max_line_w = 0
        for line in wrapped_lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            lw = bbox[2] - bbox[0]
            max_line_w = max(max_line_w, lw)
        bubble_w = max_line_w + 2 * padding + 8

        # 气泡位置（底部居中）
        bx = (image.width - bubble_w) // 2
        by = image.height - bubble_h - margin

        # 绘制半透明背景（使用 RGBA 模式）
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)

        # 圆角矩形
        corner_radius = 10
        overlay_draw.rounded_rectangle(
            [bx, by, bx + bubble_w, by + bubble_h],
            radius=corner_radius,
            fill=(255, 255, 255, 220),
            outline=(0, 0, 0, 200),
            width=2,
        )

        # 小尾巴
        tail_x = bx + 20
        tail_y = by + bubble_h
        overlay_draw.polygon(
            [(tail_x, tail_y - 5), (tail_x + 10, tail_y + 10), (tail_x + 20, tail_y - 5)],
            fill=(255, 255, 255, 220),
            outline=(0, 0, 0, 200),
        )

        # 合成半透明层
        image_rgba = image.convert("RGBA")
        image_rgba = Image.alpha_composite(image_rgba, overlay)

        # 在合成图上绘制文本（需要 RGB 模式）
        result = image_rgba.convert("RGB")
        result_draw = ImageDraw.Draw(result)

        # 角色名
        text_y = by + padding
        if speaker:
            result_draw.text((bx + padding, text_y), f"【{speaker}】", fill=(50, 50, 200), font=small_font)
            text_y += 20

        # 对白文本
        for line in wrapped_lines:
            result_draw.text((bx + padding, text_y), line, fill=(0, 0, 0), font=font)
            text_y += line_height

        return result
