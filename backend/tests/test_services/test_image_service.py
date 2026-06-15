from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.services.image import ImageService


def test_build_url():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://img.example.com/",
        image_endpoint="images/generations",
    )
    service = ImageService(settings)
    assert service._build_url() == "https://img.example.com/images/generations"


def test_is_modelscope_api_detects_hostname():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://API.ModelScope.CN",
        image_endpoint="/images/generations",
    )
    service = ImageService(settings)

    assert service._is_modelscope_api() is True


def test_extract_url_from_text_handles_data_and_wrapped_urls():
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    assert (
        service._extract_url_from_text("data:image/png;base64,abc") == "data:image/png;base64,abc"
    )
    assert (
        service._extract_url_from_text("see https://cdn.example.com/a.png).")
        == "https://cdn.example.com/a.png"
    )
    assert (
        service._extract_url_from_text("![image_1](data:image/png;base64,aGVsbG8=)")
        == "data:image/png;base64,aGVsbG8="
    )
    assert service._extract_url_from_text("no url here") is None


def test_extract_url_from_chat_completion_payload():
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    payload = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "![image_1](data:image/png;base64,aGVsbG8=)",
                }
            }
        ]
    }

    assert service._extract_url_from_payload(payload) == "data:image/png;base64,aGVsbG8="


def test_sanitize_url_strips_wrappers():
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    assert (
        service._sanitize_url('"https://cdn.example.com/a.png],"')
        == "https://cdn.example.com/a.png"
    )


@pytest.mark.asyncio
async def test_cache_external_image_skips_non_http_urls(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    assert await service.cache_external_image("") == ""
    assert (
        await service.cache_external_image("data:image/png;base64,abc")
        == "data:image/png;base64,abc"
    )
    assert await service.cache_external_image("/static/images/a.png") == "/static/images/a.png"
    assert await service.cache_external_image("file:///tmp/a.png") == "file:///tmp/a.png"


@pytest.mark.asyncio
async def test_cache_external_image_saves_with_fallback_extension(monkeypatch, tmp_path):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeResponse:
        headers = {"Content-Type": "application/octet-stream"}
        content = b"img"

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self):
            self.is_closed = False

        async def get(self, url):
            return FakeResponse()

    async def fake_get_cache_client():
        return FakeClient()

    monkeypatch.setattr(service, "_get_cache_client", fake_get_cache_client)
    monkeypatch.setattr("app.services.image.STATIC_DIR", tmp_path)

    result = await service.cache_external_image("https://cdn.example.com/a")

    assert result.startswith("/static/images/")
    assert result.endswith(".png")


