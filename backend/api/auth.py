import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from django.contrib.auth import authenticate
from ninja.security import HttpBearer

from core.models import User
from shared.secrets import get_jwt_secret


def _get_secret() -> str:
    # B3 — sem fallback "insecure": JWT é assinado com este segredo. Se o GSM e a
    # env vierem vazios, deixar estourar (500 explícito é melhor que segredo previsível).
    secret = get_jwt_secret() or os.environ.get("DJANGO_SECRET_KEY", "")
    if not secret:
        raise RuntimeError(
            "Segredo JWT indisponível: defina DJANGO_SECRET_KEY ou configure o GSM."
        )
    return secret


def _algorithm() -> str:
    return os.environ.get("JWT_ALGORITHM", "HS256")


def _expire_hours() -> int:
    return int(os.environ.get("JWT_EXPIRE_HOURS", "168"))


def create_access_token(user: User) -> str:
    payload = {
        "sub": str(user.pk),
        "username": user.username,
        "role": user.role,
        "type": "access",
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=_expire_hours()),
    }
    return jwt.encode(payload, _get_secret(), algorithm=_algorithm())


def create_refresh_token(user: User) -> str:
    payload = {
        "sub": str(user.pk),
        "type": "refresh",
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=_expire_hours() * 2),
    }
    return jwt.encode(payload, _get_secret(), algorithm=_algorithm())


def verify_token(token: str, expected_type: str = "access") -> Optional[dict]:
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[_algorithm()])
        if payload.get("type") != expected_type:
            return None
        return payload
    except jwt.PyJWTError:
        return None


class JWTAuth(HttpBearer):
    def authenticate(self, request, token: str) -> Optional[User]:
        payload = verify_token(token, expected_type="access")
        if not payload:
            return None
        try:
            user = User.objects.get(pk=payload["sub"], is_active=True)
            request.auth_payload = payload
            return user
        except User.DoesNotExist:
            return None


def require_role(*roles: str):
    """Decorator/dependência que garante que request.auth tem o role correto."""
    from functools import wraps
    from ninja.errors import HttpError

    def decorator(func):
        @wraps(func)
        def wrapper(request, *args, **kwargs):
            user: User = request.auth
            if not user or user.role not in roles:
                raise HttpError(403, "Acesso negado para este role.")
            return func(request, *args, **kwargs)
        return wrapper
    return decorator
