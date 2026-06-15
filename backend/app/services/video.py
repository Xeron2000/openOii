from __future__ import annotations

import asyncio
import base64
import json
import re
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import logging

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class VideoService:
    """视频生成服务（OpenAI 兼容接口，支持流式模式和图生视频）"""

    def __init__(self, settings: Settings, *, max_retries: int = 3):
        self.settings = settings
        self.max_retries = max_retries

    def _build_url(self) -> str:
        base = self.settings.video_base_url.rstrip("/")
        endpoint = self.settings.video_endpoint
        if not endpoint.startswith("/"):
            endpoint = "/" + endpoint
        return f"{base}{endpoint}"

    def _extract_task_id(self, data: dict[str, Any]) -> str | None:
        """从 API 响应中提取异步任务 ID。"""
        for key in ("id", "task_id", "request_id"):
            val = data.get(key)
            if isinstance(val, str) and val:
                return val
        return None

    def _build_poll_url(self, task_id: str) -> str:
        """构造轮询 URL。根据 create endpoint 推导 retrieve endpoint。"""
        base = self.settings.video_base_url.rstrip("/")
        endpoint = self.settings.video_endpoint.rstrip("/")

        # yunwu veo unified video API:
        #   POST /v1/video/create
        #   GET  /v1/video/query?id=<task_id>
        if endpoint.endswith("/video/create"):
            return f"{base}/video/query?id={quote(task_id, safe='')}"

        # OpenAI-compatible style:
        #   POST /v1/videos/generations
        #   GET  /v1/videos/{id}
        if "/generations" in endpoint:
            resource = endpoint.split("/generations")[0]
            return f"{base}{resource}/{quote(task_id, safe='')}"

        # Generic fallback:
        #   POST /api/v1/videos
        #   GET  /api/v1/videos/{id}
        return f"{base}{endpoint}/{quote(task_id, safe='')}"

    def _build_standard_payload(
        self,
        *,
        prompt: str,
        duration: float,
        image_base64: str | None = None,
        kwargs: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build a non-chat video payload with model-specific parameters."""
        extra = dict(kwargs or {})
        model_lower = self.settings.video_model.lower()
        endpoint_lower = self.settings.video_endpoint.lower()

        if "ltx" in model_lower or endpoint_lower.endswith("/ltx-video"):
            payload: dict[str, Any] = {
                "client_task_id": extra.pop("client_task_id", f"ltx-video-{uuid4().hex}"),
                "prompt": prompt,
                "duration": int(duration),
                "aspect_ratio": extra.pop("aspect_ratio", "16:9"),
                **extra,
            }
        elif "grok" in model_lower:
            payload = {
                "model": self.settings.video_model,
                "prompt": prompt,
                "seconds": str(int(duration)),
                "size": extra.pop("size", "16:9"),
                **extra,
            }
        elif "veo" in model_lower:
            payload = {
                "model": self.settings.video_model,
                "prompt": prompt,
                "duration": int(duration),
                "aspect_ratio": extra.pop("aspect_ratio", "16:9"),
                **extra,
            }
        else:
            payload = {
                "model": self.settings.video_model,
                "prompt": prompt,
                "duration": duration,
                **extra,
            }

        if image_base64:
            payload["image"] = image_base64
        return payload

    @staticmethod
    def _dirty_contains_url(val: str | None) -> bool:
        """快速判断字符串中是否包含 http(s) URL（含前导空格、括号等噪声）。"""
        return isinstance(val, str) and "https://" in val

    def _extract_url_from_result(self, data: dict[str, Any]) -> str | None:
        """从完成的任务响应中提取视频 URL，支持多种 API 响应格式。"""

        def _try_sanitize(val: Any) -> str | None:
            if not isinstance(val, str):
                return None
            if not self._dirty_contains_url(val):
                return None
            sanitized = self._sanitize_url(val)
            return sanitized if sanitized else None

        # Direct URL field
        for key in ("video_url", "url", "output_url", "result_url"):
            result = _try_sanitize(data.get(key))
            if result:
                return result

        # Nested: output.url, result.url, video.url, data[0].url
        for container_key in ("output", "result", "video", "data"):
            container = data.get(container_key)
            if isinstance(container, dict):
                for key in ("url", "video_url"):
                    result = _try_sanitize(container.get(key))
                    if result:
                        return result
            elif isinstance(container, list) and container:
                first = container[0] if isinstance(container[0], dict) else {}
                for key in ("url", "video_url"):
                    result = _try_sanitize(first.get(key))
                    if result:
                        return result

        # URLs embedded in text
        return self._extract_url_from_text(data.get("content", ""))

    async def _poll_task_until_done(
        self, task_id: str, *, poll_interval_s: float = 5.0, max_polls: int = 120
    ) -> dict[str, Any]:
        """轮询异步任务直到完成/失败。返回最终的任务数据。"""
        poll_url = self._build_poll_url(task_id)
        headers = self.settings.video_headers()
        timeout = httpx.Timeout(30.0, connect=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            for i in range(max_polls):
                try:
                    res = await client.get(poll_url, headers=headers)
                    res.raise_for_status()
                    data = res.json()
                except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                    logger.warning(
                        "Video task poll failed (attempt %d/%d): %s",
                        i + 1,
                        max_polls,
                        exc,
                    )
                    await asyncio.sleep(poll_interval_s)
                    continue

                status = str(data.get("status", "")).lower()
                progress = data.get("progress")

                if status in {"completed", "succeeded", "success", "done"}:
                    return data
                if status in {"failed", "error", "cancelled", "canceled"}:
                    error = data.get("error")
                    error_msg = (
                        error.get("message")
                        if isinstance(error, dict)
                        else str(error)
                        if error
                        else "unknown error"
                    )
                    raise RuntimeError(f"Video generation task {task_id} failed: {error_msg}")

                logger.debug(
                    "Video task %s status=%s progress=%s (poll %d/%d)",
                    task_id,
                    status,
                    progress,
                    i + 1,
                    max_polls,
                )
                await asyncio.sleep(poll_interval_s)

        raise RuntimeError(
            f"Video generation task {task_id} timed out after {max_polls * poll_interval_s:.0f}s"
        )

    def _is_retryable_status(self, status_code: int) -> bool:
        return status_code in {408, 429, 500, 502, 503, 504}

    def _sanitize_url(self, url: str) -> str:
        cleaned = url.strip().strip("\"'")
        return cleaned.rstrip(").,;]}>")

    def _extract_url_from_text(self, text: str) -> str | None:
        if not text or not isinstance(text, str):
            return None
        candidate = text.strip()
        if candidate.startswith("data:"):
            return candidate
        if candidate.startswith(("http://", "https://")):
            return self._sanitize_url(candidate)
        urls = re.findall(r"https?://[^\s<>\"]+", candidate)
        if urls:
            return self._sanitize_url(urls[0])
        return None

    async def _post_json_with_retry(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        delay_s = 0.5
        last_exc: Exception | None = None

        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    res = await client.post(
                        url, headers=self.settings.video_headers(), json=payload
                    )
                    if self._is_retryable_status(res.status_code) and attempt < self.max_retries:
                        await asyncio.sleep(delay_s)
                        delay_s = min(delay_s * 2, 8.0)
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
                    await asyncio.sleep(delay_s)
                    delay_s = min(delay_s * 2, 8.0)

        raise RuntimeError(
            f"Video generation request failed after retries: {last_exc}"
        ) from last_exc

    async def _post_stream_with_retry(self, url: str, payload: dict[str, Any]) -> str:
        """流式请求，收集所有 chunk 并提取最终 URL"""
        delay_s = 0.5
        last_exc: Exception | None = None

        # 视频生成需要更长的超时时间
        timeout = httpx.Timeout(600.0, connect=30.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    collected_content = ""
                    async with client.stream(
                        "POST", url, headers=self.settings.video_headers(), json=payload
                    ) as res:
                        if (
                            self._is_retryable_status(res.status_code)
                            and attempt < self.max_retries
                        ):
                            await asyncio.sleep(delay_s)
                            delay_s = min(delay_s * 2, 8.0)
                            continue
                        res.raise_for_status()

                        async for line in res.aiter_lines():
                            if not line or not line.startswith("data: "):
                                continue
                            data_str = line[6:]  # 去掉 "data: " 前缀
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                # 检查是否有错误
                                if "error" in chunk:
                                    raise RuntimeError(f"Stream error: {chunk['error']}")
                                # 提取 content
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        collected_content += content
                            except json.JSONDecodeError as e:
                                # 可能是非 JSON 行，检查是否包含错误
                                if "error" in data_str:
                                    try:
                                        err = json.loads(data_str)
                                        raise RuntimeError(f"Stream error: {err}")
                                    except json.JSONDecodeError:
                                        logger.debug(
                                            "Non-JSON error line in stream: %s", data_str[:100]
                                        )
                                else:
                                    logger.debug("Skipping non-JSON line in video stream: %s", e)
                                continue

                    return collected_content

                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                    last_exc = exc
                    if attempt >= self.max_retries:
                        break
                    status = getattr(getattr(exc, "response", None), "status_code", None)
                    if isinstance(status, int) and not self._is_retryable_status(status):
                        break
                    await asyncio.sleep(delay_s)
                    delay_s = min(delay_s * 2, 8.0)

        raise RuntimeError(
            f"Video generation stream failed after retries: {last_exc}"
        ) from last_exc

    async def generate(
        self,
        *,
        prompt: str,
        duration: float = 5.0,
        stream: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        url = self._build_url()

        if "/chat/completions" in self.settings.video_endpoint:
            payload: dict[str, Any] = {
                "model": self.settings.video_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": stream,
                **kwargs,
            }
        else:
            payload = self._build_standard_payload(
                prompt=prompt,
                duration=duration,
                kwargs=kwargs,
            )

        return await self._post_json_with_retry(url, payload)

    async def generate_url(
        self, *, prompt: str, image_bytes: bytes | None = None, **kwargs: Any
    ) -> str:
        """生成视频并返回 URL

        Args:
            prompt: 文本提示词
            image_bytes: 参考图片字节流（图生视频模式）
            **kwargs: 其他参数

        Returns:
            视频 URL
        """
        url = self._build_url()

        # 图生视频模式
        if image_bytes and self.settings.use_i2v():
            # 将图片转换为 base64
            image_base64 = base64.b64encode(image_bytes).decode("utf-8")

            # Chat Completions 风格（图生视频）
            if "/chat/completions" in self.settings.video_endpoint:
                payload: dict[str, Any] = {
                    "model": self.settings.video_model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                                },
                            ],
                        }
                    ],
                    "stream": True,
                    **kwargs,
                }
                content = await self._post_stream_with_retry(url, payload)

                extracted = self._extract_url_from_text(content)
                if extracted:
                    return extracted
                raise RuntimeError(f"Video API stream response missing URL: {content}")
            else:
                # 标准视频生成接口（图生视频）
                duration = float(kwargs.pop("duration", 5.0))
                payload = self._build_standard_payload(
                    prompt=prompt,
                    duration=duration,
                    image_base64=image_base64,
                    kwargs=kwargs,
                )
                data = await self._post_json_with_retry(url, payload)

                # 异步任务：提交后需轮询
                task_id = self._extract_task_id(data)
                if task_id and str(data.get("status", "")).lower() in {
                    "queued",
                    "pending",
                    "submitted",
                    "running",
                    "processing",
                    "in_progress",
                    "submitted",
                    "",
                    "created",
                }:
                    data = await self._poll_task_until_done(task_id)

                url_val = self._extract_url_from_result(data)
                if url_val:
                    return url_val
                raise RuntimeError(f"Video API response missing URL: {data}")

        # 文生视频模式（原有逻辑）
        # Chat Completions 风格需要流式模式
        if "/chat/completions" in self.settings.video_endpoint:
            payload: dict[str, Any] = {
                "model": self.settings.video_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
                **kwargs,
            }
            content = await self._post_stream_with_retry(url, payload)

            extracted = self._extract_url_from_text(content)
            if extracted:
                return extracted
            raise RuntimeError(f"Video API stream response missing URL: {content}")
        else:
            # 标准视频生成接口（非流式）
            data = await self.generate(prompt=prompt, **kwargs)

            # 异步任务：提交后需轮询
            task_id = self._extract_task_id(data)
            if task_id and str(data.get("status", "")).lower() in {
                "queued",
                "pending",
                "submitted",
                "running",
                "processing",
                "in_progress",
                "",
                "created",
            }:
                data = await self._poll_task_until_done(task_id)

            url_val = self._extract_url_from_result(data)
            if url_val:
                return url_val
            raise RuntimeError(f"Video API response missing URL: {data}")

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
