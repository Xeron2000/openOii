from __future__ import annotations

from functools import lru_cache
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "openOii-backend"
    environment: str = Field(default="dev", description="dev|staging|prod")
    log_level: str = Field(default="INFO", description="Uvicorn log level")

    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    # 数据库（默认使用 PostgreSQL）
    database_url: str = Field(
        default="postgresql+asyncpg://openoii:openoii_dev@localhost:5432/openoii"
    )
    db_echo: bool = False

    # Redis（用于 confirm 信号共享）
    redis_url: str = Field(default="redis://localhost:6379/0")

    # ============================================
    # LLM 服务 (Claude Agent SDK - Anthropic 形式接口)
    # ============================================
    anthropic_api_key: str | None = None
    anthropic_auth_token: str | None = Field(
        default=None,
        description="中转站 Token（大概率用这个）",
    )
    anthropic_base_url: str | None = Field(
        default=None,
        description="Anthropic 中转站/代理地址，例如 https://your-proxy.example.com",
    )
    anthropic_model: str = Field(
        default="claude-sonnet-4-5-20250929",
        description="Claude 模型名称（中转站会自动转换为对应模型）",
    )

    # ============================================
    # 图像生成服务 (OpenAI 兼容接口)
    # ============================================
    image_base_url: str = Field(
        default="https://api.openai.com/v1",
        description="图像生成服务基础地址",
    )
    image_api_key: str | None = None
    image_model: str = Field(
        default="dall-e-3",
        description="图像生成模型名称",
    )
    image_endpoint: str = Field(
        default="/images/generations",
        description="图像生成 API 端点路径",
    )
    enable_image_to_image: bool = Field(
        default=False,
        description="是否启用图生图（分镜首帧 I2I 参考图）",
    )

    # ============================================
    # 视频生成服务 (OpenAI 兼容接口)
    # ============================================
    video_base_url: str = Field(
        default="https://api.example.com/v1",
        description="视频生成服务基础地址",
    )
    video_api_key: str | None = None
    video_model: str = Field(
        default="video-gen-1",
        description="视频生成模型名称",
    )
    video_endpoint: str = Field(
        default="/videos/generations",
        description="视频生成 API 端点路径",
    )
    video_mode: str = Field(
        default="text",
        description="视频生成模式：text（文生视频）或 image（图生视频）",
    )
    enable_image_to_video: bool = Field(
        default=False,
        description="是否启用图生视频（分镜视频 I2V 参考图）",
    )

    # ============================================
    # 豆包视频生成服务（火山引擎 Ark API）
    # ============================================
    doubao_api_key: str | None = Field(
        default=None,
        description="豆包 API Key（火山引擎 ARK_API_KEY）",
    )
    doubao_video_model: str = Field(
        default="doubao-seedance-1-5-pro-251215",
        description="豆包视频生成模型 ID",
    )
    doubao_video_duration: int = Field(
        default=5,
        description="豆包视频时长（5 或 10 秒）",
    )
    doubao_video_ratio: str = Field(
        default="adaptive",
        description="豆包视频比例：16:9, 9:16, 1:1, adaptive",
    )
    doubao_generate_audio: bool = Field(
        default=True,
        description="豆包视频是否生成音频",
    )
    video_image_mode: str = Field(
        default="first_frame",
        description="图生视频模式：first_frame（仅分镜首帧）或 reference（拼接参考图）",
    )
    video_inline_local_images: bool = Field(
        default=True,
        description="图生视频时，未配置 PUBLIC_BASE_URL 则尝试内联本地图片为 data URL",
    )

    # 视频服务提供商选择
    video_provider: str = Field(
        default="openai",
        description="视频服务提供商：openai（OpenAI 兼容接口）或 doubao（豆包）",
    )

    request_timeout_s: float = 120.0
    public_base_url: str | None = Field(
        default=None,
        description="对外可访问的后端地址（用于把 /static 路径转换为完整 URL）",
    )

    def use_i2i(self) -> bool:
        """是否启用图生图（I2I）"""
        return bool(self.enable_image_to_image)

    def use_i2v(self) -> bool:
        """是否启用图生视频（I2V）

        兼容旧配置：VIDEO_MODE=image 仍视为启用 I2V。
        """
        return bool(self.enable_image_to_video) or self.video_mode == "image"

    def image_headers(self) -> dict[str, str]:
        """图像服务请求头"""
        headers: dict[str, str] = {"User-Agent": self.app_name}
        if self.image_api_key:
            headers["Authorization"] = f"Bearer {self.image_api_key}"
        return headers

    def video_headers(self) -> dict[str, str]:
        """视频服务请求头"""
        headers: dict[str, str] = {"User-Agent": self.app_name}
        if self.video_api_key:
            headers["Authorization"] = f"Bearer {self.video_api_key}"
        return headers

    def anthropic_env(self) -> dict[str, Any]:
        """Anthropic 环境变量（用于 Claude Agent SDK）"""
        env: dict[str, Any] = {}
        if self.anthropic_api_key:
            env["ANTHROPIC_API_KEY"] = self.anthropic_api_key
        if self.anthropic_auth_token:
            env["ANTHROPIC_AUTH_TOKEN"] = self.anthropic_auth_token
        if self.anthropic_base_url:
            env["ANTHROPIC_BASE_URL"] = self.anthropic_base_url
        return env

    def build_public_url(self, path: str | None) -> str | None:
        """将本地路径（如 /static/xxx）转换为对外可访问的完整 URL"""
        if not path:
            return path
        if path.startswith(("http://", "https://")):
            return path
        if not self.public_base_url:
            return path
        normalized = path if path.startswith("/") else f"/{path}"
        return f"{self.public_base_url.rstrip('/')}{normalized}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
