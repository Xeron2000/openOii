from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ConfigItemRead(BaseModel):
    key: str
    value: str | None
    is_sensitive: bool
    is_masked: bool
    source: Literal["db", "env"]


class ConfigUpdateRequest(BaseModel):
    configs: dict[str, str | None] = Field(default_factory=dict)


class ConfigUpdateResponse(BaseModel):
    updated: int
    skipped: int
    restart_required: bool
    restart_keys: list[str]
    message: str


class TestConnectionRequest(BaseModel):
    service: Literal["llm", "image", "video"]
    # 可选：传递当前表单中的配置值（用于测试未保存的配置）
    config_overrides: dict[str, str | None] | None = None


class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    details: str | None = None


class RevealValueRequest(BaseModel):
    key: str


class RevealValueResponse(BaseModel):
    key: str
    value: str | None
