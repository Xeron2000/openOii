from __future__ import annotations
from typing import Literal, Protocol

from app.config import Settings
from app.schemas.project import ProjectProviderEntry, ProviderResolution
from app.services.llm import LLMService
from app.services.text import TextService
from app.services.text_capabilities import (
    TextProviderCapability,
    build_provider_capability_cache_key,
    get_cached_provider_capability,
    set_cached_provider_capability,
)


class ProjectProviderOverrides(Protocol):
    text_provider_override: str | None
    image_provider_override: str | None
    video_provider_override: str | None


TEXT_PROVIDER_KEYS = ("anthropic", "openai", "fake")
IMAGE_PROVIDER_KEYS = ("modelscope", "openai", "fake")
VIDEO_PROVIDER_KEYS = ("openai", "doubao", "fake")
TEXT_PROBE_TTL_S = 300.0
TEXT_PROBE_GENERATE_FAILURE_TTL_S = 15.0
TEXT_PROBE_TIMEOUT_S = 60.0
TEXT_PROBE_MAX_RETRIES = 1


def _normalize_provider_key(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def _missing_credentials_message(label: str) -> str:
    return f"{label} Provider 缺少凭据，当前无法启动。"


def _default_capabilities(*, generate: bool | None, stream: bool | None = None) -> ProjectProviderEntry.Capabilities:
    return ProjectProviderEntry.Capabilities(generate=generate, stream=stream)


def _provider_snapshot_payload(snapshot: object) -> dict[str, object] | None:
    if isinstance(snapshot, dict):
        return snapshot
    if hasattr(snapshot, "model_dump"):
        try:
            dumped = snapshot.model_dump(mode="json")  # type: ignore[attr-defined]
        except Exception:
            return None
        if isinstance(dumped, dict):
            return dumped
    return None


def settings_with_provider_snapshot(
    settings: Settings,
    provider_snapshot: dict[str, object] | None,
) -> Settings:
    """Use snapshot selection as source of truth for settings.

    text_provider, image_provider, and video_provider are copied from snapshot.selected_key directly,
    without any fallback to current settings.
    """
    snapshot = _provider_snapshot_payload(provider_snapshot)
    if snapshot is None:
        return settings.model_copy()

    text_key = None
    image_key = None
    video_key = None

    text_entry = snapshot.get("text")
    if isinstance(text_entry, dict):
        text_key = text_entry.get("selected_key")

    image_entry = snapshot.get("image")
    if isinstance(image_entry, dict):
        image_key = image_entry.get("selected_key")

    video_entry = snapshot.get("video")
    if isinstance(video_entry, dict):
        video_key = video_entry.get("selected_key")

    if isinstance(text_key, str):
        settings = settings.model_copy(update={"text_provider": text_key})
    if isinstance(image_key, str):
        settings = settings.model_copy(update={"image_provider": image_key})
    if isinstance(video_key, str):
        settings = settings.model_copy(update={"video_provider": video_key})

    return settings


def _text_probe_cache_key(settings: Settings) -> str:
    return build_provider_capability_cache_key(
        provider=settings.text_provider,
        text_base_url=settings.text_base_url,
        text_model=settings.text_model,
        text_endpoint=settings.text_endpoint,
        anthropic_base_url=settings.anthropic_base_url,
        anthropic_model=settings.anthropic_model,
        secret=settings.text_api_key or settings.anthropic_api_key or settings.anthropic_auth_token,
    )


def _text_credentials_available(provider_key: str | None, settings: Settings) -> bool:
    if provider_key == "anthropic":
        return bool(settings.anthropic_api_key or settings.anthropic_auth_token)
    if provider_key == "openai":
        return bool(settings.text_api_key)
    if provider_key == "fake":
        return True
    return False


def _text_probe_cache_ttl(result: TextProviderCapability) -> float:
    if result.status == "invalid" and result.reason_code == "provider_generate_unavailable":
        return TEXT_PROBE_GENERATE_FAILURE_TTL_S
    return TEXT_PROBE_TTL_S


async def probe_text_provider(settings: Settings) -> TextProviderCapability:
    cache_key = _text_probe_cache_key(settings)
    cached = get_cached_provider_capability(cache_key)
    if cached is not None:
        return cached

    probe_settings = settings.model_copy(
        update={"request_timeout_s": min(settings.request_timeout_s, TEXT_PROBE_TIMEOUT_S)}
    )

    if probe_settings.text_provider == "anthropic":
        service = LLMService(probe_settings, max_retries=TEXT_PROBE_MAX_RETRIES)
    elif probe_settings.text_provider == "openai":
        service = TextService(probe_settings, max_retries=TEXT_PROBE_MAX_RETRIES)
    elif probe_settings.text_provider == "fake":
        from app.services.fake_text import FakeTextService

        service = FakeTextService(probe_settings)
    else:
        result = TextProviderCapability(
            status="invalid",
            generate=False,
            stream=False,
            reason_code="provider_unsupported",
            reason_message=f"文本 Provider '{probe_settings.text_provider}' 不受支持。",
        )
        return set_cached_provider_capability(cache_key, result, ttl_s=_text_probe_cache_ttl(result))

    result = await service.probe()
    return set_cached_provider_capability(cache_key, result, ttl_s=_text_probe_cache_ttl(result))


def get_cached_text_provider_probe(settings: Settings) -> TextProviderCapability | None:
    return get_cached_provider_capability(_text_probe_cache_key(settings))


def _resolve_entry(
    *,
    override_key: str | None,
    default_key: str | None,
    supported_keys: tuple[str, ...],
    credential_ok: dict[str, bool],
    modality_label: Literal["文本", "图像", "视频"],
    probe: TextProviderCapability | None = None,
) -> ProjectProviderEntry:
    normalized_override = _normalize_provider_key(override_key)
    normalized_default = _normalize_provider_key(default_key)

    selected_key = normalized_override or normalized_default
    source: Literal["project", "default"] = "project" if normalized_override else "default"

    if selected_key is None:
        return ProjectProviderEntry(
            selected_key="",
            source=source,
            resolved_key=None,
            valid=False,
            status="invalid",
            reason_code="provider_default_unavailable",
            reason_message=f"{modality_label} Provider 默认值不可用。",
            capabilities=_default_capabilities(generate=False),
        )

    if selected_key not in supported_keys:
        reason_code = "provider_unknown" if source == "default" else "provider_unsupported"
        return ProjectProviderEntry(
            selected_key=selected_key,
            source=source,
            resolved_key=None,
            valid=False,
            status="invalid",
            reason_code=reason_code,
            reason_message=f"{modality_label} Provider '{selected_key}' 不受支持。",
            capabilities=_default_capabilities(generate=False),
        )

    if not credential_ok.get(selected_key, False):
        return ProjectProviderEntry(
            selected_key=selected_key,
            source=source,
            resolved_key=None,
            valid=False,
            status="invalid",
            reason_code="provider_missing_credentials",
            reason_message=_missing_credentials_message(selected_key),
            capabilities=_default_capabilities(generate=False),
        )

    if probe is not None:
        if probe.status == "invalid":
            return ProjectProviderEntry(
                selected_key=selected_key,
                source=source,
                resolved_key=None,
                valid=False,
                status="invalid",
                reason_code=probe.reason_code,
                reason_message=probe.reason_message,
                capabilities=_default_capabilities(generate=probe.generate, stream=probe.stream),
            )
        if probe.status == "degraded":
            return ProjectProviderEntry(
                selected_key=selected_key,
                source=source,
                resolved_key=selected_key,
                valid=True,
                status="degraded",
                reason_code=probe.reason_code,
                reason_message=probe.reason_message,
                capabilities=_default_capabilities(generate=probe.generate, stream=probe.stream),
            )

    return ProjectProviderEntry(
        selected_key=selected_key,
        source=source,
        resolved_key=selected_key,
        valid=True,
        status="valid",
        reason_code=None,
        reason_message=None,
        capabilities=_default_capabilities(
            generate=True,
            stream=True if modality_label == "文本" else None,
        ),
    )


def resolve_project_provider_settings(
    project: ProjectProviderOverrides,
    settings: Settings,
    *,
    text_probe: TextProviderCapability | None = None,
) -> ProviderResolution:
    text = _resolve_entry(
        override_key=project.text_provider_override,
        default_key=settings.text_provider,
        supported_keys=TEXT_PROVIDER_KEYS,
        credential_ok={
            "anthropic": bool(settings.anthropic_api_key or settings.anthropic_auth_token),
            "openai": bool(settings.text_api_key),
            "fake": True,
        },
        modality_label="文本",
        probe=text_probe,
    )
    image = _resolve_entry(
        override_key=project.image_provider_override,
        default_key=settings.image_provider,
        supported_keys=IMAGE_PROVIDER_KEYS,
        credential_ok={
            "modelscope": bool(settings.image_api_key),
            "openai": bool(settings.image_api_key),
            "fake": True,
        },
        modality_label="图像",
    )
    video = _resolve_entry(
        override_key=project.video_provider_override,
        default_key=settings.video_provider,
        supported_keys=VIDEO_PROVIDER_KEYS,
        credential_ok={
            "openai": bool(settings.video_api_key),
            "doubao": bool(settings.doubao_api_key),
            "fake": True,
        },
        modality_label="视频",
    )

    return ProviderResolution(
        valid=text.valid and image.valid and video.valid,
        text=text,
        image=image,
        video=video,
    )


async def resolve_project_provider_settings_async(
    project: ProjectProviderOverrides,
    settings: Settings,
    *,
    probe_mode: Literal["live", "cache_only"] = "live",
) -> ProviderResolution:
    selected_text_key = _normalize_provider_key(project.text_provider_override) or _normalize_provider_key(
        settings.text_provider
    )
    text_probe: TextProviderCapability | None = None

    if selected_text_key in TEXT_PROVIDER_KEYS and _text_credentials_available(selected_text_key, settings):
        probe_settings = settings.model_copy(update={"text_provider": selected_text_key})
        text_probe = (
            get_cached_text_provider_probe(probe_settings)
            if probe_mode == "cache_only"
            else await probe_text_provider(probe_settings)
        )

    return resolve_project_provider_settings(project, settings, text_probe=text_probe)
