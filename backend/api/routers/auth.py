from django.contrib.auth import authenticate
from ninja import Router
from ninja.errors import HttpError
from pydantic import BaseModel

from api.auth import JWTAuth, create_access_token, create_refresh_token, verify_token
from core.models import User

router = Router(tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class RefreshIn(BaseModel):
    refresh_token: str


class RefreshOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response=TokenOut, auth=None)
def login(request, body: LoginIn):
    user = authenticate(request, username=body.username, password=body.password)
    if not user:
        raise HttpError(401, "Credenciais inválidas.")
    if not user.is_active:
        raise HttpError(401, "Conta desativada.")
    return TokenOut(
        access_token=create_access_token(user),
        refresh_token=create_refresh_token(user),
        user={"id": user.pk, "username": user.username, "email": user.email, "role": user.role},
    )


@router.post("/refresh", response=RefreshOut, auth=None)
def refresh(request, body: RefreshIn):
    payload = verify_token(body.refresh_token, expected_type="refresh")
    if not payload:
        raise HttpError(401, "Refresh token inválido ou expirado.")
    try:
        user = User.objects.get(pk=payload["sub"], is_active=True)
    except User.DoesNotExist:
        raise HttpError(401, "Usuário não encontrado.")
    return RefreshOut(access_token=create_access_token(user))


@router.get("/me", auth=JWTAuth())
def me(request):
    user: User = request.auth
    return {"id": user.pk, "username": user.username, "email": user.email, "role": user.role}
