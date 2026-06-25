import logging
import os

logger = logging.getLogger(__name__)


def get_secret(gsm_secret_name: str, fallback_env: str) -> str:
    """Busca segredo no GSM; cai no env local se GSM não estiver configurado.

    Q7 — quando o GSM ESTÁ configurado (GCP_PROJECT_ID setado) mas a consulta
    falha (auth inválida, project errado, timeout), o erro real é logado em vez
    de ser silenciosamente engolido — uma falha de segredo em produção não deve
    se mascarar de "indisponível".
    """
    project_id = os.environ.get("GCP_PROJECT_ID")
    if project_id:
        try:
            from google.cloud import secretmanager

            client = secretmanager.SecretManagerServiceClient()
            name = f"projects/{project_id}/secrets/{gsm_secret_name}/versions/latest"
            response = client.access_secret_version(request={"name": name})
            return response.payload.data.decode("utf-8").strip()
        except Exception:
            logger.error(
                "Falha ao acessar o segredo '%s' no GSM (project=%s); "
                "caindo no env '%s'.",
                gsm_secret_name, project_id, fallback_env, exc_info=True,
            )

    value = os.environ.get(fallback_env, "")
    if not value:
        logger.warning("Segredo '%s' não encontrado nem no GSM nem em '%s'.", gsm_secret_name, fallback_env)
    return value


def get_database_password() -> str:
    gsm_name = os.environ.get("GSM_SECRET_NAME", "workflow-postgres-password")
    return get_secret(gsm_name, "DB_PASSWORD")


def get_jwt_secret() -> str:
    gsm_name = os.environ.get("JWT_SECRET_NAME", "workflow-jwt-secret")
    return get_secret(gsm_name, "DJANGO_SECRET_KEY")
