import io
import logging
import os
import time

logger = logging.getLogger(__name__)

_CONFIGURED = False

IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

# Mesmo padrão de backoff do shared/drive.py
_BACKOFF_DELAYS = [1, 2, 4, 8, 16]

_TRANSFORMATION = [{"width": 1200, "crop": "limit", "quality": "auto:good"}]


def _with_backoff(fn):
    """Repete `fn` com backoff exponencial. Re-lança a última exceção se esgotar."""
    last_exc = None
    for delay in _BACKOFF_DELAYS:
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            logger.warning("Cloudinary retry em %ds: %s", delay, exc)
            time.sleep(delay)
    raise last_exc


def _configure():
    global _CONFIGURED
    if _CONFIGURED:
        return
    import cloudinary
    cloudinary.config(
        cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
        api_key=os.environ["CLOUDINARY_API_KEY"],
        api_secret=os.environ["CLOUDINARY_API_SECRET"],
        secure=True,
    )
    _CONFIGURED = True


def upload_thumbnail(data: bytes, media_id: int, mime_type: str) -> dict | None:
    """Envia imagem ao Cloudinary e retorna {url, public_id} ou None se falhar."""
    if mime_type not in IMAGE_MIME_TYPES:
        return None

    try:
        _configure()
        import cloudinary.uploader
        result = cloudinary.uploader.upload(
            io.BytesIO(data),
            public_id=media_public_id(media_id),
            overwrite=True,
            resource_type="image",
            transformation=_TRANSFORMATION,
        )
        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
        }
    except Exception as exc:
        logger.warning("Cloudinary upload falhou para media_id=%s: %s", media_id, exc)
        return None


def upload_version_thumbnail(data: bytes, media_id: int, version: int, mime_type: str) -> dict | None:
    """Envia versão editada ao Cloudinary com public_id separado do original."""
    if mime_type not in IMAGE_MIME_TYPES:
        return None

    try:
        _configure()
        import cloudinary.uploader
        result = cloudinary.uploader.upload(
            io.BytesIO(data),
            public_id=version_public_id(media_id, version),
            overwrite=True,
            resource_type="image",
            transformation=_TRANSFORMATION,
        )
        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
        }
    except Exception as exc:
        logger.warning("Cloudinary upload falhou para media_id=%s v%s: %s", media_id, version, exc)
        return None


def upload_with_backoff(data: bytes, public_id: str, mime_type: str) -> dict | None:
    """
    Upload resiliente (backoff exponencial) usado pelo script de retry offline.
    Re-lança a exceção se todas as tentativas falharem (o chamador decide o que fazer).
    Retorna None se o mime não for imagem.
    """
    if mime_type not in IMAGE_MIME_TYPES:
        return None

    _configure()
    import cloudinary.uploader

    def _do():
        result = cloudinary.uploader.upload(
            io.BytesIO(data),
            public_id=public_id,
            overwrite=True,
            resource_type="image",
            transformation=_TRANSFORMATION,
        )
        return {"url": result["secure_url"], "public_id": result["public_id"]}

    return _with_backoff(_do)


def media_public_id(media_id: int) -> str:
    return f"gerenciafotos/media_{media_id}"


def version_public_id(media_id: int, version: int) -> str:
    return f"gerenciafotos/media_{media_id}_v{version}"


def delete_asset(public_id: str) -> bool:
    """Remove asset do Cloudinary. Não lança exceção — falha silenciosa."""
    if not public_id:
        return False
    _configure()
    try:
        import cloudinary.uploader
        result = cloudinary.uploader.destroy(public_id)
        return result.get("result") == "ok"
    except Exception as exc:
        logger.warning("Cloudinary delete falhou para public_id=%s: %s", public_id, exc)
        return False