@pytest.mark.asyncio
async def test_cache_external_image_returns_original_on_failure(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    async def boom():
        raise RuntimeError("down")

    monkeypatch.setattr(service, "_get_cache_client", boom)

    assert (
        await service.cache_external_image("https://cdn.example.com/a.png")
        == "https://cdn.example.com/a.png"
    )


@pytest.mark.asyncio
async def test_cache_external_image_saves_data_url(monkeypatch, tmp_path):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    monkeypatch.setattr("app.services.image.STATIC_DIR", tmp_path)

    result = await service.cache_external_image("data:image/png;base64,aGVsbG8=")

    assert result.startswith("/static/images/")
    saved = tmp_path / result.removeprefix("/static/")
    assert saved.read_bytes() == b"hello"


@pytest.mark.asyncio
async def test_generate_url_dalle(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_post(url, payload):
        return {"data": [{"url": "https://cdn.example.com/image.png"}]}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    url = await service.generate_url(prompt="cat")
    assert url == "https://cdn.example.com/image.png"


@pytest.mark.asyncio
async def test_generate_url_chat_completions(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_stream(url, payload):
        return "result https://cdn.example.com/stream.png done"

    monkeypatch.setattr(service, "_post_stream_with_retry", fake_stream)

    url = await service.generate_url(prompt="cat")
    assert url == "https://cdn.example.com/stream.png"


@pytest.mark.asyncio
async def test_generate_url_chat_completions_extracts_markdown_data_url(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_stream(url, payload):
        return "![image_1](data:image/png;base64,aGVsbG8=)"

    monkeypatch.setattr(service, "_post_stream_with_retry", fake_stream)

    url = await service.generate_url(prompt="cat")
    assert url == "data:image/png;base64,aGVsbG8="


@pytest.mark.asyncio
async def test_generate_url_dalle_accepts_b64_json(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_post(url, payload):
        return {"data": [{"b64_json": "aGVsbG8="}]}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    url = await service.generate_url(prompt="cat")
    assert url == "data:image/png;base64,aGVsbG8="


@pytest.mark.asyncio
async def test_generate_url_modelscope(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_modelscope(prompt, image_bytes=None):
        assert image_bytes is None
        return "https://modelscope.example.com/image.png"

    monkeypatch.setattr(service, "_modelscope_generate", fake_modelscope)

    url = await service.generate_url(prompt="cat")
    assert url == "https://modelscope.example.com/image.png"


@pytest.mark.asyncio
async def test_generate_url_fallback_from_i2i(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
        enable_image_to_image=True,
    )
    service = ImageService(settings)

    async def fail_post(url, payload):
        raise RuntimeError("boom")

    async def fake_generate(*args, **kwargs):
        return {"data": [{"url": "https://cdn.example.com/fallback.png"}]}

    monkeypatch.setattr(service, "_post_json_with_retry", fail_post)
    monkeypatch.setattr(service, "generate", fake_generate)

    url = await service.generate_url(prompt="cat", image_bytes=b"fake")
    assert url == "https://cdn.example.com/fallback.png"


@pytest.mark.asyncio
async def test_generate_url_uses_dalle_payload_when_image_bytes_without_i2i(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
        enable_image_to_image=False,
    )
    service = ImageService(settings)

    seen = {}

    async def fake_generate(*, prompt, size, response_format, **kwargs):
        seen.update({"prompt": prompt, "size": size, "response_format": response_format})
        return {"data": [{"url": "https://cdn.example.com/generated.png"}]}

    monkeypatch.setattr(service, "generate", fake_generate)

    url = await service.generate_url(prompt="cat", image_bytes=b"fake")

    assert url == "https://cdn.example.com/generated.png"
    assert seen["prompt"] == "cat"
    assert seen["response_format"] == "url"


@pytest.mark.asyncio
async def test_generate_url_raises_when_stream_has_no_url(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_stream(url, payload):
        return "no useful url here"

    monkeypatch.setattr(service, "_post_stream_with_retry", fake_stream)

    with pytest.raises(RuntimeError, match="missing URL"):
        await service.generate_url(prompt="cat")


@pytest.mark.asyncio
async def test_close_noops_when_cache_client_already_closed(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeClient:
        is_closed = True

    service._cache_client = FakeClient()

    await service.close()

    assert service._cache_client.is_closed is True


@pytest.mark.asyncio
async def test_post_json_with_retry_retries_then_succeeds(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings, max_retries=1)

    calls = {"count": 0}

    class FakeResponse:
        def __init__(self, status_code):
            self.status_code = status_code

        def raise_for_status(self):
            if self.status_code != 200:
                raise httpx.HTTPStatusError("bad", request=None, response=self)

        def json(self):
            return {"ok": True}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            calls["count"] += 1
            return FakeResponse(503 if calls["count"] == 1 else 200)

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    async def fake_sleep(*args, **kwargs):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", fake_sleep)

    assert await service._post_json_with_retry("https://example.com", {"prompt": "x"}) == {
        "ok": True
    }
    assert calls["count"] == 2


@pytest.mark.asyncio
async def test_post_stream_with_retry_collects_reasoning_content(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:", image_base_url="https://img.example.com", image_provider="openai"
    )
    service = ImageService(settings, max_retries=1)

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"choices": [{"delta": {"content": "url:"}}]}'
            yield 'data: {"choices": [{"delta": {"reasoning_content": " https://cdn.example.com/a.png"}}]}'
            yield "data: [DONE]"

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return FakeStream()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert (
        await service._post_stream_with_retry("https://example.com", {"stream": True})
        == "url: https://cdn.example.com/a.png"
    )


@pytest.mark.asyncio
async def test_modelscope_generate_returns_first_url(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="token",
        image_model="img-model",
    )
    service = ImageService(settings)

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self):
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return FakeResponse({"task_status": "RUNNING"})
            return FakeResponse(
                {"task_status": "SUCCEED", "output_images": ["https://cdn.example.com/a.png"]}
            )

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    async def fake_sleep(*args, **kwargs):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", fake_sleep)

    assert await service._modelscope_generate("cat") == "https://cdn.example.com/a.png"


@pytest.mark.asyncio
async def test_modelscope_generate_sends_image_bytes_as_data_url(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="token",
        image_model="FireRedTeam/FireRed-Image-Edit-1.1",
    )
    service = ImageService(settings)
    seen_payload = {}

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            seen_payload.update(kwargs["json"])
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            return FakeResponse(
                {"task_status": "SUCCEED", "output_images": ["https://cdn.example.com/a.png"]}
            )

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert (
        await service._modelscope_generate("turn hair blue", image_bytes=b"\x89PNGfake")
        == "https://cdn.example.com/a.png"
    )
    assert seen_payload["image_url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_modelscope_text_model_does_not_send_image_url(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="modelscope",
        image_base_url="https://api-inference.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="token",
        image_model="Tongyi-MAI/Z-Image-Turbo",
    )
    service = ImageService(settings)
    seen_payload = {}

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            seen_payload.update(kwargs["json"])
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            return FakeResponse(
                {"task_status": "SUCCEED", "output_images": ["https://cdn.example.com/a.png"]}
            )

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert (
        await service._modelscope_generate("A golden cat", image_bytes=b"\x89PNGfake")
        == "https://cdn.example.com/a.png"
    )
    assert seen_payload == {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": "A golden cat",
    }


@pytest.mark.asyncio
async def test_modelscope_edit_model_without_image_uses_blank_canvas(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="token",
        image_model="FireRedTeam/FireRed-Image-Edit-1.1",
    )
    service = ImageService(settings)
    seen_payload = {}

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            seen_payload.update(kwargs["json"])
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            return FakeResponse(
                {"task_status": "SUCCEED", "output_images": ["https://cdn.example.com/a.png"]}
            )

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert await service._modelscope_generate("draw character") == "https://cdn.example.com/a.png"
    assert seen_payload["image_url"].startswith("data:image/png;base64,")


def test_is_modelscope_api_false_for_non_modelscope_host():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
    )
    service = ImageService(settings)

    assert service._is_modelscope_api() is False


def test_extract_url_from_text_handles_invalid_inputs():
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    assert service._extract_url_from_text("") is None
    assert service._extract_url_from_text(None) is None


@pytest.mark.asyncio
async def test_post_json_with_retry_breaks_on_non_retryable_status(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings, max_retries=2)

    class FakeResponse:
        status_code = 400

        def raise_for_status(self):
            raise httpx.HTTPStatusError("bad", request=None, response=self)

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    with pytest.raises(RuntimeError, match="failed after retries"):
        await service._post_json_with_retry(
            "https://img.example.com/images/generations", {"prompt": "cat"}
        )


@pytest.mark.asyncio
async def test_generate_url_returns_modelscope_result_with_image_bytes(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_modelscope(prompt, image_bytes=None):
        assert image_bytes == b"fake"
        return "https://modelscope.example.com/image.png"

    monkeypatch.setattr(service, "_modelscope_generate", fake_modelscope)

    assert (
        await service.generate_url(prompt="cat", image_bytes=b"fake")
        == "https://modelscope.example.com/image.png"
    )


@pytest.mark.asyncio
async def test_generate_returns_modelscope_response(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_modelscope(prompt, image_bytes=None):
        assert prompt == "cat"
        assert image_bytes is None
        return "https://modelscope.example.com/image.png"

    monkeypatch.setattr(service, "_modelscope_generate", fake_modelscope)

    assert await service.generate(prompt="cat") == {
        "data": [{"url": "https://modelscope.example.com/image.png"}]
    }


@pytest.mark.asyncio
async def test_post_json_with_retry_returns_json_on_success(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert await service._post_json_with_retry(
        "https://img.example.com/images/generations", {"prompt": "cat"}
    ) == {"ok": True}


@pytest.mark.asyncio
async def test_get_cache_client_reuses_open_client(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeClient:
        is_closed = False

    cached = FakeClient()
    service._cache_client = cached

    assert await service._get_cache_client() is cached


@pytest.mark.asyncio
async def test_close_closes_cache_client(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    closed = {"value": False}

    class FakeClient:
        is_closed = False

        async def aclose(self):
            closed["value"] = True

    service._cache_client = FakeClient()

    await service.close()

    assert closed["value"] is True
    assert service._cache_client is None


@pytest.mark.asyncio
async def test_modelscope_generate_success(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test-key",
        image_model="modelscope-model",
    )
    service = ImageService(settings)

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeStreamResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"https://cdn.example.com/modelscope.png"}}]}'
            yield "data: [DONE]"

    class FakeStreamCtx:
        def __init__(self):
            self.response = FakeStreamResponse()

        async def __aenter__(self):
            return self.response

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            return FakeResponse({"task_id": "task-1"})

        async def get(self, url, headers):
            return FakeResponse(
                {
                    "task_status": "SUCCEED",
                    "output_images": ["https://cdn.example.com/modelscope.png"],
                }
            )

        def stream(self, *args, **kwargs):
            return FakeStreamCtx()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    async def fake_sleep(_):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", fake_sleep)

    assert await service._modelscope_generate("cat") == "https://cdn.example.com/modelscope.png"


@pytest.mark.asyncio
async def test_modelscope_generate_missing_task_id_raises(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test-key",
        image_model="modelscope-model",
    )
    service = ImageService(settings)

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    with pytest.raises(RuntimeError, match="task_id"):
        await service._modelscope_generate("cat")


@pytest.mark.asyncio
async def test_post_stream_with_retry_handles_retryable_status(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
    )
    service = ImageService(settings, max_retries=1)

    class FakeStreamResponse:
        status_code = 500

        def raise_for_status(self):
            raise httpx.HTTPStatusError("bad", request=None, response=self)

        async def aiter_lines(self):
            if False:
                yield ""

    class FakeStreamCtx:
        async def __aenter__(self):
            return FakeStreamResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return FakeStreamCtx()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    async def fake_sleep(_):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", fake_sleep)

    with pytest.raises(RuntimeError, match="failed after retries"):
        await service._post_stream_with_retry(
            "https://img.example.com/chat/completions", {"prompt": "cat"}
        )


@pytest.mark.asyncio
async def test_post_stream_with_retry_returns_text(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"choices": [{"delta": {"content": "https://cdn.example.com/image.png"}}]}'
            yield "data: [DONE]"

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return FakeStream()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert (
        await service._post_stream_with_retry(
            "https://img.example.com/chat/completions", {"stream": True}
        )
        == "https://cdn.example.com/image.png"
    )


@pytest.mark.asyncio
async def test_post_stream_with_retry_collects_direct_payload_url(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"data": [{"url": "https://cdn.example.com/image.png"}]}'
            yield "data: [DONE]"

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return FakeStream()

    monkeypatch.setattr(
        "app.services.image.httpx.AsyncClient", lambda *args, **kwargs: FakeClient()
    )

    assert (
        await service._post_stream_with_retry(
            "https://img.example.com/chat/completions",
            {"stream": True},
        )
        == "https://cdn.example.com/image.png"
    )


# --- download_and_save ---


@pytest.mark.asyncio
async def test_download_and_save_success(monkeypatch, tmp_path):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    save_path = tmp_path / "sub" / "img.png"

    class FakeUrlopenResponse:
        status = 200
        headers = {"Content-Type": "image/png"}

        def read(self):
            return b"PNG_DATA"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    import urllib.request

    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(urllib.request, "urlopen", lambda url, timeout: FakeUrlopenResponse())
    monkeypatch.setattr("app.services.image.asyncio.to_thread", run_inline)

    await service.download_and_save("https://cdn.example.com/a.png", save_path)
    assert save_path.exists()
    assert save_path.read_bytes() == b"PNG_DATA"


@pytest.mark.asyncio
async def test_download_and_save_raises_on_http_error(monkeypatch, tmp_path):
    from urllib.error import HTTPError
    import urllib.request

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    save_path = tmp_path / "img.png"

    def boom(url, timeout):
        raise HTTPError(url, 403, "Forbidden", {}, None)

    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr("app.services.image.asyncio.to_thread", run_inline)

    with pytest.raises(RuntimeError, match="HTTP 403"):
        await service.download_and_save("https://cdn.example.com/a.png", save_path)


# --- _modelscope_generate failure paths ---


@pytest.mark.asyncio
async def test_modelscope_generate_task_failed(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            return FakeResponse({"task_status": "FAILED", "error": "oom"})

    monkeypatch.setattr("app.services.image.httpx.AsyncClient", lambda *a, **k: FakeClient())

    async def noop_sleep(*a, **k):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", noop_sleep)

    with pytest.raises(RuntimeError, match="failed"):
        await service._modelscope_generate("cat")


@pytest.mark.asyncio
async def test_modelscope_generate_success_no_images(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            return FakeResponse({"task_status": "SUCCEED", "output_images": []})

    monkeypatch.setattr("app.services.image.httpx.AsyncClient", lambda *a, **k: FakeClient())

    async def noop_sleep(*a, **k):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", noop_sleep)

    with pytest.raises(RuntimeError, match="no images"):
        await service._modelscope_generate("cat")


@pytest.mark.asyncio
async def test_modelscope_generate_timeout(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_base_url="https://api.modelscope.cn",
        image_endpoint="/v1/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse({"task_id": "t1"})

        async def get(self, *args, **kwargs):
            return FakeResponse({"task_status": "RUNNING"})

    monkeypatch.setattr("app.services.image.httpx.AsyncClient", lambda *a, **k: FakeClient())

    async def noop_sleep(*a, **k):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", noop_sleep)

    # Override max_polls by patching the range — actually the loop uses `range(60)`.
    # Instead, we make the client always return RUNNING and let the loop exhaust.
    # But that would take 60 iterations. Patch the constant instead.
    # The constant is local to the function, so we can't patch it directly.
    # Instead, make the test fast by patching asyncio.sleep to no-op.
    # 60 iterations * no-op sleep = fast enough.
    with pytest.raises(RuntimeError, match="timeout"):
        await service._modelscope_generate("cat")


# --- generate with style ---


@pytest.mark.asyncio
async def test_generate_includes_style_in_payload(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    seen = {}

    async def fake_post(url, payload):
        seen.update(payload)
        return {"data": [{"url": "https://cdn.example.com/a.png"}]}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    await service.generate(prompt="cat", style="watercolor")
    assert seen.get("style") == "watercolor"


@pytest.mark.asyncio
async def test_generate_chat_completions_uses_messages(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
    )
    service = ImageService(settings)

    seen = {}

    async def fake_post(url, payload):
        seen.update(payload)
        return {"data": [{"url": "https://cdn.example.com/a.png"}]}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    await service.generate(prompt="cat")
    assert "messages" in seen
    assert seen["messages"][0]["content"] == "cat"


# --- generate_url i2i + chat completions multimodal ---


@pytest.mark.asyncio
async def test_generate_url_i2i_chat_completions_multimodal(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
        enable_image_to_image=True,
    )
    service = ImageService(settings)

    seen = {}

    async def fake_stream(url, payload):
        seen.update(payload)
        return "https://cdn.example.com/i2i.png"

    monkeypatch.setattr(service, "_post_stream_with_retry", fake_stream)

    url = await service.generate_url(prompt="cat", image_bytes=b"fakeimg")
    assert url == "https://cdn.example.com/i2i.png"
    assert "messages" in seen
    # Check multimodal content structure
    content = seen["messages"][0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/")


@pytest.mark.asyncio
async def test_generate_url_i2i_chat_completions_compresses_reference(monkeypatch):
    from io import BytesIO

    from PIL import Image

    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
        enable_image_to_image=True,
    )
    service = ImageService(settings)
    image = Image.new("RGB", (1400, 1400), "gold")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    original = buffer.getvalue()
    seen = {}

    async def fake_stream(url, payload):
        seen.update(payload)
        return "https://cdn.example.com/i2i.png"

    monkeypatch.setattr(service, "_post_stream_with_retry", fake_stream)

    await service.generate_url(prompt="cat", image_bytes=original)
    content = seen["messages"][0]["content"]
    data_url = content[1]["image_url"]["url"]

    assert data_url.startswith("data:image/jpeg;base64,")
    assert len(data_url) < len("data:image/png;base64,") + len(original) * 4 // 3


# --- generate_url i2i + standard API ---


@pytest.mark.asyncio
async def test_generate_url_i2i_standard_api(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
        enable_image_to_image=True,
    )
    service = ImageService(settings)

    seen = {}

    async def fake_post(url, payload):
        seen.update(payload)
        return {"data": [{"url": "https://cdn.example.com/i2i.png"}]}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    url = await service.generate_url(prompt="cat", image_bytes=b"fakeimg")
    assert url == "https://cdn.example.com/i2i.png"
    assert "image" in seen


# --- generate_url i2i standard API missing URL ---


@pytest.mark.asyncio
async def test_generate_url_i2i_standard_api_missing_url(monkeypatch):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
        enable_image_to_image=True,
    )
    service = ImageService(settings)

    async def fake_post(url, payload):
        return {"data": []}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    # I2I fails → falls back to text-to-image via generate()
    async def fake_generate(**kwargs):
        return {"data": [{"url": "https://cdn.example.com/fallback.png"}]}

    monkeypatch.setattr(service, "generate", fake_generate)

    url = await service.generate_url(prompt="cat", image_bytes=b"fakeimg")
    assert url == "https://cdn.example.com/fallback.png"


# --- _post_stream_with_retry error in stream JSON ---


@pytest.mark.asyncio
async def test_post_stream_with_retry_raises_on_stream_error_json(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings, max_retries=0)

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        async def aiter_lines(self):
            yield 'data: {"error": "rate limit exceeded"}'
            yield "data: [DONE]"

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return FakeStream()

    monkeypatch.setattr("app.services.image.httpx.AsyncClient", lambda *a, **k: FakeClient())

    with pytest.raises(RuntimeError, match="Stream error"):
        await service._post_stream_with_retry("https://example.com", {"stream": True})


# --- cache_external_image with known content types ---


@pytest.mark.asyncio
async def test_cache_external_image_saves_with_content_type_extension(monkeypatch, tmp_path):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    class FakeResponse:
        headers = {"Content-Type": "image/jpeg"}
        content = b"jpg"

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self):
            self.is_closed = False

        async def get(self, url):
            return FakeResponse()

    async def fake_get_cache_client():
        return FakeClient()

    monkeypatch.setattr(service, "_get_cache_client", fake_get_cache_client)
    monkeypatch.setattr("app.services.image.STATIC_DIR", tmp_path)

    result = await service.cache_external_image("https://cdn.example.com/a")
    assert result.endswith(".jpg")


# --- _post_json_with_retry network error retry ---


@pytest.mark.asyncio
async def test_post_json_with_retry_retries_on_network_error(monkeypatch):
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings, max_retries=1)

    calls = {"count": 0}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            calls["count"] += 1
            if calls["count"] == 1:
                raise httpx.NetworkError("connection reset")
            return FakeResponse()

    monkeypatch.setattr("app.services.image.httpx.AsyncClient", lambda *a, **k: FakeClient())

    async def noop_sleep(*a, **k):
        return None

    monkeypatch.setattr("app.services.image.asyncio.sleep", noop_sleep)

    result = await service._post_json_with_retry("https://example.com", {"prompt": "x"})
    assert result == {"ok": True}
    assert calls["count"] == 2


# --- _extract_url_from_text with embedded URL ---


def test_extract_url_from_text_finds_embedded_url():
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    text = 'Here is the image: ![alt](https://cdn.example.com/result.png "title") end'
    assert service._extract_url_from_text(text) == "https://cdn.example.com/result.png"


def test_extract_url_from_text_handles_http_url():
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)

    assert (
        service._extract_url_from_text("http://cdn.example.com/a.png")
        == "http://cdn.example.com/a.png"
    )


# --- download_and_save edge cases ---


@pytest.mark.asyncio
async def test_download_and_save_unexpected_content_type_warns(monkeypatch, tmp_path):
    """Line 150: non-image content type triggers warning but still saves."""
    import urllib.request

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    save_path = tmp_path / "img.png"

    class FakeResponse:
        status = 200
        headers = {"Content-Type": "text/html"}

        def read(self):
            return b"<html>not an image</html>"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(urllib.request, "urlopen", lambda url, timeout: FakeResponse())
    monkeypatch.setattr("app.services.image.asyncio.to_thread", run_inline)

    await service.download_and_save("https://cdn.example.com/a", save_path)
    assert save_path.exists()
    assert save_path.read_bytes() == b"<html>not an image</html>"


@pytest.mark.asyncio
async def test_download_and_save_raises_on_url_error(monkeypatch, tmp_path):
    """Lines 161-163: URLError raises RuntimeError."""
    from urllib.error import URLError
    import urllib.request

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    save_path = tmp_path / "img.png"

    def boom(url, timeout):
        raise URLError("dns failure")

    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr("app.services.image.asyncio.to_thread", run_inline)

    with pytest.raises(RuntimeError, match="dns failure"):
        await service.download_and_save("https://cdn.example.com/a.png", save_path)


@pytest.mark.asyncio
async def test_download_and_save_raises_on_unexpected_error(monkeypatch, tmp_path):
    """Lines 176-178: generic exception wraps in RuntimeError."""
    import urllib.request

    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    service = ImageService(settings)
    save_path = tmp_path / "img.png"

    def boom(url, timeout):
        raise OSError("disk full")

    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr("app.services.image.asyncio.to_thread", run_inline)

    with pytest.raises(RuntimeError, match="disk full"):
        await service.download_and_save("https://cdn.example.com/a.png", save_path)


# --- generate returns raw response even when empty ---


@pytest.mark.asyncio
async def test_generate_returns_raw_response_even_when_empty(monkeypatch):
    """generate() returns raw JSON from _post_json_with_retry without validation."""
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/images/generations",
        image_api_key="test",
    )
    service = ImageService(settings)

    async def fake_post(url, payload):
        return {"data": []}

    monkeypatch.setattr(service, "_post_json_with_retry", fake_post)

    result = await service.generate(prompt="cat")
    assert result == {"data": []}


# --- _post_stream_with_retry non-retryable status ---


@pytest.mark.asyncio
async def test_post_stream_breaks_on_non_retryable_status(monkeypatch):
    """Lines 322-326: non-retryable status code breaks immediately."""
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        image_provider="openai",
        image_base_url="https://img.example.com",
        image_endpoint="/chat/completions",
        image_api_key="test",
    )
    service = ImageService(settings, max_retries=3)

    class FakeResponse:
        status_code = 422

        def raise_for_status(self):
            raise httpx.HTTPStatusError("bad", request=None, response=self)

        async def aiter_lines(self):
            if False:
                yield ""

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, *a):
            return False

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, *a, **k):
            return FakeStream()

    monkeypatch.setattr("app.services.image.httpx.AsyncClient", lambda *a, **k: FakeClient())

    with pytest.raises(RuntimeError, match="failed after retries"):
        await service._post_stream_with_retry("https://example.com", {"stream": True})
