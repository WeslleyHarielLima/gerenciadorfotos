"""Fixtures e mocks compartilhados pela suíte.

Os serviços externos (Google Drive e Cloudinary) são substituídos por fakes
determinísticos para que os testes não toquem a rede nem precisem de credenciais.
Os módulos de imagem (exif, watermark, perceptual, hash) rodam de verdade.
"""
import hashlib
import io

import pytest
from PIL import Image

from api.auth import create_access_token
from core.models import City, Event, Media, MediaVersion, User

_SUBFOLDERS = [
    "01_uploaded", "02_editing", "03_review",
    "04_approved", "05_published", "_versions_temp",
]


# ── Geração de imagens de amostra (JPEG/PNG válidos, > 168 px) ─────────────────

def make_jpeg(seed: int = 0, size=(64, 64)) -> bytes:
    img = Image.new("RGB", size)
    w, h = size
    img.putdata([
        ((x * 3 + seed) % 256, (y * 5 + seed) % 256, (x + y + seed) % 256)
        for y in range(h) for x in range(w)
    ])
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, subsampling=0)
    return buf.getvalue()


def make_png(seed: int = 0, size=(64, 64)) -> bytes:
    img = Image.new("RGB", size)
    w, h = size
    img.putdata([
        ((x + seed) % 256, (y + seed) % 256, (x * y + seed) % 256)
        for y in range(h) for x in range(w)
    ])
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="session")
def sample_jpeg() -> bytes:
    return make_jpeg(seed=1)


# ── Mock dos serviços externos (autouse: protege contra qualquer chamada real) ─

@pytest.fixture(autouse=True)
def mock_external(monkeypatch, sample_jpeg):
    def fake_upload_file(data, filename, parent_id, mime_type):
        fid = "drive_" + hashlib.sha1(data[:64] + filename.encode()).hexdigest()[:12]
        return {"file_id": fid, "web_view_link": f"https://drive.example/{filename}"}

    def fake_get_file_bytes(file_id):
        return sample_jpeg

    def fake_create_folder(name, parent_id):
        return f"folder_{name}"

    def fake_create_structure(event_name, city_folder_id):
        return {
            "event_folder_id": "evt_folder",
            "subfolders": {s: f"sub_{s}" for s in _SUBFOLDERS},
        }

    def fake_get_subfolder_id(parent_id, name):
        return f"sub_{name}"

    def fake_move_file(file_id, new_parent_id, old_parent_id=None):
        return True

    def fake_thumb(*args, **kwargs):
        return {"url": "https://cl.example/thumb.jpg", "public_id": "pid_thumb"}

    def fake_delete_asset(public_id):
        return True

    import shared.drive as drive
    for name, fn in {
        "upload_file": fake_upload_file,
        "get_file_bytes": fake_get_file_bytes,
        "create_folder": fake_create_folder,
        "create_event_folder_structure": fake_create_structure,
        "get_subfolder_id": fake_get_subfolder_id,
        "move_file": fake_move_file,
    }.items():
        monkeypatch.setattr(drive, name, fn)

    # Nomes já vinculados no namespace do router (import por valor no topo do módulo).
    import api.routers.media as media_router
    for name, fn in {
        "upload_file": fake_upload_file,
        "get_file_bytes": fake_get_file_bytes,
        "create_folder": fake_create_folder,
        "create_event_folder_structure": fake_create_structure,
        "get_subfolder_id": fake_get_subfolder_id,
        "move_file": fake_move_file,
        "upload_thumbnail": fake_thumb,
        "upload_version_thumbnail": fake_thumb,
    }.items():
        monkeypatch.setattr(media_router, name, fn)

    import api.services.cloudinary_service as cl
    monkeypatch.setattr(cl, "delete_asset", fake_delete_asset)
    monkeypatch.setattr(cl, "upload_thumbnail", fake_thumb)
    monkeypatch.setattr(cl, "upload_version_thumbnail", fake_thumb)


# ── Usuários por papel ────────────────────────────────────────────────────────

@pytest.fixture
def make_user(db):
    def _make(role, username=None, password="pass12345", **kw):
        return User.objects.create_user(
            username=username or f"{role}_user", password=password, role=role, **kw
        )
    return _make


@pytest.fixture
def uploader(make_user):
    return make_user("uploader")


@pytest.fixture
def editor(make_user):
    return make_user("editor")


@pytest.fixture
def curator(make_user):
    return make_user("curator")


@pytest.fixture
def publisher(make_user):
    return make_user("publisher")


@pytest.fixture
def admin_user(make_user):
    return make_user("admin")


# ── Autenticação ──────────────────────────────────────────────────────────────

@pytest.fixture
def auth():
    """Retorna headers de Authorization Bearer para um usuário."""
    def _auth(user):
        return {"HTTP_AUTHORIZATION": f"Bearer {create_access_token(user)}"}
    return _auth


# ── Dados de domínio ──────────────────────────────────────────────────────────

@pytest.fixture
def event(db):
    city = City.objects.create(name="Porto Velho", state="RO", drive_folder_id="city_folder")
    return Event.objects.create(
        city=city,
        name="Casamento Teste",
        status="active",
        google_drive_folder_id="evt_folder",
        drive_upload_folder_id="sub_01_uploaded",
    )


@pytest.fixture
def make_media(db, event, uploader, sample_jpeg):
    """Cria uma Media + MediaVersion original com hash coerente."""
    def _make(status="uploaded", filename="foto.jpg", data=None):
        data = sample_jpeg if data is None else data
        h = hashlib.sha256(data).hexdigest()
        media = Media.objects.create(
            event=event,
            drive_file_id="drv_orig",
            original_filename=filename,
            mime_type="image/jpeg",
            file_size=len(data),
            hash_sha256=h,
            uploaded_by=uploader,
            status=status,
        )
        MediaVersion.objects.create(
            media=media, version=1, drive_file_id="drv_orig",
            hash_sha256=h, status="original", file_size=len(data),
        )
        return media
    return _make
