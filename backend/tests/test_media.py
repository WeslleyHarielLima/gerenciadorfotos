"""Testes do router de mídia: upload, listagem, remoção e download em lote."""
import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from core.models import Media, MediaVersion, Task
from conftest import make_jpeg

pytestmark = pytest.mark.django_db

UPLOAD_URL = "/api/media/upload"


def test_upload_cria_media_e_versao_original(client, uploader, event, auth, sample_jpeg):
    f = SimpleUploadedFile("foto.jpg", sample_jpeg, content_type="image/jpeg")
    resp = client.post(
        UPLOAD_URL,
        data={"event_id": event.id, "files": f},
        **auth(uploader),
    )
    assert resp.status_code == 200, resp.content
    item = resp.json()["results"][0]
    assert item["success"] is True
    media = Media.objects.get(id=item["media_id"])
    assert media.status == "uploaded"
    assert media.uploaded_by_id == uploader.id
    # versão original espelhando o arquivo
    v = MediaVersion.objects.get(media=media, version=1)
    assert v.status == "original"
    assert v.hash_sha256 == media.hash_sha256


def test_upload_rejeita_mime_nao_permitido(client, uploader, event, auth):
    f = SimpleUploadedFile("nota.txt", b"texto qualquer", content_type="text/plain")
    resp = client.post(UPLOAD_URL, data={"event_id": event.id, "files": f}, **auth(uploader))
    assert resp.status_code == 200
    item = resp.json()["results"][0]
    assert item["success"] is False
    assert "não permitido" in item["error"]
    assert Media.objects.count() == 0


def test_upload_exige_papel_uploader(client, editor, event, auth, sample_jpeg):
    f = SimpleUploadedFile("foto.jpg", sample_jpeg, content_type="image/jpeg")
    resp = client.post(UPLOAD_URL, data={"event_id": event.id, "files": f}, **auth(editor))
    assert resp.status_code == 403


def test_upload_stats_conta_pool(client, uploader, admin_user, event, auth, make_media):
    make_media(status="uploaded")
    make_media(status="approved", filename="outra.jpg")
    resp = client.get(f"/api/media/event/{event.id}/upload-stats", **auth(uploader))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["in_pool"] == 1


def test_delete_media_uploaded_remove(client, uploader, auth, make_media):
    media = make_media(status="uploaded")
    resp = client.delete(f"/api/media/{media.id}", **auth(uploader))
    assert resp.status_code == 200
    assert not Media.objects.filter(id=media.id).exists()


def test_delete_media_em_fluxo_bloqueia_409(client, uploader, auth, make_media):
    media = make_media(status="selected_for_edit")
    resp = client.delete(f"/api/media/{media.id}", **auth(uploader))
    assert resp.status_code == 409
    assert Media.objects.filter(id=media.id).exists()


def test_download_batch_puxa_para_edicao_e_cria_task(client, editor, auth, make_media):
    media = make_media(status="uploaded")
    resp = client.post(
        "/api/media/download-batch",
        data=json.dumps({"media_ids": [media.id]}),
        content_type="application/json",
        **auth(editor),
    )
    assert resp.status_code == 200, resp.content
    assert resp["Content-Type"] == "application/zip"
    media.refresh_from_db()
    assert media.status == "selected_for_edit"
    task = Task.objects.get(role_type="editor", assigned_to=editor)
    assert task.status == "in_progress"
    assert task.perceptual_hash  # hash visual gravado para matching posterior


def test_download_batch_media_indisponivel_409(client, editor, auth, make_media):
    media = make_media(status="approved")
    resp = client.post(
        "/api/media/download-batch",
        data=json.dumps({"media_ids": [media.id]}),
        content_type="application/json",
        **auth(editor),
    )
    assert resp.status_code == 409


def test_download_batch_vazio_400(client, editor, auth):
    resp = client.post(
        "/api/media/download-batch",
        data=json.dumps({"media_ids": []}),
        content_type="application/json",
        **auth(editor),
    )
    assert resp.status_code == 400
