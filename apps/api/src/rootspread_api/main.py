from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from rootspread_api.api.routes import (
    auth_router,
    collab_internal_router,
    health_router,
    milestone_router,
    task_router,
    workspace_router,
)
from rootspread_api.core.config import get_settings
from rootspread_api.core.database import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


def create_application() -> FastAPI:
    settings = get_settings()

    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Backend API for RootSpread.",
        lifespan=lifespan,
        docs_url=f"{settings.api_v1_prefix}/docs",
        redoc_url=f"{settings.api_v1_prefix}/redoc",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.get("/", tags=["system"])
    async def root() -> dict[str, str]:
        return {
            "service": settings.app_name,
            "status": "ok",
            "docs": f"{settings.api_v1_prefix}/docs",
        }

    application.include_router(health_router, prefix=settings.api_v1_prefix)
    application.include_router(auth_router, prefix=settings.api_v1_prefix)
    application.include_router(collab_internal_router, prefix=settings.api_v1_prefix)
    application.include_router(milestone_router, prefix=settings.api_v1_prefix)
    application.include_router(task_router, prefix=settings.api_v1_prefix)
    application.include_router(workspace_router, prefix=settings.api_v1_prefix)
    return application


app = create_application()


def run() -> None:
    settings = get_settings()
    uvicorn.run(
        "rootspread_api.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_env == "development",
    )
