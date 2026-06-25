import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-change-in-production")

# B2 — fail-safe: DEBUG é desligado por omissão. Em dev, setar DEBUG=true no .env/dev.sh.
DEBUG = os.environ.get("DEBUG", "false").lower() in ("1", "true", "yes")

# B4 — não aceitar qualquer Host. Definir ALLOWED_HOSTS=dominio.com no .env de produção.
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ASGI_APPLICATION = "config.asgi.application"

DB_PASSWORD = os.environ.get("DB_PASSWORD", "dev_password")

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "NAME": os.environ.get("DB_NAME", "workflow_studio"),
        "USER": os.environ.get("DB_USER", "workflow_user"),
        "PASSWORD": DB_PASSWORD,
    }
}

AUTH_USER_MODEL = "core.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Porto_Velho"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Q4 — em produção a lista de origens vem só de FRONTEND_URL (+ extras explícitos).
# localhost só é liberado em desenvolvimento.
CORS_ALLOWED_ORIGINS = [
    o for o in [os.environ.get("FRONTEND_URL", "http://localhost:3000")] if o
]
if DEBUG:
    CORS_ALLOWED_ORIGINS += [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
    ]
# Origens extras de produção (CSV), ex.: "https://app.exemplo.com,https://www.exemplo.com".
CORS_ALLOWED_ORIGINS += [
    o.strip() for o in os.environ.get("CORS_EXTRA_ORIGINS", "").split(",") if o.strip()
]
# Remove duplicatas preservando ordem.
CORS_ALLOWED_ORIGINS = list(dict.fromkeys(CORS_ALLOWED_ORIGINS))
CORS_ALLOW_CREDENTIALS = True


# ── Endurecimento de produção (aplicado só quando DEBUG=False) ────────────────

if not DEBUG:
    # B5 — HTTPS/cookies seguros atrás de proxy TLS (nginx).
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    CSRF_TRUSTED_ORIGINS = [o for o in [os.environ.get("FRONTEND_URL")] if o] + [
        o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()
    ]

    # B3 — proibir SECRET_KEY/JWT default em produção (JWT é assinado com ela).
    if SECRET_KEY in ("", "django-insecure-change-in-production"):
        raise RuntimeError(
            "DJANGO_SECRET_KEY não definida (ou usando o default inseguro) em produção. "
            "Gere uma com: python -c \"from django.core.management.utils import "
            "get_random_secret_key as g; print(g())\""
        )

    # Q7 — proibir senha de banco default/previsível em produção.
    if DB_PASSWORD in ("", "dev_password"):
        raise RuntimeError(
            "DB_PASSWORD não definida (ou usando o default 'dev_password') em produção."
        )
