from __future__ import annotations

import asyncio

import pytest
from sqlmodel import select

from app.api.v1.routes import generation as generation_routes
from app.models.agent_run import AgentRun
from tests.factories import create_project, create_run


def _immediate_task(coro):
    """Helper to make asyncio.create_task synchronous for testing"""
    loop = asyncio.get_running_loop()
    coro.close()
    future = loop.create_future()
    future.set_result(None)
    return future


@pytest.mark.asyncio
async def test_generate_project_not_found(async_client):
    res = await async_client.post("/api/v1/projects/99999/generate", json={})
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_generate_project_success(async_client, test_session, monkeypatch):
    monkeypatch.setattr(generation_routes.asyncio, "create_task", _immediate_task)

    project = await create_project(test_session)
    res = await async_client.post(f"/api/v1/projects/{project.id}/generate", json={})
    assert res.status_code == 201
    data = res.json()
    run = await test_session.get(AgentRun, data["id"])
    assert run is not None
    assert run.status == "running"


@pytest.mark.asyncio
async def test_cancel_project_run_no_active(async_client, test_session):
    project = await create_project(test_session)
    res = await async_client.post(f"/api/v1/projects/{project.id}/cancel")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "no_active_run"


@pytest.mark.asyncio
async def test_cancel_project_run_updates(async_client, test_session):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id, status="running")

    res = await async_client.post(f"/api/v1/projects/{project.id}/cancel")
    assert res.status_code == 200
    await test_session.refresh(run)
    assert run.status == "cancelled"


@pytest.mark.asyncio
async def test_feedback_project_success(async_client, test_session, monkeypatch):
    monkeypatch.setattr(generation_routes.asyncio, "create_task", _immediate_task)

    project = await create_project(test_session)
    res = await async_client.post(
        f"/api/v1/projects/{project.id}/feedback",
        json={"content": "Please adjust tone"},
    )
    assert res.status_code == 202
    data = res.json()
    run = await test_session.get(AgentRun, data["run_id"])
    assert run is not None
    assert run.status == "queued"

    from app.models.message import Message

    res = await test_session.execute(select(Message).where(Message.run_id == run.id))
    messages = res.scalars().all()
    assert len(messages) == 1
    assert messages[0].content == "Please adjust tone"
