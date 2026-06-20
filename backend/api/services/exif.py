"""Injeção e extração de media_id em metadados de imagem.

Formatos suportados:
  - JPEG/JPG  → campo UserComment do EXIF (via piexif)
  - PNG       → chunk tEXt "workflow_media_id" (via Pillow)
  - WebP      → campo UserComment do EXIF embutido (via Pillow + piexif)
  - Outros    → retorna dados sem alteração; identificação cai para fallback por nome
"""
import io
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

_KEY = "workflow_media_id"
_PREFIX = f"{_KEY}:"
_PATTERN = re.compile(r"workflow_media_id:(\d+)")
_CHARSET_HEADER = b"ASCII\x00\x00\x00"


# ── Injeção ──────────────────────────────────────────────────────────────────

def inject_media_id_exif(data: bytes, media_id: int, mime_type: str) -> bytes:
    try:
        if mime_type in ("image/jpeg", "image/jpg"):
            return _inject_jpeg(data, media_id)
        if mime_type == "image/png":
            return _inject_png(data, media_id)
        if mime_type == "image/webp":
            return _inject_webp(data, media_id)
    except Exception as exc:
        logger.warning("inject_media_id_exif falhou (mime=%s media_id=%s): %s", mime_type, media_id, exc)
    return data


def _inject_jpeg(data: bytes, media_id: int) -> bytes:
    import piexif

    try:
        exif_dict = piexif.load(data)
    except Exception:
        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}

    exif_dict.setdefault("Exif", {})[piexif.ExifIFD.UserComment] = (
        _CHARSET_HEADER + f"{_PREFIX}{media_id}".encode("utf-8")
    )
    exif_bytes = piexif.dump(exif_dict)
    output = io.BytesIO()
    piexif.insert(exif_bytes, data, output)
    return output.getvalue()


def _inject_png(data: bytes, media_id: int) -> bytes:
    from PIL import Image, PngImagePlugin

    img = Image.open(io.BytesIO(data))
    meta = PngImagePlugin.PngInfo()
    # Preserva metadados de texto existentes
    for k, v in (img.text if hasattr(img, "text") else {}).items():
        if k != _KEY:
            meta.add_text(k, v)
    meta.add_text(_KEY, str(media_id))
    output = io.BytesIO()
    img.save(output, format="PNG", pnginfo=meta)
    return output.getvalue()


def _inject_webp(data: bytes, media_id: int) -> bytes:
    import piexif
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}
    exif_dict["Exif"][piexif.ExifIFD.UserComment] = (
        _CHARSET_HEADER + f"{_PREFIX}{media_id}".encode("utf-8")
    )
    exif_bytes = piexif.dump(exif_dict)
    output = io.BytesIO()
    img.save(output, format="WEBP", exif=exif_bytes, quality=100, method=0)
    return output.getvalue()


# ── Extração ─────────────────────────────────────────────────────────────────

def extract_media_id_exif(data: bytes) -> Optional[int]:
    # Detecta formato pelos magic bytes
    if data[:3] == b"\xff\xd8\xff":
        return _extract_jpeg(data)
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return _extract_png(data)
    if data[8:12] == b"WEBP":
        return _extract_webp(data)
    return None


def _extract_jpeg(data: bytes) -> Optional[int]:
    try:
        import piexif

        exif_dict = piexif.load(data)
        raw = exif_dict.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
        return _parse_user_comment(raw)
    except Exception as exc:
        logger.debug("extract JPEG falhou: %s", exc)
        return None


def _extract_png(data: bytes) -> Optional[int]:
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        text = img.text if hasattr(img, "text") else {}
        value = text.get(_KEY)
        return int(value) if value and value.isdigit() else None
    except Exception as exc:
        logger.debug("extract PNG falhou: %s", exc)
        return None


def _extract_webp(data: bytes) -> Optional[int]:
    try:
        import piexif
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        exif_raw = img.info.get("exif", b"")
        if not exif_raw:
            return None
        exif_dict = piexif.load(exif_raw)
        raw = exif_dict.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
        return _parse_user_comment(raw)
    except Exception as exc:
        logger.debug("extract WebP falhou: %s", exc)
        return None


def _parse_user_comment(raw: bytes) -> Optional[int]:
    if not raw:
        return None
    # Remove prefixo de charset (8 bytes) se presente
    text = raw[8:].decode("utf-8", errors="ignore") if len(raw) > 8 else raw.decode("utf-8", errors="ignore")
    match = _PATTERN.search(text)
    return int(match.group(1)) if match else None
