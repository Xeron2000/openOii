"""文件清理服务

负责删除旧的图片和视频文件，避免磁盘空间浪费。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# 静态文件目录
STATIC_DIR = Path(__file__).parent.parent / "static"


def _extract_static_path(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("/static/"):
        return url
    parsed = urlparse(url)
    if parsed.path.startswith("/static/"):
        return parsed.path
    return None


def is_local_file(url: str | None) -> bool:
    """判断 URL 是否指向本地文件"""
    return _extract_static_path(url) is not None


def get_local_path(url: str) -> Path | None:
    """将本地 URL 转换为文件系统路径

    安全检查：验证最终路径在 STATIC_DIR 内，防止路径遍历攻击
    """
    static_path = _extract_static_path(url)
    if not static_path:
        return None
    # /static/videos/xxx.mp4 -> backend/app/static/videos/xxx.mp4
    relative_path = static_path.removeprefix("/static/")
    resolved_path = (STATIC_DIR / relative_path).resolve()

    # 安全检查：确保路径在 STATIC_DIR 内
    try:
        resolved_path.relative_to(STATIC_DIR.resolve())
    except ValueError:
        logger.warning(f"Path traversal attempt detected: {url}")
        return None

    return resolved_path


def delete_file(url: str | None) -> bool:
    """删除本地文件

    Args:
        url: 文件 URL（如 /static/videos/xxx.mp4）

    Returns:
        是否成功删除
    """
    if not url:
        return False

    path = get_local_path(url)
    if not path:
        logger.debug(f"Not a local file, skipping: {url}")
        return False

    if not path.exists():
        logger.debug(f"File not found, skipping: {path}")
        return False

    try:
        os.remove(path)
        logger.info(f"Deleted file: {path}")
        return True
    except OSError as e:
        logger.warning(f"Failed to delete file {path}: {e}")
        return False


def delete_files(urls: list[str | None]) -> int:
    """批量删除本地文件

    Args:
        urls: 文件 URL 列表

    Returns:
        成功删除的文件数量
    """
    count = 0
    for url in urls:
        if delete_file(url):
            count += 1
    return count
