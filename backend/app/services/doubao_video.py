"""豆包视频生成服务（火山引擎 Ark API）

支持图生视频（I2V）和文生视频（T2V）模式。
使用异步任务模式：创建任务 → 轮询状态 → 获取结果
"""

from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
from typing import Any, Literal

import httpx

from app.config import Settings
from app.services.file_cleaner import get_local_path

logger = logging.getLogger(__name__)

# 最大允许的图片文件大小（10MB）
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024


class DoubaoVideoService:
    """豆包视频生成服务

    基于火山引擎 Ark API 的视频生成服务，支持：
    - 图生视频（I2V）：根据首帧图片 + 文本提示生成视频
    - 文生视频（T2V）：纯文本提示生成视频
    - 音频生成：可选生成配套音频
    """

    # API 端点
    BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
    CREATE_ENDPOINT = "/contents/generations/tasks"
    QUERY_ENDPOINT = "/contents/generations/tasks/{task_id}"

    # 任务状态
    STATUS_PENDING = "pending"
    STATUS_RUNNING = "running"
    STATUS_SUCCEEDED = "succeeded"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    def __init__(
        self,
        settings: Settings,
        *,
        max_retries: int = 3,
        poll_interval: float = 5.0,
        max_poll_time: float = 600.0,
    ):
        """初始化豆包视频服务

        Args:
            settings: 应用配置
            max_retries: 请求最大重试次数
            poll_interval: 轮询间隔（秒）
            max_poll_time: 最大轮询时间（秒）
        """
        self.settings = settings
        self.max_retries = max_retries
        self.poll_interval = poll_interval
        self.max_poll_time = max_poll_time

    def _get_headers(self) -> dict[str, str]:
        """获取请求头"""
        api_key = self.settings.doubao_api_key
        if not api_key:
            raise ValueError("DOUBAO_API_KEY is not configured")
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _inline_local_image(self, image_url: str) -> str:
        local_path = get_local_path(image_url)
        if not local_path or not local_path.exists():
            return image_url

        # 安全检查：限制文件大小
        file_size = local_path.stat().st_size
        if file_size > MAX_IMAGE_SIZE_BYTES:
            raise ValueError(
                f"Image file too large: {file_size} bytes (max {MAX_IMAGE_SIZE_BYTES} bytes)"
            )

        mime = mimetypes.guess_type(local_path.name)[0] or "image/png"
        data = base64.b64encode(local_path.read_bytes()).decode("ascii")
        logger.info("Inlining local image for Doubao request: %s", local_path)
        return f"data:{mime};base64,{data}"

    def _is_retryable_status(self, status_code: int) -> bool:
        """判断是否可重试的 HTTP 状态码"""
        return status_code in {408, 429, 500, 502, 503, 504}

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """带重试的 HTTP 请求"""
        delay_s = 1.0
        last_exc: Exception | None = None

        timeout = httpx.Timeout(60.0, connect=30.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    res = await client.request(
                        method,
                        url,
                        headers=self._get_headers(),
                        **kwargs,
                    )
                    if self._is_retryable_status(res.status_code) and attempt < self.max_retries:
                        logger.warning(
                            f"Doubao API returned {res.status_code}, retrying ({attempt + 1}/{self.max_retries})"
                        )
                        await asyncio.sleep(delay_s)
                        delay_s = min(delay_s * 2, 16.0)
                        continue
                    res.raise_for_status()
                    return res.json()
                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                    last_exc = exc
                    if attempt >= self.max_retries:
                        break
                    status = getattr(getattr(exc, "response", None), "status_code", None)
                    if isinstance(status, int) and not self._is_retryable_status(status):
                        break
                    logger.warning(
                        f"Doubao API request failed: {exc}, retrying ({attempt + 1}/{self.max_retries})"
                    )
                    await asyncio.sleep(delay_s)
                    delay_s = min(delay_s * 2, 16.0)

        raise RuntimeError(f"Doubao API request failed after retries: {last_exc}") from last_exc

    async def create_task(
        self,
        *,
        prompt: str,
        image_url: str | None = None,
        duration: Literal[5, 10] = 5,
        ratio: Literal["16:9", "9:16", "1:1", "adaptive"] = "adaptive",
        generate_audio: bool = True,
        watermark: bool = False,
        model: str | None = None,
    ) -> str:
        """创建视频生成任务

        Args:
            prompt: 视频描述文本
            image_url: 首帧图片 URL（图生视频模式）
            duration: 视频时长（5 或 10 秒）
            ratio: 视频比例
            generate_audio: 是否生成音频
            watermark: 是否添加水印
            model: 模型 ID（默认使用配置中的模型）

        Returns:
            任务 ID
        """
        url = f"{self.BASE_URL}{self.CREATE_ENDPOINT}"

        if image_url:
            original_image_url = image_url
            image_url = self.settings.build_public_url(image_url)
            if (
                image_url == original_image_url
                and self.settings.video_inline_local_images
                and not image_url.startswith("data:")
            ):
                image_url = self._inline_local_image(image_url)

        # 构建参数字符串（通过 prompt 文本传递）
        params_str = ""
        if ratio and ratio != "adaptive":
            params_str += f" --ratio {ratio}"
        if duration:
            params_str += f" --dur {duration}"
        # generate_audio 和 watermark 暂不支持通过参数传递

        # 构建 content 数组
        content: list[dict[str, Any]] = [
            {"type": "text", "text": prompt + params_str}
        ]

        # 图生视频模式：添加首帧图片（需要 role 字段）
        if image_url:
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": image_url,
                    "role": "first_frame"  # 指定为首帧图片
                }
            })

        payload = {
            "model": model or self.settings.doubao_video_model,
            "content": content,
        }

        logger.info(f"Creating Doubao video task: prompt={prompt[:50]}..., image={bool(image_url)}")

        result = await self._request_with_retry("POST", url, json=payload)

        task_id = result.get("id")
        if not task_id:
            raise RuntimeError(f"Doubao API response missing task ID: {result}")

        logger.info(f"Doubao video task created: {task_id}")
        return task_id

    async def query_task(self, task_id: str) -> dict[str, Any]:
        """查询任务状态

        Args:
            task_id: 任务 ID

        Returns:
            任务状态信息
        """
        url = f"{self.BASE_URL}{self.QUERY_ENDPOINT.format(task_id=task_id)}"
        return await self._request_with_retry("GET", url)

    async def wait_for_completion(
        self,
        task_id: str,
        *,
        on_progress: callable | None = None,
    ) -> dict[str, Any]:
        """等待任务完成

        Args:
            task_id: 任务 ID
            on_progress: 进度回调函数，接收 (status, progress) 参数

        Returns:
            完成的任务信息
        """
        start_time = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > self.max_poll_time:
                raise TimeoutError(f"Doubao video task {task_id} timed out after {self.max_poll_time}s")

            result = await self.query_task(task_id)
            status = result.get("status", "")

            # 计算进度（基于时间估算）
            progress = min(0.95, elapsed / (self.max_poll_time * 0.8))

            if on_progress:
                try:
                    on_progress(status, progress)
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")

            if status == self.STATUS_SUCCEEDED:
                logger.info(f"Doubao video task {task_id} succeeded")
                return result
            elif status == self.STATUS_FAILED:
                error = result.get("error", {})
                raise RuntimeError(f"Doubao video task failed: {error}")
            elif status == self.STATUS_CANCELLED:
                raise RuntimeError(f"Doubao video task {task_id} was cancelled")

            logger.debug(f"Doubao video task {task_id} status: {status}, waiting...")
            await asyncio.sleep(self.poll_interval)

    async def generate_url(
        self,
        *,
        prompt: str,
        image_url: str | None = None,
        duration: Literal[5, 10] = 5,
        ratio: Literal["16:9", "9:16", "1:1", "adaptive"] = "adaptive",
        generate_audio: bool = True,
        watermark: bool = False,
        model: str | None = None,
        on_progress: callable | None = None,
    ) -> str:
        """生成视频并返回 URL（一站式接口）

        Args:
            prompt: 视频描述文本
            image_url: 首帧图片 URL（图生视频模式）
            duration: 视频时长（5 或 10 秒）
            ratio: 视频比例
            generate_audio: 是否生成音频
            watermark: 是否添加水印
            model: 模型 ID
            on_progress: 进度回调函数

        Returns:
            生成的视频 URL
        """
        # 创建任务
        task_id = await self.create_task(
            prompt=prompt,
            image_url=image_url,
            duration=duration,
            ratio=ratio,
            generate_audio=generate_audio,
            watermark=watermark,
            model=model,
        )

        # 等待完成
        result = await self.wait_for_completion(task_id, on_progress=on_progress)

        # 提取视频 URL
        content = result.get("content", {})
        video_url = content.get("video_url")

        if not video_url:
            # 尝试从其他字段获取
            video_url = content.get("url") or result.get("video_url") or result.get("url")

        if not video_url:
            raise RuntimeError(f"Doubao API response missing video URL: {result}")

        logger.info(f"Doubao video generated: {video_url[:100]}...")
        return video_url

    async def generate_url_from_bytes(
        self,
        *,
        prompt: str,
        image_bytes: bytes,
        **kwargs: Any,
    ) -> str:
        """从图片字节流生成视频

        需要先将图片上传到可访问的 URL，然后调用 generate_url。
        这里假设调用方已经处理好了图片上传。

        Args:
            prompt: 视频描述文本
            image_bytes: 图片字节流
            **kwargs: 其他参数

        Returns:
            生成的视频 URL
        """
        # TODO: 实现图片上传到 OSS/CDN 的逻辑
        # 目前豆包 API 需要图片 URL，不支持直接传 base64
        raise NotImplementedError(
            "Doubao API requires image URL, not bytes. "
            "Please upload the image first and use generate_url with image_url parameter."
        )

    async def merge_urls(self, video_urls: list[str]) -> str:
        """拼接多个视频 URL

        使用 ffmpeg 将多个视频片段拼接成一个完整视频。

        Args:
            video_urls: 要拼接的视频 URL 列表

        Returns:
            拼接后的视频 URL（本地路径）
        """
        if not video_urls:
            raise RuntimeError("No video URLs provided for merging")

        from app.services.video_merger import get_video_merger_service

        merger = get_video_merger_service()
        return await merger.merge_videos(video_urls)
