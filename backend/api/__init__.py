from ninja import NinjaAPI

from api.auth import JWTAuth
from api.routers.auth import router as auth_router
from api.routers.dashboard import router as dashboard_router
from api.routers.media import router as media_router
from api.routers.tasks import router as tasks_router

api = NinjaAPI(title="Workflow Studio API", version="1.0", auth=JWTAuth())
api.add_router("/auth", auth_router)
api.add_router("/dashboard", dashboard_router)
api.add_router("/media", media_router)
api.add_router("/tasks", tasks_router)
