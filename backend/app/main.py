from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.config import get_settings
from app.db.session import init_db
from app.ws.manager import ws_manager

# 静态文件目录
STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 确保静态文件目录存在
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    (STATIC_DIR / "videos").mkdir(parents=True, exist_ok=True)
    (STATIC_DIR / "images").mkdir(parents=True, exist_ok=True)
    await init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    # 挂载静态文件服务（用于提供拼接后的视频）
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws/projects/{project_id}")
    async def ws_projects(websocket: WebSocket, project_id: int):
        from app.agents.orchestrator import trigger_confirm_redis

        await ws_manager.connect(project_id, websocket)
        try:
            await ws_manager.send_event(
                project_id, {"type": "connected", "data": {"project_id": project_id}}
            )
            while True:
                msg = await websocket.receive_json()
                msg_type = msg.get("type")
                if msg_type == "ping":
                    await ws_manager.send_event(project_id, {"type": "pong", "data": {}})
                elif msg_type == "echo":
                    await ws_manager.send_event(
                        project_id, {"type": "echo", "data": msg.get("data")}
                    )
                elif msg_type == "confirm":
                    # 用户确认继续执行
                    run_id = msg.get("data", {}).get("run_id")
                    feedback = msg.get("data", {}).get("feedback")
                    if run_id:
                        if isinstance(feedback, str) and feedback.strip():
                            content = feedback.strip()
                            from app.db.session import async_session_maker
                            from app.models.agent_run import AgentMessage
                            from app.models.message import Message

                            try:
                                async with async_session_maker() as session:
                                    session.add(
                                        AgentMessage(
                                            run_id=run_id,
                                            agent="user",
                                            role="user",
                                            content=content,
                                        )
                                    )
                                    session.add(
                                        Message(
                                            project_id=project_id,
                                            run_id=run_id,
                                            agent="user",
                                            role="user",
                                            content=content,
                                        )
                                    )
                                    await session.commit()
                                # 确保 feedback 保存完成后再触发 confirm
                                # 添加短暂延迟让 orchestrator 的 session 能读取到新数据
                                await asyncio.sleep(0.1)
                            except Exception as e:
                                # 记录异常但不阻塞确认流程
                                import logging

                                logging.getLogger(__name__).error(
                                    f"Failed to save feedback for run {run_id}: {e}"
                                )
                        await trigger_confirm_redis(run_id)
        except Exception:
            pass
        finally:
            await ws_manager.disconnect(project_id, websocket)

    return app


app = create_app()


async def _run_demo_mcp_server() -> None:
    try:
        from app.tools.media_tools import create_tools_mcp_server
    except ModuleNotFoundError as exc:
        if exc.name == "claude_agent_sdk":
            raise RuntimeError(
                "Missing dependency `claude-agent-sdk`. Install: `cd backend && uv sync --extra agents` "
                "or `pip install 'openOii-backend[agents]'`."
            ) from exc
        raise

    server = create_tools_mcp_server()
    await server.serve_stdio()


if __name__ == "__main__":
    asyncio.run(_run_demo_mcp_server())
