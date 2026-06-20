"""Hash perceptual para identificação de imagens independente de EXIF ou nome.

Usa dHash (difference hash) com grid 16×16 = 256 bits.
Robusto a: recompressão JPEG, ajustes de brilho/saturação, exportação pelo Canva.
Apenas Pillow — sem dependências extras.

Threshold recomendado: 50 bits (em 256).
  - Mesma foto editada no Canva: 5–30 bits
  - Fotos completamente diferentes: 80–180 bits
"""
import io
from typing import Optional

_HASH_SIZE = 16  # grid 16×16 → 256 bits


def compute(data: bytes) -> Optional[int]:
    """Computa dHash de uma imagem em bytes. Retorna None em caso de erro."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data)).convert("L")
        img = img.resize((_HASH_SIZE + 1, _HASH_SIZE), Image.LANCZOS)
        px = list(img.getdata())
        h = 0
        for row in range(_HASH_SIZE):
            for col in range(_HASH_SIZE):
                if px[row * (_HASH_SIZE + 1) + col] > px[row * (_HASH_SIZE + 1) + col + 1]:
                    h |= 1 << (row * _HASH_SIZE + col)
        return h
    except Exception:
        return None


def distance(h1: int, h2: int) -> int:
    """Distância de Hamming entre dois hashes (bits diferentes)."""
    return bin(h1 ^ h2).count("1")


MATCH_THRESHOLD = 50  # bits diferentes máximos para considerar mesma imagem
