from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.orchestrator import GenerationOrchestrator
from app.api.deps import SessionDep, SettingsDep, WsManagerDep
from app.config import Settings
from app.db.session import async_session_maker
from app.models.agent_run import AgentMessage, AgentRun
from app.models.message import Message
from app.models.project import Project
from app.schemas.project import AgentRunRead, FeedbackRequest, GenerateRequest
from app.services.task_manager import task_manager
from app.ws.manager import ConnectionManager

router = APIRouter(prefix="/projects")


@router.post("/{project_id}/generate", response_model=AgentRunRead, status_code=status.HTTP_201_CREATED)
async def generate_project(
    project_id: int,
    payload: GenerateRequest,
    session: AsyncSession = SessionDep,
    settings: Settings = SettingsDep,
    ws: ConnectionManager = WsManagerDep,
):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 并发限制已移除，允许多个任务同时运行
    run = AgentRun(project_id=project_id, status="running", current_agent="orchestrator", progress=0.0)
    session.add(run)
    await session.commit()
    await session.refresh(run)

    async def _task() -> None:
        try:
            async with async_session_maker() as task_session:
                orchestrator = GenerationOrchestrator(settings=settings, ws=ws, session=task_session)
                await orchestrator.run(project_id=project_id, run_id=run.id, request=payload)
        except asyncio.CancelledError:
            # 任务被取消，更新数据库状态
            async with async_session_maker() as cancel_session:
                run_obj = await cancel_session.get(AgentRun, run.id)
                if run_obj and run_obj.status not in ("cancelled", "failed", "succeeded"):
                    run_obj.status = "cancelled"
                    await cancel_session.commit()
            raise
        finally:
            task_manager.remove(project_id)

    task = asyncio.create_task(_task())
    task_manager.register(project_id, task)
    return AgentRunRead.model_validate(run)


@router.post("/{project_id}/cancel", status_code=status.HTTP_200_OK)
async def cancel_project_run(
    project_id: int,
    session: AsyncSession = SessionDep,
    ws: ConnectionManager = WsManagerDep,
):
    """取消项目的当前运行任务"""
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 先取消实际的后台任务
    task_cancelled = task_manager.cancel(project_id)

    # 更新数据库状态
    res = await session.execute(
        select(AgentRun)
        .where(AgentRun.project_id == project_id)
        .where(AgentRun.status.in_(["queued", "running"]))
    )
    runs = res.scalars().all()

    if not runs and not task_cancelled:
        return {"status": "no_active_run", "cancelled": 0}

    cancelled_count = 0
    for run in runs:
        run.status = "cancelled"
        cancelled_count += 1

    await session.commit()

    # 通知前端任务已取消
    await ws.send_event(project_id, {
        "type": "run_cancelled",
        "data": {"project_id": project_id, "cancelled_count": cancelled_count}
    })

    return {"status": "cancelled", "cancelled": cancelled_count}


@router.post("/{project_id}/feedback", status_code=status.HTTP_202_ACCEPTED)
async def feedback_project(
    project_id: int,
    payload: FeedbackRequest,
    session: AsyncSession = SessionDep,
    settings: Settings = SettingsDep,
    ws: ConnectionManager = WsManagerDep,
):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 并发限制已移除，允许多个任务同时运行
    run = AgentRun(project_id=project_id, status="queued", current_agent="review", progress=0.0)
    session.add(run)
    await session.commit()
    await session.refresh(run)

    msg = AgentMessage(run_id=run.id, agent="user", role="user", content=payload.content)
    session.add(msg)
    await session.commit()

    # 同步写入聊天消息表，方便前端展示反馈内容
    session.add(
        Message(
            project_id=project_id,
            run_id=run.id,
            agent="user",
            role="user",
            content=payload.content,
        )
    )
    await session.commit()

    async def _task() -> None:
        try:
            async with async_session_maker() as task_session:
                orchestrator = GenerationOrchestrator(settings=settings, ws=ws, session=task_session)
                await orchestrator.run_from_agent(
                    project_id=project_id,
                    run_id=run.id,
                    request=GenerateRequest(notes=payload.content),
                    agent_name="review",
                    auto_mode=False,
                )
        except asyncio.CancelledError:
            # 任务被取消，更新数据库状态
            async with async_session_maker() as cancel_session:
                run_obj = await cancel_session.get(AgentRun, run.id)
                if run_obj and run_obj.status not in ("cancelled", "failed", "succeeded"):
                    run_obj.status = "cancelled"
                    await cancel_session.commit()
            raise
        finally:
            task_manager.remove(project_id)

    task = asyncio.create_task(_task())
    task_manager.register(project_id, task)
    return {"status": "accepted", "run_id": run.id}
