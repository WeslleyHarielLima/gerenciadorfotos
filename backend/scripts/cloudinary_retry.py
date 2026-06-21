"""
Script de retry: processa PendingCloudinaryUpload e sobe thumbnails ao Cloudinary.

Para cada pendência: baixa o arquivo do Drive e sobe ao Cloudinary com backoff
exponencial, gravando a URL na Media/MediaVersion alvo.

Executar com: python -m scripts.cloudinary_retry
Ou via cron (requer DJANGO_SETTINGS_MODULE=config.settings).
"""
import logging
import os
import sys
import django

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def _process(item) -> tuple[bool, str]:
    """Tenta subir uma pendência. Retorna (sucesso, mensagem_erro)."""
    from api.services.cloudinary_service import (
        media_public_id,
        upload_with_backoff,
        version_public_id,
    )
    from shared.drive import get_file_bytes

    # Resolve alvo (version tem prioridade), arquivo no Drive, mime e public_id.
    if item.media_version_id:
        version = item.media_version
        if not version:
            return False, "MediaVersion não existe mais."
        media = version.media
        drive_file_id = version.drive_file_id
        mime_type = media.mime_type
        public_id = version_public_id(media.id, version.version)
        target = version
    elif item.media_id:
        media = item.media
        if not media:
            return False, "Media não existe mais."
        version = None
        drive_file_id = media.drive_file_id
        mime_type = media.mime_type
        public_id = media_public_id(media.id)
        target = media
    else:
        return False, "Pendência sem media nem media_version."

    try:
        data = get_file_bytes(drive_file_id)
    except Exception as exc:
        return False, f"Falha ao baixar do Drive: {exc}"

    try:
        result = upload_with_backoff(data, public_id, mime_type)
    except Exception as exc:
        return False, f"Falha no Cloudinary após retries: {exc}"

    if not result:
        return False, f"Mime não suportado pelo Cloudinary: {mime_type}"

    target.cloudinary_url = result["url"]
    target.cloudinary_public_id = result["public_id"]
    target.save(update_fields=["cloudinary_url", "cloudinary_public_id"])
    return True, ""


def run() -> dict:
    from django.utils import timezone
    from core.models import PendingCloudinaryUpload, ScriptExecutionLog

    pending = PendingCloudinaryUpload.objects.filter(status="pending")
    total = pending.count()
    logger.info("cloudinary_retry: %d item(s) pendente(s)", total)

    uploaded = 0
    failed_max = 0

    for item in pending:
        success, error_msg = _process(item)

        item.attempts += 1
        item.last_attempt_at = timezone.now()

        if success:
            item.status = "uploaded"
            item.error_message = ""
            uploaded += 1
            logger.info("Cloudinary OK: pendência #%s", item.pk)
        else:
            item.error_message = error_msg
            if item.attempts >= MAX_ATTEMPTS:
                item.status = "failed_max_attempts"
                failed_max += 1
                logger.error(
                    "Falha máxima (%d tentativas) na pendência #%s: %s",
                    item.attempts, item.pk, error_msg,
                )
            else:
                logger.warning(
                    "Tentativa %d/%d falhou na pendência #%s: %s",
                    item.attempts, MAX_ATTEMPTS, item.pk, error_msg,
                )

        item.save(update_fields=["attempts", "last_attempt_at", "error_message", "status"])

    final_status = "success" if failed_max == 0 else ("partial" if uploaded > 0 else "failed")
    ScriptExecutionLog.objects.create(
        script_name="cloudinary_retry",
        status=final_status,
        events_processed=uploaded,
        events_failed=failed_max,
        error_traceback="" if final_status == "success" else f"{failed_max} pendência(s) atingiram falha máxima.",
    )

    logger.info(
        "cloudinary_retry concluído: %d enviado(s), %d falha(s) máxima(s), %d restante(s)",
        uploaded, failed_max, total - uploaded - failed_max,
    )
    return {"total": total, "uploaded": uploaded, "failed_max": failed_max}


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    result = run()
    print(result)
