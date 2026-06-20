"""Watermark esteganográfico por modificação de pixels.

Embute o media_id diretamente nos pixels da imagem para que o identificador
persista mesmo quando ferramentas externas (Canva, etc.) removem todos os
metadados EXIF/PNG.

Esquema:
  - Payload: magic(2B) + version(1B) + media_id uint32(4B) = 7 bytes = 56 bits
  - Redundância: cada bit é gravado 3× consecutivos; extração por votação majoritária
  - Canal: vermelho (índice 0) de pixels sequenciais a partir do pixel (0,0)
  - Posição do bit: bit 2 (magnitude 4) — sobrevive à compressão JPEG até qualidade ~80
  - Imagens precisam de ao menos 168 pixels (56 bits × 3)
"""
import io
import struct
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_MAGIC = bytes([0xAB, 0xCD])
_VERSION = bytes([0x02])
_HEADER = _MAGIC + _VERSION        # 3 bytes de verificação
_PAYLOAD_BYTES = 7                 # header(3) + media_id(4)
_PAYLOAD_BITS = _PAYLOAD_BYTES * 8  # 56 bits
_REDUNDANCY = 3                    # votos por bit
_TOTAL_PIXELS = _PAYLOAD_BITS * _REDUNDANCY  # 168 pixels
_BIT_POS = 2                       # usa bit 2 (valor 4) para robustez em JPEG


def _to_bits(data: bytes) -> list:
    return [(b >> i) & 1 for b in data for i in range(7, -1, -1)]


def _from_bits(bits: list) -> bytes:
    out = []
    for i in range(0, len(bits), 8):
        byte = 0
        for j, b in enumerate(bits[i : i + 8]):
            byte = (byte << 1) | b
        out.append(byte)
    return bytes(out)


def embed_watermark(data: bytes, media_id: int, mime_type: str) -> bytes:
    """Embute media_id nos pixels da imagem. Retorna data inalterado em caso de falha."""
    if not data:
        return data
    try:
        from PIL import Image

        payload = _HEADER + struct.pack(">I", media_id)
        bits = _to_bits(payload)  # 56 bits

        img = Image.open(io.BytesIO(data))
        fmt = img.format or ("PNG" if mime_type == "image/png" else "JPEG")
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        px = list(img.getdata())
        if len(px) < _TOTAL_PIXELS:
            logger.warning("embed_watermark: imagem pequena demais (%d px, precisa %d)", len(px), _TOTAL_PIXELS)
            return data

        for i, bit in enumerate(bits):
            for r in range(_REDUNDANCY):
                idx = i * _REDUNDANCY + r
                p = list(px[idx])
                p[0] = (p[0] & ~(1 << _BIT_POS)) | (bit << _BIT_POS)
                px[idx] = tuple(p)

        img.putdata(px)
        buf = io.BytesIO()
        if fmt == "PNG":
            img.save(buf, format="PNG")
        elif fmt == "WEBP":
            img.save(buf, format="WEBP", quality=100, method=0)
        else:
            img.save(buf, format="JPEG", quality=95, subsampling=0)
        return buf.getvalue()

    except Exception as exc:
        logger.warning("embed_watermark falhou (media_id=%s): %s", media_id, exc)
        return data


def extract_watermark(data: bytes) -> Optional[int]:
    """Extrai media_id dos pixels via votação majoritária. Retorna None se inválido."""
    if not data:
        return None
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        px = list(img.getdata())
        if len(px) < _TOTAL_PIXELS:
            return None

        bits = []
        for i in range(_PAYLOAD_BITS):
            votes = [(px[i * _REDUNDANCY + r][0] >> _BIT_POS) & 1 for r in range(_REDUNDANCY)]
            bits.append(1 if sum(votes) > _REDUNDANCY // 2 else 0)

        payload = _from_bits(bits)

        if payload[:3] != _HEADER:
            return None

        media_id = struct.unpack(">I", payload[3:7])[0]
        return media_id if media_id > 0 else None

    except Exception as exc:
        logger.debug("extract_watermark falhou: %s", exc)
        return None
