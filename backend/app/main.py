from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.config import get_settings
from app.db.session import init_db
from app.exceptions import AppException
from app.ws.manager import ws_manager

logger = logging.getLogger(__name__)

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

    # 全局异常处理器
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException):
        """处理自定义应用异常"""
        logger.error(
            f"AppException: {exc.code} - {exc.message}",
            extra={
                "code": exc.code,
                "status_code": exc.status_code,
                "details": exc.details,
                "path": request.url.path,
                "method": request.method,
            },
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                }
            },
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        """处理未捕获的异常"""
        logger.exception(
            f"Unhandled exception: {str(exc)}",
            extra={
                "path": request.url.path,
                "method": request.method,
            },
        )
        # 开发环境返回详细错误，生产环境只返回友好消息
        details = {"error": str(exc)} if settings.environment == "development" else {}
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "服务器内部错误，请稍后重试",
                    "details": details,
                }
            },
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws/projects/{project_id}")
    async def ws_projects(websocket: WebSocket, project_id: int):
        from app.agents.orchestrator import trigger_confirm_redis
        from starlette.websockets import WebSocketDisconnect

        try:
            await ws_manager.connect(project_id, websocket)
            await ws_manager.send_event(
                project_id, {"type": "connected", "data": {"project_id": project_id}}
            )

            while True:
                try:
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
                                    logger.error(f"Failed to save feedback for run {run_id}: {e}")
                                    await ws_manager.send_event(
                                        project_id,
                                        {
                                            "type": "error",
                                            "data": {
                                                "code": "WS_SAVE_ERROR",
                                                "message": "保存反馈失败",
                                            },
                                        },
                                    )
                            await trigger_confirm_redis(run_id)
                except WebSocketDisconnect:
                    logger.info(f"WebSocket disconnected for project {project_id}")
                    break
                except Exception as e:
                    logger.error(f"WebSocket message error: {e}", exc_info=True)
                    await ws_manager.send_event(
                        project_id,
                        {
                            "type": "error",
                            "data": {
                                "code": "WS_MESSAGE_ERROR",
                                "message": "消息处理失败",
                            },
                        },
                    )
        except Exception as e:
            logger.error(f"WebSocket connection error: {e}", exc_info=True)
            try:
                await ws_manager.send_event(
                    project_id,
                    {
                        "type": "error",
                        "data": {
                            "code": "WS_CONNECTION_ERROR",
                            "message": "连接失败",
                        },
                    },
                )
            except Exception:
                pass  # 连接已断开，忽略发送错误
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
