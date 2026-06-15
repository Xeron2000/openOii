from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from app.config import Settings
from app.services.file_cleaner import STATIC_DIR

logger = logging.getLogger(__name__)

IMAGE_CONTENT_TYPE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

DATA_IMAGE_URL_RE = re.compile(
    r"data:(image/(?:png|jpe?g|webp|gif));base64,[A-Za-z0-9+/=\s]+",
    re.IGNORECASE,
)
MARKDOWN_IMAGE_TARGET_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")

FALLBACK_WHITE_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax7rL8AAAAASUVORK5CYII="
)
CHAT_REFERENCE_MAX_SIDE = 512
CHAT_REFERENCE_JPEG_QUALITY = 75


class ImageService:
    """图像生成服务（支持多种 API 格式）"""

    def __init__(self, settings: Settings, *, max_retries: int = 3):
        self.settings = settings
        self.max_retries = max_retries
        self._cache_client: httpx.AsyncClient | None = None

    async def _get_cache_client(self) -> httpx.AsyncClient:
        """获取或创建用于缓存图片的 HTTP 客户端（连接复用）"""
        if self._cache_client is None or self._cache_client.is_closed:
            self._cache_client = httpx.AsyncClient(timeout=self.settings.request_timeout_s)
        return self._cache_client

    async def close(self) -> None:
        """关闭 HTTP 客户端"""
        if self._cache_client is not None and not self._cache_client.is_closed:
            await self._cache_client.aclose()
            self._cache_client = None

    def _build_url(self) -> str:
        base = self.settings.image_base_url.rstrip("/")
        endpoint = self.settings.image_endpoint
        if not endpoint.startswith("/"):
            endpoint = "/" + endpoint
        return f"{base}{endpoint}"

    def _is_retryable_status(self, status_code: int) -> bool:
        return status_code in {408, 429, 500, 502, 503, 504}

    def _is_modelscope_api(self) -> bool:
        """检测是否是 ModelScope API"""
        return (
            self.settings.image_provider.lower() == "modelscope"
            or "modelscope" in self.settings.image_base_url.lower()
        )

    def _modelscope_requires_image_url(self) -> bool:
        model = (self.settings.image_model or "").lower()
        return "edit" in model or "image-edit" in model

    def _guess_image_content_type(self, image_bytes: bytes) -> str:
        content_type = "image/png"
        if image_bytes.startswith(b"\xff\xd8\xff"):
            content_type = "image/jpeg"
        elif image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]:
            content_type = "image/webp"
        elif image_bytes.startswith(b"GIF8"):
            content_type = "image/gif"
        return content_type

    def _compress_chat_reference_image(self, image_bytes: bytes) -> tuple[bytes, str]:
        """Compress multimodal chat image references to avoid small request limits."""
        try:
            from PIL import Image

            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            image.thumbnail(
                (CHAT_REFERENCE_MAX_SIDE, CHAT_REFERENCE_MAX_SIDE),
                Image.Resampling.LANCZOS,
            )
            buffer = BytesIO()
            image.save(
                buffer,
                format="JPEG",
                quality=CHAT_REFERENCE_JPEG_QUALITY,
                optimize=True,
            )
            return buffer.getvalue(), "image/jpeg"
        except Exception:
            logger.warning("Failed to compress chat image reference; using original bytes")
            return image_bytes, self._guess_image_content_type(image_bytes)

    def _image_bytes_to_data_url(self, image_bytes: bytes, *, optimize_for_chat: bool = False) -> str:
        if optimize_for_chat:
            image_bytes, content_type = self._compress_chat_reference_image(image_bytes)
        else:
            content_type = self._guess_image_content_type(image_bytes)
        encoded = base64.b64encode(image_bytes).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

    def _blank_canvas_data_url(self, size: int = 1024) -> str:
        try:
            from PIL import Image

            image = Image.new("RGB", (size, size), "white")
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            return self._image_bytes_to_data_url(buffer.getvalue())
        except Exception:
            logger.warning("Failed to build blank canvas image; using tiny fallback", exc_info=True)
            return FALLBACK_WHITE_PNG_DATA_URL

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
        markdown_match = MARKDOWN_IMAGE_TARGET_RE.search(candidate)
        if markdown_match:
            target = self._sanitize_url(markdown_match.group(1))
            if target.startswith(("http://", "https://", "data:")):
                return target
        data_match = DATA_IMAGE_URL_RE.search(candidate)
        if data_match:
            return self._sanitize_url(data_match.group(0).replace("\n", ""))
        urls = re.findall(r"https?://[^\s<>\"]+", candidate)
        if urls:
            return self._sanitize_url(urls[0])
        return None

    def _extract_url_from_payload_item(self, item: Any) -> str | None:
        if not isinstance(item, dict):
            return None

        for key in ("url", "image_url", "output_url", "output_image"):
            value = item.get(key)
            if isinstance(value, str):
                extracted = self._extract_url_from_text(value)
                if extracted:
                    return extracted
            if isinstance(value, dict):
                nested_url = value.get("url")
                if isinstance(nested_url, str):
                    extracted = self._extract_url_from_text(nested_url)
                    if extracted:
                        return extracted

        b64_json = item.get("b64_json")
        if isinstance(b64_json, str) and b64_json:
            return f"data:image/png;base64,{b64_json}"

        return None

    def _extract_url_from_chat_content(self, content: Any) -> str | None:
        if isinstance(content, str):
            return self._extract_url_from_text(content)
        if isinstance(content, list):
            for part in content:
                extracted = self._extract_url_from_payload(part)
                if extracted:
                    return extracted
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str):
                        extracted = self._extract_url_from_text(text)
                        if extracted:
                            return extracted
        return None

    def _extract_url_from_payload(self, payload: Any) -> str | None:
        if isinstance(payload, str):
            return self._extract_url_from_text(payload)
        if not isinstance(payload, dict):
            return None

        direct = self._extract_url_from_payload_item(payload)
        if direct:
            return direct

        choices = payload.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                for key in ("message", "delta"):
                    node = choice.get(key)
                    if isinstance(node, dict):
                        extracted = self._extract_url_from_chat_content(node.get("content"))
                        if extracted:
                            return extracted

        for key in ("data", "images", "output_images", "outputs"):
            value = payload.get(key)
            if isinstance(value, list):
                for item in value:
                    extracted = self._extract_url_from_payload(item)
                    if extracted:
                        return extracted
            elif isinstance(value, (dict, str)):
                extracted = self._extract_url_from_payload(value)
                if extracted:
                    return extracted

        return None

    async def _cache_data_url_image(self, url: str) -> str:
        header, separator, encoded = url.partition(",")
        if not separator:
            return url

        content_type = header.removeprefix("data:").split(";")[0].strip().lower()
        ext = IMAGE_CONTENT_TYPE_EXTENSIONS.get(content_type)
        if not ext:
            return url

        try:
            content = base64.b64decode("".join(encoded.split()), validate=True)
        except Exception as exc:
            logger.warning("Failed to decode generated data URL image: %s", exc)
            return url

        static_dir = STATIC_DIR / "images"
        static_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid4().hex}{ext}"
        save_path = static_dir / filename
        save_path.write_bytes(content)
        return f"/static/images/{filename}"

    async def cache_external_image(self, url: str) -> str:
        """缓存外部图片到本地静态目录，返回本地 URL。

        仅处理 http(s) URL，失败时返回原始 URL。
        """
        if not url or url.startswith("/static/"):
            return url
        if url.startswith("data:"):
            return await self._cache_data_url_image(url)
        if not url.startswith(("http://", "https://")):
            return url

        try:
            client = await self._get_cache_client()
            res = await client.get(url)
            res.raise_for_status()
            content = res.content
            headers = res.headers

            content_type = headers.get("Content-Type", "").split(";")[0].strip().lower()
            ext = IMAGE_CONTENT_TYPE_EXTENSIONS.get(content_type)
            if not ext:
                suffix = Path(urlparse(url).path).suffix
                ext = suffix if suffix else ".png"

            static_dir = STATIC_DIR / "images"
            static_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid4().hex}{ext}"
            save_path = static_dir / filename
            save_path.write_bytes(content)

            return f"/static/images/{filename}"
        except Exception as exc:
            logger.warning("Failed to cache external image, using original URL: %s", exc)
            return url

    async def download_and_save(self, url: str, save_path: Path) -> None:
        """从 URL 下载图片并保存到本地

        Args:
            url: 图片 URL
            save_path: 保存路径（完整路径，包含文件名）
        """
        from urllib.request import urlopen
        from urllib.error import HTTPError, URLError

        save_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info(f"Downloading image from: {url[:100]}...")
        logger.debug(f"Full URL: {url}")
        logger.info(f"Saving to: {save_path}")

        try:
            # 使用 asyncio.to_thread 在线程池中运行同步的 urllib 代码
            def _download():
                try:
                    with urlopen(url, timeout=120) as response:
                        status = response.status
                        headers = dict(response.headers)

                        logger.info(f"Response status: {status}")
                        logger.debug(f"Response headers: {headers}")

                        if status != 200:
                            body = response.read().decode("utf-8", errors="ignore")
                            logger.error(f"Failed to download image. Status: {status}")
                            logger.error(f"Response body: {body[:500]}")
                            raise RuntimeError(f"Failed to download image (HTTP {status})")

                        # 检查内容类型
                        content_type = headers.get("Content-Type", "")
                        if not content_type.startswith("image/"):
                            logger.warning(f"Unexpected content type: {content_type}")

                        # 读取内容
                        content = response.read()
                        return content

                except HTTPError as e:
                    logger.error(f"HTTP error: {e.code} {e.reason}")
                    body = e.read().decode("utf-8", errors="ignore")
                    logger.error(f"Response body: {body[:500]}")
                    raise RuntimeError(f"Failed to download image (HTTP {e.code})") from e
                except URLError as e:
                    logger.error(f"URL error: {e.reason}")
                    raise RuntimeError(f"Failed to download image: {e.reason}") from e

            # 在线程池中执行下载
            content = await asyncio.to_thread(_download)

            # 保存文件
            with open(save_path, "wb") as f:
                f.write(content)

            logger.info(f"Successfully saved image ({len(content)} bytes)")

        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Unexpected error downloading image: {e}", exc_info=True)
            raise RuntimeError(f"Failed to download image: {str(e)[:100]}") from e

    async def _modelscope_generate(self, prompt: str, image_bytes: bytes | None = None) -> str:
        """ModelScope 异步图片生成"""
        if not self.settings.image_api_key:
            raise RuntimeError("IMAGE_API_KEY is required for ModelScope image generation")

        base_url = self.settings.image_base_url.rstrip("/")
        submit_url = self._build_url()
        headers = {
            "Authorization": f"Bearer {self.settings.image_api_key}",
            "Content-Type": "application/json",
            "X-ModelScope-Async-Mode": "true",
        }

        timeout = httpx.Timeout(300.0, connect=30.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. 提交生成任务
            payload = {
                "model": self.settings.image_model,
                "prompt": prompt,
            }
            requires_image_url = self._modelscope_requires_image_url()
            if image_bytes is not None and requires_image_url:
                payload["image_url"] = self._image_bytes_to_data_url(image_bytes)
            elif requires_image_url:
                payload["image_url"] = self._blank_canvas_data_url()

            res = await client.post(
                submit_url,
                headers=headers,
                json=payload,
            )
            res.raise_for_status()
            task_id = res.json().get("task_id")

            if not task_id:
                raise RuntimeError(f"ModelScope API did not return task_id: {res.json()}")

            # 2. 轮询任务状态
            poll_headers = {
                "Authorization": f"Bearer {self.settings.image_api_key}",
                "Content-Type": "application/json",
                "X-ModelScope-Task-Type": "image_generation",
            }

            max_polls = 60  # 最多轮询 60 次（5分钟）
            for _ in range(max_polls):
                result = await client.get(
                    f"{base_url}/v1/tasks/{task_id}",
                    headers=poll_headers,
                )
                result.raise_for_status()
                data = result.json()

                status = data.get("task_status")
                if status == "SUCCEED":
                    output_images = data.get("output_images", [])
                    if output_images:
                        return output_images[0]
                    raise RuntimeError(f"ModelScope task succeeded but no images: {data}")
                elif status == "FAILED":
                    raise RuntimeError(f"ModelScope image generation failed: {data}")

                # 等待 5 秒后继续轮询
                await asyncio.sleep(5)

            raise RuntimeError(f"ModelScope task timeout after {max_polls * 5} seconds")

    async def _post_json_with_retry(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        delay_s = 0.5
        last_exc: Exception | None = None

        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    res = await client.post(
                        url, headers=self.settings.image_headers(), json=payload
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
            f"Image generation request failed after retries: {last_exc}"
        ) from last_exc

    async def _post_stream_with_retry(self, url: str, payload: dict[str, Any]) -> str:
        """流式请求，收集所有 chunk 并提取最终 URL"""
        delay_s = 0.5
        last_exc: Exception | None = None

        timeout = httpx.Timeout(300.0, connect=30.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(self.max_retries + 1):
                try:
                    collected_content = ""
                    async with client.stream(
                        "POST", url, headers=self.settings.image_headers(), json=payload
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
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                if "error" in chunk:
                                    raise RuntimeError(f"Stream error: {chunk['error']}")
                                extracted = self._extract_url_from_payload(chunk)
                                if extracted:
                                    collected_content += extracted
                                    continue
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    # 收集 content 和 reasoning_content
                                    content = delta.get("content", "")
                                    reasoning_content = delta.get("reasoning_content", "")
                                    if content:
                                        collected_content += content
                                    if reasoning_content:
                                        collected_content += reasoning_content
                            except json.JSONDecodeError as e:
                                if "error" in data_str:
                                    try:
                                        err = json.loads(data_str)
                                        raise RuntimeError(f"Stream error: {err}")
                                    except json.JSONDecodeError:
                                        logger.debug(
                                            "Non-JSON error line in stream: %s", data_str[:100]
                                        )
                                else:
                                    logger.debug("Skipping non-JSON line in image stream: %s", e)
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
            f"Image generation stream failed after retries: {last_exc}"
        ) from last_exc

    async def generate(
        self,
        *,
        prompt: str,
        size: str = "1024x1024",
        n: int = 1,
        style: str | None = None,
        response_format: str = "url",
        stream: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        if self._is_modelscope_api():
            url = await self._modelscope_generate(prompt)
            return {"data": [{"url": url}]}

        url = self._build_url()

        if "/chat/completions" in self.settings.image_endpoint:
            payload: dict[str, Any] = {
                "model": self.settings.image_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": stream,
                **kwargs,
            }
        else:
            payload: dict[str, Any] = {
                "model": self.settings.image_model,
                "prompt": prompt,
                "size": size,
                "n": n,
                "response_format": response_format,
                **kwargs,
            }
            if style:
                payload["style"] = style

        return await self._post_json_with_retry(url, payload)

    async def generate_url(
        self,
        *,
        prompt: str,
        size: str = "1024x1024",
        image_bytes: bytes | None = None,
        **kwargs: Any,
    ) -> str:
        # ModelScope API（异步轮询模式）
        if self._is_modelscope_api():
            return await self._modelscope_generate(prompt, image_bytes=image_bytes)

        url = self._build_url()

        # 图生图（I2I）：仅在启用开关且提供参考图时尝试
        if image_bytes is not None and self.settings.use_i2i():
            try:
                image_base64 = base64.b64encode(image_bytes).decode("utf-8")

                # Chat Completions 风格（多模态）
                if "/chat/completions" in self.settings.image_endpoint:
                    payload: dict[str, Any] = {
                        "model": self.settings.image_model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": self._image_bytes_to_data_url(
                                                image_bytes,
                                                optimize_for_chat=True,
                                            )
                                        },
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
                    raise RuntimeError(f"Image API stream response missing URL: {content}")
                else:
                    # 标准图片生成接口（图生图）
                    payload = {
                        "model": self.settings.image_model,
                        "prompt": prompt,
                        "size": size,
                        "n": 1,
                        "response_format": "url",
                        "image": image_base64,
                        **kwargs,
                    }
                    data = await self._post_json_with_retry(url, payload)
                    extracted = self._extract_url_from_payload(data)
                    if extracted:
                        return extracted

                    raise RuntimeError(f"Image API response missing URL: {data}")
            except Exception as exc:
                # 降级：I2I 失败自动回退到文生图
                logger.warning(
                    "Image-to-image failed, falling back to text-to-image: %s",
                    exc,
                    exc_info=True,
                )

        # 文生图（原有逻辑）
        # Chat Completions 风格（流式模式）
        if "/chat/completions" in self.settings.image_endpoint:
            payload = {
                "model": self.settings.image_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
                **kwargs,
            }
            content = await self._post_stream_with_retry(url, payload)

            extracted = self._extract_url_from_text(content)
            if extracted:
                return extracted
            raise RuntimeError(f"Image API stream response missing URL: {content}")

        # DALL-E 风格（非流式）
        data = await self.generate(prompt=prompt, size=size, response_format="url", **kwargs)
        extracted = self._extract_url_from_payload(data)
        if extracted:
            return extracted

        raise RuntimeError(f"Image API response missing URL: {data}")
