"""Settings de teste — hermético, sem dependências externas.

Herda tudo de config.settings e sobrescreve apenas o necessário para que a
suíte rode sem Postgres, sem Google Cloud e sem Cloudinary reais.
"""
import os

# IMPORTANTE: estas envs precisam existir ANTES de importar config.settings,
# porque os fail-safes de produção (B3/Q7) rodam no momento do import e abortam
# se SECRET_KEY/DB_PASSWORD vierem com o default inseguro.
# JWT determinístico: encode e decode usam o MESMO segredo durante os testes.
os.environ["DJANGO_SECRET_KEY"] = "test-secret-key-deterministic"
os.environ["DB_PASSWORD"] = "test-db-password"
os.environ.setdefault("CLOUDINARY_CLOUD_NAME", "test-cloud")
os.environ.setdefault("CLOUDINARY_API_KEY", "test-key")
os.environ.setdefault("CLOUDINARY_API_SECRET", "test-secret")
os.environ.setdefault("GOOGLE_DRIVE_ROOT_FOLDER_ID", "root_folder_test")

from config.settings import *  # noqa: F401,F403,E402

# CRÍTICO: o import acima roda load_dotenv(.env), que REPÕE GCP_PROJECT_ID com o
# valor real do projeto. Removê-lo DEPOIS do import garante que get_secret() nunca
# tente acessar o Google Secret Manager (rede/ADC) durante os testes — sem isso,
# cada login/JWT trava em timeouts de autenticação do GSM.
os.environ.pop("GCP_PROJECT_ID", None)

# Banco em memória — nenhum servidor necessário.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# Hash de senha rápido (testes não precisam de PBKDF2).
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]

# O bloco de produção liga SECURE_SSL_REDIRECT=True (DEBUG=False); desligamos nos
# testes para que o test client (http) não receba 301 em toda request.
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
