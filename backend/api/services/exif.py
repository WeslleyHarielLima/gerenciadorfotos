"""Injeção e extração de media_id no campo UserComment do EXIF."""
import io
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

_PREFIX = "workflow_media_id:"
_PATTERN = re.compile(r"workflow_media_id:(\d+)")


def inject_media_id_exif(data: bytes, media_id: int, mime_type: str) -> bytes:
    """
    Injeta media_id no campo UserComment do EXIF.
    Só funciona para JPEG/JPG; retorna data inalterado para outros tipos.
    Tolerante a falhas: se der erro, loga e retorna original.
    """
    if mime_type not in ("image/jpeg", "image/jpg"):
        return data

    try:
        import piexif

        try:
            exif_dict = piexif.load(data)
        except Exception:
            exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}

        comment = f"{_PREFIX}{media_id}".encode("utf-8")
        # UserComment requer 8 bytes de charset + conteúdo; charset ASCII = b"ASCII\x00\x00\x00"
        exif_dict.setdefault("Exif", {})[piexif.ExifIFD.UserComment] = (
            b"ASCII\x00\x00\x00" + comment
        )

        exif_bytes = piexif.dump(exif_dict)
        output = io.BytesIO()
        piexif.insert(exif_bytes, data, output)
        return output.getvalue()
    except Exception as exc:
        logger.warning("inject_media_id_exif falhou (media_id=%s): %s", media_id, exc)
        return data


def extract_media_id_exif(data: bytes) -> Optional[int]:
    """
    Extrai media_id do campo UserComment do EXIF.
    Retorna None se não encontrar ou se der erro.
    """
    try:
        import piexif

        exif_dict = piexif.load(data)
        raw = exif_dict.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
        if not raw:
            return None

        # Remove o prefixo de charset (8 bytes) se presente
        text = raw[8:].decode("utf-8", errors="ignore") if len(raw) > 8 else raw.decode("utf-8", errors="ignore")
        match = _PATTERN.search(text)
        if match:
            return int(match.group(1))
        return None
    except Exception as exc:
        logger.debug("extract_media_id_exif: %s", exc)
        return None
