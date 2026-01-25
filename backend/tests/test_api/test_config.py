from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.config_item import ConfigItem
from tests.factories import create_config_item


@pytest.mark.asyncio
async def test_list_configs_empty(async_client):
    """测试获取空配置列表"""
    res = await async_client.get("/api/v1/config")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    # 可能有来自 .env 的配置，所以不强制为空


@pytest.mark.asyncio
async def test_list_configs_with_data(async_client, test_session):
    """测试获取包含数据的配置列表"""
    await create_config_item(test_session, key="TEST_KEY_1", value="value1")
    await create_config_item(test_session, key="TEST_KEY_2", value="value2", is_sensitive=True)

    res = await async_client.get("/api/v1/config")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)

    # 查找我们创建的配置项
    test_items = [item for item in data if item["key"].startswith("TEST_KEY_")]
    assert len(test_items) == 2

    # 验证敏感信息被脱敏
    sensitive_item = next(item for item in test_items if item["key"] == "TEST_KEY_2")
    assert sensitive_item["is_sensitive"] is True
    assert sensitive_item["is_masked"] is True
    assert "***" in sensitive_item["value"]


@pytest.mark.asyncio
async def test_update_configs_new_item(async_client, test_session):
    """测试创建新配置项"""
    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {"NEW_CONFIG_KEY": "new_value"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["updated"] == 1
    assert data["skipped"] == 0

    # 验证数据库中存在
    result = await test_session.execute(
        select(ConfigItem).where(ConfigItem.key == "NEW_CONFIG_KEY")
    )
    item = result.scalar_one_or_none()
    assert item is not None
    assert item.value == "new_value"


@pytest.mark.asyncio
async def test_update_configs_existing_item(async_client, test_session):
    """测试更新已存在的配置项"""
    await create_config_item(test_session, key="EXISTING_KEY", value="old_value")

    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {"EXISTING_KEY": "new_value"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["updated"] == 1

    # 验证值已更新
    result = await test_session.execute(
        select(ConfigItem).where(ConfigItem.key == "EXISTING_KEY")
    )
    item = result.scalar_one()
    assert item.value == "new_value"


@pytest.mark.asyncio
async def test_update_configs_skip_masked_value(async_client, test_session):
    """测试跳过脱敏值（不更新）"""
    await create_config_item(
        test_session,
        key="SENSITIVE_KEY",
        value="secret123456",
        is_sensitive=True
    )

    # 尝试用脱敏值更新（应该被跳过）
    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {"SENSITIVE_KEY": "secr******3456"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["skipped"] == 1
    assert data["updated"] == 0

    # 验证值未改变
    result = await test_session.execute(
        select(ConfigItem).where(ConfigItem.key == "SENSITIVE_KEY")
    )
    item = result.scalar_one()
    assert item.value == "secret123456"


@pytest.mark.asyncio
async def test_update_configs_restart_required(async_client, test_session):
    """测试需要重启的配置项"""
    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {"DATABASE_URL": "postgresql://new_url"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["restart_required"] is True
    assert "DATABASE_URL" in data["restart_keys"]
    assert "重启" in data["message"]


@pytest.mark.asyncio
async def test_update_configs_no_restart_required(async_client, test_session):
    """测试不需要重启的配置项"""
    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {"IMAGE_API_KEY": "new_key"}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["restart_required"] is False
    assert len(data["restart_keys"]) == 0


@pytest.mark.asyncio
async def test_reveal_value_existing(async_client, test_session):
    """测试获取已存在配置的原始值"""
    await create_config_item(
        test_session,
        key="SECRET_KEY",
        value="my_secret_value",
        is_sensitive=True
    )

    res = await async_client.post(
        "/api/v1/config/reveal",
        json={"key": "SECRET_KEY"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["key"] == "SECRET_KEY"
    assert data["value"] == "my_secret_value"


@pytest.mark.asyncio
async def test_reveal_value_not_found(async_client, test_session):
    """测试获取不存在配置的原始值"""
    res = await async_client.post(
        "/api/v1/config/reveal",
        json={"key": "NON_EXISTENT_KEY"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["key"] == "NON_EXISTENT_KEY"
    assert data["value"] is None


@pytest.mark.asyncio
async def test_update_configs_empty_payload(async_client):
    """测试空配置更新"""
    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["updated"] == 0
    assert data["skipped"] == 0


@pytest.mark.asyncio
async def test_update_configs_null_value(async_client):
    """测试 null 值配置（应该被跳过）"""
    res = await async_client.put(
        "/api/v1/config",
        json={"configs": {"NULL_KEY": None}},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["skipped"] == 1
    assert data["updated"] == 0


@pytest.mark.asyncio
async def test_update_configs_multiple_items(async_client, test_session):
    """测试批量更新多个配置项"""
    res = await async_client.put(
        "/api/v1/config",
        json={
            "configs": {
                "KEY_1": "value1",
                "KEY_2": "value2",
                "KEY_3": "value3",
            }
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["updated"] == 3

    # 验证所有项都已创建
    for i in range(1, 4):
        result = await test_session.execute(
            select(ConfigItem).where(ConfigItem.key == f"KEY_{i}")
        )
        item = result.scalar_one_or_none()
        assert item is not None
        assert item.value == f"value{i}"


@pytest.mark.asyncio
async def test_sensitive_key_detection(async_client, test_session):
    """测试敏感键自动检测"""
    # 创建包含敏感关键词的配置
    res = await async_client.put(
        "/api/v1/config",
        json={
            "configs": {
                "MY_API_KEY": "key123",
                "AUTH_TOKEN": "token456",
                "DB_PASSWORD": "pass789",
            }
        },
    )
    assert res.status_code == 200

    # 获取配置列表，验证敏感标记
    res = await async_client.get("/api/v1/config")
    data = res.json()

    sensitive_keys = ["MY_API_KEY", "AUTH_TOKEN", "DB_PASSWORD"]
    for key in sensitive_keys:
        item = next((i for i in data if i["key"] == key), None)
        assert item is not None
        assert item["is_sensitive"] is True
        assert item["is_masked"] is True
