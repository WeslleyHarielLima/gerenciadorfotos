from ninja import NinjaAPI

from api.auth import JWTAuth
from api.routers.auth import router as auth_router

api = NinjaAPI(title="Workflow Studio API", version="1.0", auth=JWTAuth())
api.add_router("/auth", auth_router)
