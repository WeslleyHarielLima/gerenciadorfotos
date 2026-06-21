"""
Backfill de thumbnails ao Cloudinary para mídias antigas (cloudinary_url vazio).

Para cada alvo: baixa o arquivo do Drive e sobe ao Cloudinary com backoff,
gravando a URL na Media/MediaVersion.

⚠️ PLANO GRÁTIS: rode em lotes pequenos e confira a cota no painel do Cloudinary
entre os lotes. O parâmetro --limit controla quantos sobem por execução.

Uso:
    python -m scripts.cloudinary_backfill --count            # só conta o que falta
    python -m scripts.cloudinary_backfill --limit 200        # sobe até 200 faltantes
    python -m scripts.cloudinary_backfill --limit 200 --dry-run   # lista sem subir

Sem --limit e sem --count, não faz nada (proteção contra backfill total acidental).
"""
import argparse
import logging
import os
import sys
import django

logger = logging.getLogger(__name__)


def _pending_media():
    from core.models import Media
    from api.services.cloudinary_service import IMAGE_MIME_TYPES
    return Media.objects.filter(
        cloudinary_url="", mime_type__in=IMAGE_MIME_TYPES
    ).order_by("id")


def _pending_versions():
    from core.models import MediaVersion
    from api.services.cloudinary_service import IMAGE_MIME_TYPES
    # Versões originais (v1) compartilham a URL da Media — não têm thumbnail próprio.
    return MediaVersion.objects.filter(
        cloudinary_url="", media__mime_type__in=IMAGE_MIME_TYPES
    ).exclude(status="original").order_by("id")


def _upload_one(kind: str, obj) -> tuple[bool, str]:
    from api.services.cloudinary_service import (
        media_public_id,
        upload_with_backoff,
        version_public_id,
    )
    from shared.drive import get_file_bytes

    if kind == "media":
        drive_file_id = obj.drive_file_id
        mime_type = obj.mime_type
        public_id = media_public_id(obj.id)
    else:  # version
        drive_file_id = obj.drive_file_id
        mime_type = obj.media.mime_type
        public_id = version_public_id(obj.media_id, obj.version)

    try:
        data = get_file_bytes(drive_file_id)
    except Exception as exc:
        return False, f"Drive: {exc}"

    try:
        result = upload_with_backoff(data, public_id, mime_type)
    except Exception as exc:
        return False, f"Cloudinary: {exc}"

    if not result:
        return False, f"mime não suportado: {mime_type}"

    obj.cloudinary_url = result["url"]
    obj.cloudinary_public_id = result["public_id"]
    obj.save(update_fields=["cloudinary_url", "cloudinary_public_id"])
    return True, ""


def run(limit: int | None, count_only: bool, dry_run: bool) -> dict:
    media_qs = _pending_media()
    version_qs = _pending_versions()
    n_media = media_qs.count()
    n_versions = version_qs.count()

    logger.info("Faltam thumbnails: %d Media + %d MediaVersion = %d total",
                n_media, n_versions, n_media + n_versions)

    if count_only:
        return {"media": n_media, "versions": n_versions, "total": n_media + n_versions}

    if not limit:
        logger.warning("Sem --limit: nada a fazer (use --count para apenas contar).")
        return {"media": n_media, "versions": n_versions, "uploaded": 0, "failed": 0}

    # Lista combinada de alvos, respeitando o limite total.
    targets = [("media", m) for m in media_qs[:limit]]
    if len(targets) < limit:
        resto = limit - len(targets)
        targets += [("version", v) for v in version_qs[:resto]]

    if dry_run:
        for kind, obj in targets:
            logger.info("[dry-run] subiria: %s #%s", kind, obj.pk)
        return {"would_upload": len(targets)}

    uploaded = 0
    failed = 0
    for kind, obj in targets:
        ok, err = _upload_one(kind, obj)
        if ok:
            uploaded += 1
            logger.info("OK: %s #%s", kind, obj.pk)
        else:
            failed += 1
            logger.error("FALHA: %s #%s — %s", kind, obj.pk, err)

    logger.info("Backfill: %d enviado(s), %d falha(s). Confira a cota no painel do Cloudinary.",
                uploaded, failed)
    return {"uploaded": uploaded, "failed": failed, "restante": n_media + n_versions - uploaded}


def _parse_args(argv):
    p = argparse.ArgumentParser(description="Backfill de thumbnails ao Cloudinary.")
    p.add_argument("--count", action="store_true", help="Apenas conta o que falta.")
    p.add_argument("--limit", type=int, default=None, help="Máximo de uploads nesta execução.")
    p.add_argument("--dry-run", action="store_true", help="Lista os alvos sem subir.")
    return p.parse_args(argv)


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = _parse_args(sys.argv[1:])
    result = run(limit=args.limit, count_only=args.count, dry_run=args.dry_run)
    print(result)
