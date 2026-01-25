from fastapi import APIRouter

from app.api.v1.routes.characters import router as characters_router
from app.api.v1.routes.config import router as config_router
from app.api.v1.routes.generation import router as generation_router
from app.api.v1.routes.projects import router as projects_router
from app.api.v1.routes.scenes import router as scenes_router
from app.api.v1.routes.shots import router as shots_router

api_router = APIRouter()
api_router.include_router(projects_router, prefix="/projects", tags=["projects"])
api_router.include_router(generation_router, tags=["generation"])
api_router.include_router(config_router, prefix="/config", tags=["config"])
api_router.include_router(characters_router, prefix="/characters", tags=["characters"])
api_router.include_router(scenes_router, prefix="/scenes", tags=["scenes"])
api_router.include_router(shots_router, prefix="/shots", tags=["shots"])

