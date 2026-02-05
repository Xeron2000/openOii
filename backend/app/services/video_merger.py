"""视频拼接服务

使用 ffmpeg 将多个视频片段拼接成一个完整视频。
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# 输出目录（相对于 backend 目录）
OUTPUT_DIR = Path(__file__).parent.parent / "static" / "videos"


class VideoMergerService:
    """视频拼接服务

    使用 ffmpeg 的 concat demuxer 拼接多个视频文件。
    """

    def __init__(self, output_dir: Path | None = None):
        """初始化视频拼接服务

        Args:
            output_dir: 输出目录，默认为 backend/app/static/videos
        """
        self.output_dir = output_dir or OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """获取或创建 HTTP 客户端（连接复用）"""
        if self._client is None or self._client.is_closed:
            timeout = httpx.Timeout(300.0, connect=30.0)  # 5分钟超时
            self._client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        return self._client

    async def close(self) -> None:
        """关闭 HTTP 客户端"""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def download_video(self, url: str, dest_path: Path) -> None:
        """下载视频文件

        Args:
            url: 视频 URL
            dest_path: 目标路径
        """
        client = await self._get_client()
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with open(dest_path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    f.write(chunk)
        logger.info(f"Downloaded video to {dest_path}")

    async def merge_videos(
        self,
        video_urls: list[str],
        output_filename: str | None = None,
    ) -> str:
        """拼接多个视频

        Args:
            video_urls: 视频 URL 列表
            output_filename: 输出文件名（不含扩展名），默认自动生成

        Returns:
            拼接后视频的本地路径（相对于 static 目录）
        """
        if not video_urls:
            raise ValueError("No video URLs provided")

        if len(video_urls) == 1:
            # 只有一个视频，直接返回
            return video_urls[0]

        # 生成输出文件名
        if not output_filename:
            output_filename = f"merged_{uuid.uuid4().hex[:8]}"

        output_path = self.output_dir / f"{output_filename}.mp4"

        # 创建临时目录存放下载的视频
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            downloaded_files: list[Path] = []

            # 并行下载所有视频
            logger.info(f"Downloading {len(video_urls)} videos...")
            download_tasks = []
            for i, url in enumerate(video_urls):
                # 从 URL 推断扩展名，默认 mp4
                ext = ".mp4"
                if "." in url.split("/")[-1].split("?")[0]:
                    ext = "." + url.split("/")[-1].split("?")[0].split(".")[-1]

                dest = temp_path / f"video_{i:03d}{ext}"
                downloaded_files.append(dest)
                download_tasks.append(self.download_video(url, dest))

            await asyncio.gather(*download_tasks)
            logger.info(f"All {len(video_urls)} videos downloaded")

            # 创建 ffmpeg concat 文件列表
            concat_file = temp_path / "concat.txt"
            with open(concat_file, "w") as f:
                for video_file in downloaded_files:
                    # ffmpeg concat 格式需要转义单引号
                    escaped_path = str(video_file).replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")

            # 使用 ffmpeg 拼接视频
            # -f concat: 使用 concat demuxer
            # -safe 0: 允许绝对路径
            # -c copy: 直接复制流，不重新编码（快速）
            # 如果视频格式不一致，需要重新编码
            cmd = [
                "ffmpeg",
                "-y",  # 覆盖输出文件
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_file),
                "-c", "copy",  # 尝试直接复制
                str(output_path),
            ]

            logger.info(f"Running ffmpeg: {' '.join(cmd)}")

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                # 如果直接复制失败，尝试重新编码
                logger.warning(f"ffmpeg copy failed, trying re-encode: {stderr.decode()}")

                cmd_reencode = [
                    "ffmpeg",
                    "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", str(concat_file),
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(output_path),
                ]

                logger.info(f"Running ffmpeg (re-encode): {' '.join(cmd_reencode)}")

                process = await asyncio.create_subprocess_exec(
                    *cmd_reencode,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await process.communicate()

                if process.returncode != 0:
                    raise RuntimeError(f"ffmpeg failed: {stderr.decode()}")

            logger.info(f"Video merged successfully: {output_path}")

        # 返回相对路径（用于构建 URL）
        return f"/static/videos/{output_filename}.mp4"


# 全局单例
_merger_service: VideoMergerService | None = None


def get_video_merger_service() -> VideoMergerService:
    """获取视频拼接服务单例"""
    global _merger_service
    if _merger_service is None:
        _merger_service = VideoMergerService()
    return _merger_service
