from __future__ import annotations

import httpx
from fastapi import APIRouter, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.config import get_settings
from app.schemas.config import (
    ConfigItemRead,
    ConfigUpdateRequest,
    ConfigUpdateResponse,
    RevealValueRequest,
    RevealValueResponse,
    TestConnectionRequest,
    TestConnectionResponse,
)
from app.services.config_service import ConfigService

router = APIRouter()


@router.get("", response_model=list[ConfigItemRead])
async def list_configs(session: AsyncSession = SessionDep):
    service = ConfigService(session)
    return await service.list_effective()


@router.post("/reveal", response_model=RevealValueResponse)
async def reveal_value(payload: RevealValueRequest, session: AsyncSession = SessionDep):
    """获取敏感配置的真实值（用于前端显示）"""
    service = ConfigService(session)
    value = await service.get_raw_value(payload.key)
    return RevealValueResponse(key=payload.key, value=value)


@router.put("", response_model=ConfigUpdateResponse, status_code=status.HTTP_200_OK)
@router.post("", response_model=ConfigUpdateResponse, status_code=status.HTTP_200_OK)
async def update_configs(
    payload: ConfigUpdateRequest,
    session: AsyncSession = SessionDep,
):
    service = ConfigService(session)
    result = await service.upsert_configs(payload.configs)
    await service.apply_settings_overrides()
    restart_required = bool(result.restart_keys)
    message = "配置已更新，请重启服务使更改生效" if restart_required else "配置已更新"
    return ConfigUpdateResponse(
        updated=result.updated,
        skipped=result.skipped,
        restart_required=restart_required,
        restart_keys=result.restart_keys,
        message=message,
    )


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(payload: TestConnectionRequest):
    """测试服务连接"""
    settings = get_settings()

    # 如果传递了配置覆盖，创建临时配置对象
    if payload.config_overrides:
        # 将覆盖值应用到 settings 的副本
        settings_dict = settings.model_dump()

        for key, value in payload.config_overrides.items():
            field_name = key.lower()
            if field_name in settings_dict:
                # 检查是否是脱敏值（包含 ***）
                if value and isinstance(value, str) and "***" in value:
                    # 是脱敏值，不覆盖，使用数据库/环境变量中的原始值
                    continue
                # 不是脱敏值，使用传递的值
                if value is not None:
                    settings_dict[field_name] = value

        from app.config import Settings
        settings = Settings.model_validate(settings_dict)

    if payload.service == "llm":
        return await _test_llm_connection(settings)
    elif payload.service == "image":
        return await _test_image_connection(settings)
    elif payload.service == "video":
        return await _test_video_connection(settings)

    return TestConnectionResponse(success=False, message="未知服务类型")


async def _test_llm_connection(settings) -> TestConnectionResponse:
    """测试 LLM 服务连接（使用实际服务类）"""
    try:
        from app.services.llm import LLMService

        # 实例化服务
        service = LLMService(settings, max_retries=0)

        # 尝试发送最小请求
        try:
            await service.generate(
                messages=[{"role": "user", "content": "test"}],
                max_tokens=1
            )
            # 成功
            return TestConnectionResponse(
                success=True,
                message="LLM 服务连接成功",
                details=f"模型: {settings.anthropic_model}"
            )
        except Exception as e:
            # 检查是否是认证错误
            error_str = str(e).lower()
            if "401" in error_str or "unauthorized" in error_str or "authentication" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="认证失败",
                    details=f"API Key 无效或已过期: {str(e)[:200]}"
                )
            elif "403" in error_str or "forbidden" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="认证失败",
                    details=f"权限不足: {str(e)[:200]}"
                )
            elif "404" in error_str or "not found" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="API 端点不存在",
                    details=f"请检查 BASE_URL 配置: {str(e)[:200]}"
                )
            else:
                # 其他错误也返回失败
                return TestConnectionResponse(
                    success=False,
                    message="连接失败",
                    details=str(e)[:200]
                )
    except Exception as e:
        return TestConnectionResponse(
            success=False,
            message="连接失败",
            details=str(e)[:200]
        )


async def _test_image_connection(settings) -> TestConnectionResponse:
    """测试图像生成服务连接（使用实际服务类）"""
    try:
        from app.services.image import ImageService

        # 实例化服务
        service = ImageService(settings, max_retries=0)

        # 尝试发送最小请求
        try:
            # 使用完整参数避免 400 错误
            await service.generate(
                prompt="test",
                size="1024x1024",
                n=1
            )
            # 成功
            return TestConnectionResponse(
                success=True,
                message="图像服务连接成功",
                details=f"模型: {settings.image_model}"
            )
        except Exception as e:
            # 检查是否是认证错误
            error_str = str(e).lower()
            if "401" in error_str or "unauthorized" in error_str or "authentication" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="认证失败",
                    details=f"API Key 无效或已过期: {str(e)[:200]}"
                )
            elif "403" in error_str or "forbidden" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="认证失败",
                    details=f"权限不足: {str(e)[:200]}"
                )
            elif "404" in error_str or "not found" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="API 端点不存在",
                    details=f"请检查 IMAGE_BASE_URL 和 IMAGE_ENDPOINT 配置: {str(e)[:200]}"
                )
            else:
                # 其他错误也返回失败
                return TestConnectionResponse(
                    success=False,
                    message="连接失败",
                    details=str(e)[:200]
                )
    except Exception as e:
        return TestConnectionResponse(
            success=False,
            message="连接失败",
            details=str(e)[:200]
        )


async def _test_video_connection(settings) -> TestConnectionResponse:
    """测试视频生成服务连接（使用实际服务类）"""
    try:
        from app.services.video_factory import create_video_service

        # 获取实际使用的视频服务
        service = create_video_service(settings)

        # 尝试发送最小请求
        try:
            # 根据服务类型调用不同的方法
            if settings.video_provider == "doubao":
                # 豆包服务使用 generate_url 方法
                await service.generate_url(
                    prompt="test",
                    duration=5,
                    ratio="16:9"
                )
            else:
                # OpenAI 兼容服务使用 generate 方法
                await service.generate(prompt="test")

            # 成功
            return TestConnectionResponse(
                success=True,
                message="视频服务连接成功",
                details=f"提供商: {settings.video_provider}, 模型: {settings.doubao_video_model if settings.video_provider == 'doubao' else settings.video_model}"
            )
        except Exception as e:
            # 检查是否是认证错误
            error_str = str(e).lower()
            if "401" in error_str or "unauthorized" in error_str or "authentication" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="认证失败",
                    details=f"API Key 无效或已过期: {str(e)[:200]}"
                )
            elif "403" in error_str or "forbidden" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="认证失败",
                    details=f"权限不足: {str(e)[:200]}"
                )
            elif "404" in error_str or "not found" in error_str:
                return TestConnectionResponse(
                    success=False,
                    message="API 端点不存在",
                    details=f"请检查视频服务配置: {str(e)[:200]}"
                )
            else:
                # 其他错误也返回失败
                return TestConnectionResponse(
                    success=False,
                    message="连接失败",
                    details=str(e)[:200]
                )
    except Exception as e:
        return TestConnectionResponse(
            success=False,
            message="连接失败",
            details=str(e)[:200]
        )
