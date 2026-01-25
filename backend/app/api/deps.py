from __future__ import annotations

from collections.abc import AsyncGenerator
import secrets

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db.session import get_session
from app.ws.manager import ConnectionManager, ws_manager


async def get_app_settings() -> Settings:
    return get_settings()


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_session():
        yield session


async def get_ws_manager() -> ConnectionManager:
    return ws_manager


async def require_admin(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> None:
    settings = get_settings()
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin token not configured",
        )
    if not x_admin_token or not secrets.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


SettingsDep = Depends(get_app_settings)
SessionDep = Depends(get_db_session)
WsManagerDep = Depends(get_ws_manager)
AdminDep = Depends(require_admin)
