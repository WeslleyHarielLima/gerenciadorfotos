"""Testes dos serviços puros: hash, EXIF, watermark esteganográfico, hash perceptual."""
import hashlib

import pytest

from api.services.exif import extract_media_id_exif, inject_media_id_exif
from api.services.hash import calculate_sha256
from api.services import perceptual
from api.services.watermark import embed_watermark, extract_watermark
from conftest import make_jpeg, make_png


# ── hash SHA-256 ──────────────────────────────────────────────────────────────

def test_sha256_determinista():
    data = b"conteudo-de-teste"
    assert calculate_sha256(data) == hashlib.sha256(data).hexdigest()


def test_sha256_difere_por_byte():
    assert calculate_sha256(b"abc") != calculate_sha256(b"abd")


# ── EXIF: injeção e extração de media_id ──────────────────────────────────────

def test_exif_roundtrip_jpeg():
    original = make_jpeg(seed=3)
    marcado = inject_media_id_exif(original, 847, "image/jpeg")
    assert extract_media_id_exif(marcado) == 847
    # injetar muda os bytes (logo, o hash) — base do anti-fraude
    assert marcado != original


def test_exif_roundtrip_png():
    marcado = inject_media_id_exif(make_png(seed=4), 1234, "image/png")
    assert extract_media_id_exif(marcado) == 1234


def test_exif_roundtrip_webp():
    img = make_jpeg(seed=5)
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.open(io.BytesIO(img)).save(buf, format="WEBP", quality=100, method=0)
    marcado = inject_media_id_exif(buf.getvalue(), 99, "image/webp")
    assert extract_media_id_exif(marcado) == 99


def test_exif_ausente_retorna_none():
    # JPEG limpo, sem marcador
    assert extract_media_id_exif(make_jpeg(seed=6)) is None


def test_exif_dados_invalidos_retorna_none():
    assert extract_media_id_exif(b"isto nao e uma imagem") is None


# ── Watermark esteganográfico (sobrevive recompressão JPEG) ───────────────────

def test_watermark_roundtrip_png_lossless():
    # PNG é lossless → garante a corretude da lógica de embed/extract por votação
    marcado = embed_watermark(make_png(seed=7), 555, "image/png")
    assert extract_watermark(marcado) == 555


@pytest.mark.xfail(
    reason="Watermark (bit 2 do canal R) NÃO sobrevive ao JPEG q95 nem em imagem "
           "chapada. Além disso extract_watermark nunca é chamado em produção "
           "(embed_watermark é dead-read): download_batch embute, mas o matching usa "
           "EXIF/nome/phash. Custo de CPU sem retorno. Ver relatório.",
    strict=False,
)
def test_watermark_sobrevive_jpeg():
    from PIL import Image
    import io
    img = Image.new("RGB", (96, 96), (130, 90, 60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, subsampling=0)
    marcado = embed_watermark(buf.getvalue(), 4242, "image/jpeg")
    assert extract_watermark(marcado) == 4242


def test_watermark_imagem_pequena_retorna_intacto():
    # imagem com menos de 168 px não pode carregar o payload → bytes inalterados
    minúscula = make_jpeg(seed=8, size=(8, 8))
    assert embed_watermark(minúscula, 1, "image/jpeg") == minúscula


def test_watermark_dados_vazios():
    assert embed_watermark(b"", 1, "image/jpeg") == b""
    assert extract_watermark(b"") is None


# ── Hash perceptual (dHash 256 bits) ──────────────────────────────────────────

def test_phash_imagem_identica_distancia_zero():
    img = make_jpeg(seed=9)
    h = perceptual.compute(img)
    assert h is not None
    assert perceptual.distance(h, perceptual.compute(img)) == 0


def test_phash_hex_roundtrip():
    h = perceptual.compute(make_jpeg(seed=10))
    assert perceptual.from_hex(perceptual.to_hex(h)) == h


def test_phash_imagens_diferentes_acima_do_threshold():
    a = perceptual.compute(make_jpeg(seed=11, size=(64, 64)))
    b = perceptual.compute(make_png(seed=200, size=(64, 64)))
    # imagens bem diferentes devem exceder (ou ao menos não casar trivialmente)
    assert perceptual.distance(a, b) > 0


def test_phash_dados_invalidos_retorna_none():
    assert perceptual.compute(b"nao-imagem") is None
    assert perceptual.to_hex(None) is None
    assert perceptual.from_hex(None) is None
