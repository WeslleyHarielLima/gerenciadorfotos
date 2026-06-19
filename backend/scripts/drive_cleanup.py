"""
Script de limpeza: processa PendingDriveDeletion e deleta arquivos do Drive.
Executar com: python manage.py shell < scripts/drive_cleanup.py
Ou via cron: python -m scripts.drive_cleanup (requer DJANGO_SETTINGS_MODULE)
"""
import logging
import os
import sys
import django

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def run():
    from django.utils import timezone
    from core.models import PendingDriveDeletion
    from shared.drive import delete_file

    pending = PendingDriveDeletion.objects.filter(status="pending")
    total = pending.count()
    logger.info("drive_cleanup: %d item(s) pendente(s)", total)

    deleted = 0
    failed = 0

    for item in pending:
        try:
            result = delete_file(item.drive_file_id)
        except Exception as exc:
            result = False
            error_msg = str(exc)
        else:
            error_msg = "" if result else "Arquivo não encontrado no Drive (404)."

        item.attempts += 1
        item.last_attempt_at = timezone.now()

        if result or "404" in error_msg:
            item.status = "deleted"
            item.error_message = ""
            deleted += 1
            logger.info("Deletado: %s", item.drive_file_id)
        else:
            item.error_message = error_msg
            if item.attempts >= MAX_ATTEMPTS:
                item.status = "failed_max_attempts"
                failed += 1
                logger.error(
                    "Falha máxima (%d tentativas) para %s: %s",
                    item.attempts, item.drive_file_id, error_msg,
                )
            else:
                logger.warning(
                    "Tentativa %d/%d falhou para %s: %s",
                    item.attempts, MAX_ATTEMPTS, item.drive_file_id, error_msg,
                )

        item.save(update_fields=["attempts", "last_attempt_at", "error_message", "status"])

    logger.info(
        "drive_cleanup concluído: %d deletado(s), %d falha(s) máxima(s), %d restante(s) pendente(s)",
        deleted,
        failed,
        total - deleted - failed,
    )
    return {"total": total, "deleted": deleted, "failed_max": failed}


if __name__ == "__main__":
    # Permite execução direta: python scripts/drive_cleanup.py
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    logging.basicConfig(level=logging.INFO)
    result = run()
    print(result)
