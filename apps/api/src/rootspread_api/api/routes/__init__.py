from rootspread_api.api.routes.auth import router as auth_router
from rootspread_api.api.routes.collab_internal import router as collab_internal_router
from rootspread_api.api.routes.health import router as health_router
from rootspread_api.api.routes.milestones import router as milestone_router
from rootspread_api.api.routes.tasks import router as task_router
from rootspread_api.api.routes.workspaces import router as workspace_router

__all__ = [
    "auth_router",
    "collab_internal_router",
    "health_router",
    "milestone_router",
    "task_router",
    "workspace_router",
]
