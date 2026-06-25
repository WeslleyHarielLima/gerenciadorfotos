"""Testes do fluxo de trabalho ponta a ponta e das transições de status por papel."""
import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from api.services.exif import inject_media_id_exif
from core.models import Media, MediaVersion, PendingDriveDeletion, Task, TaskHistory
from conftest import make_jpeg

pytestmark = pytest.mark.django_db


def _start_editing(media, editor):
    """Coloca a mídia em edição com uma task de editor em andamento na versão original."""
    media.status = "selected_for_edit"
    media.save(update_fields=["status"])
    original = media.versions.get(status="original")
    return Task.objects.create(
        media_version=original, assigned_to=editor,
        role_type="editor", status="in_progress",
    )


def _edited_upload(media, seed=2):
    """Arquivo 'editado': imagem diferente + EXIF com o media_id (identificação primária)."""
    data = inject_media_id_exif(make_jpeg(seed=seed), media.id, "image/jpeg")
    return SimpleUploadedFile("foto.jpg", data, content_type="image/jpeg")


def test_upload_edited_cria_versao_e_task_curador(client, editor, curator, auth, make_media):
    media = make_media(status="uploaded")
    _start_editing(media, editor)

    resp = client.post(
        "/api/media/upload-edited",
        data={"files": _edited_upload(media)},
        **auth(editor),
    )
    assert resp.status_code == 200, resp.content
    item = resp.json()["results"][0]
    assert item["success"] is True

    media.refresh_from_db()
    assert media.status == "pending_review"
    # versão editada v2 criada
    v2 = MediaVersion.objects.get(media=media, version=2)
    assert v2.status == "edited"
    assert v2.edited_by_id == editor.id
    # task do editor concluída e task do curador aberta
    assert Task.objects.filter(role_type="editor", status="completed").exists()
    assert Task.objects.filter(role_type="curator", status="pending", assigned_to=curator).exists()


def test_antifraude_hash_identico_rejeitado(client, editor, curator, auth, make_media, sample_jpeg):
    # original = sample_jpeg; reenviar EXATAMENTE os mesmos bytes → fraude
    media = make_media(status="uploaded")
    _start_editing(media, editor)

    f = SimpleUploadedFile("foto.jpg", sample_jpeg, content_type="image/jpeg")
    resp = client.post("/api/media/upload-edited", data={"files": f}, **auth(editor))
    assert resp.status_code == 200, resp.content
    item = resp.json()["results"][0]
    assert item["success"] is False
    assert item["fraud_detected"] is True
    # nenhuma versão nova; mídia continua em edição
    assert MediaVersion.objects.filter(media=media).count() == 1
    media.refresh_from_db()
    assert media.status == "selected_for_edit"


def test_curador_aprova_cria_task_publicador(client, editor, curator, publisher, auth, make_media):
    media = make_media(status="uploaded")
    _start_editing(media, editor)
    client.post("/api/media/upload-edited", data={"files": _edited_upload(media)}, **auth(editor))
    review_task = Task.objects.get(role_type="curator", status="pending")

    resp = client.post(f"/api/tasks/{review_task.id}/approve", **auth(curator))
    assert resp.status_code == 200, resp.content

    media.refresh_from_db()
    assert media.status == "approved"
    assert Task.objects.filter(role_type="publisher", status="pending", assigned_to=publisher).exists()
    assert TaskHistory.objects.filter(media=media, decision="approved").exists()


def test_rejeicao_com_retorno_reabre_editor(client, editor, curator, auth, make_media):
    media = make_media(status="uploaded")
    _start_editing(media, editor)
    client.post("/api/media/upload-edited", data={"files": _edited_upload(media)}, **auth(editor))
    review_task = Task.objects.get(role_type="curator", status="pending")

    resp = client.post(
        f"/api/tasks/{review_task.id}/reject-with-return",
        data=json.dumps({"feedback": "exposição estourada"}),
        content_type="application/json",
        **auth(curator),
    )
    assert resp.status_code == 200, resp.content

    media.refresh_from_db()
    assert media.status == "selected_for_edit"
    # nova task de edição reaberta, encadeada à anterior
    reopened = Task.objects.filter(role_type="editor", status="in_progress").order_by("-id").first()
    assert reopened is not None
    assert reopened.parent_task_id is not None
    assert reopened.feedback == "exposição estourada"


def test_rejeicao_sem_feedback_400(client, editor, curator, auth, make_media):
    media = make_media(status="uploaded")
    _start_editing(media, editor)
    client.post("/api/media/upload-edited", data={"files": _edited_upload(media)}, **auth(editor))
    review_task = Task.objects.get(role_type="curator", status="pending")

    resp = client.post(
        f"/api/tasks/{review_task.id}/reject-with-return",
        data=json.dumps({"feedback": "   "}),
        content_type="application/json",
        **auth(curator),
    )
    assert resp.status_code == 400


def test_rejeicao_final_agenda_delecao(client, editor, curator, auth, make_media):
    media = make_media(status="uploaded")
    _start_editing(media, editor)
    client.post("/api/media/upload-edited", data={"files": _edited_upload(media)}, **auth(editor))
    review_task = Task.objects.get(role_type="curator", status="pending")

    resp = client.post(
        f"/api/tasks/{review_task.id}/reject-final",
        data=json.dumps({"feedback": "fora de foco irrecuperável"}),
        content_type="application/json",
        **auth(curator),
    )
    assert resp.status_code == 200, resp.content

    media.refresh_from_db()
    assert media.status == "rejected_final"
    assert PendingDriveDeletion.objects.filter(media_version__media=media).exists()


def test_publicador_publica(client, editor, curator, publisher, auth, make_media):
    media = make_media(status="uploaded")
    _start_editing(media, editor)
    client.post("/api/media/upload-edited", data={"files": _edited_upload(media)}, **auth(editor))
    review_task = Task.objects.get(role_type="curator", status="pending")
    client.post(f"/api/tasks/{review_task.id}/approve", **auth(curator))
    publish_task = Task.objects.get(role_type="publisher", status="pending")

    resp = client.post(f"/api/tasks/{publish_task.id}/publish", **auth(publisher))
    assert resp.status_code == 200, resp.content

    media.refresh_from_db()
    assert media.status == "published"
    publish_task.refresh_from_db()
    assert publish_task.status == "completed"


def test_fluxo_completo_ponta_a_ponta(client, uploader, editor, curator, publisher, auth, event, sample_jpeg):
    """uploaded → selected_for_edit → pending_review → approved → published."""
    # 1. uploader envia
    up = client.post(
        "/api/media/upload",
        data={"event_id": event.id, "files": SimpleUploadedFile("foto.jpg", sample_jpeg, content_type="image/jpeg")},
        **auth(uploader),
    )
    media_id = up.json()["results"][0]["media_id"]

    # 2. editor puxa para edição
    client.post(
        "/api/media/download-batch",
        data=json.dumps({"media_ids": [media_id]}),
        content_type="application/json",
        **auth(editor),
    )
    assert Media.objects.get(id=media_id).status == "selected_for_edit"

    # 3. editor devolve versão editada
    edited = inject_media_id_exif(make_jpeg(seed=42), media_id, "image/jpeg")
    client.post(
        "/api/media/upload-edited",
        data={"files": SimpleUploadedFile("foto.jpg", edited, content_type="image/jpeg")},
        **auth(editor),
    )
    assert Media.objects.get(id=media_id).status == "pending_review"

    # 4. curador aprova
    review_task = Task.objects.get(role_type="curator", status="pending")
    client.post(f"/api/tasks/{review_task.id}/approve", **auth(curator))
    assert Media.objects.get(id=media_id).status == "approved"

    # 5. publicador publica
    pub_task = Task.objects.get(role_type="publisher", status="pending")
    client.post(f"/api/tasks/{pub_task.id}/publish", **auth(publisher))
    assert Media.objects.get(id=media_id).status == "published"


def test_abandono_devolve_ao_pool(client, editor, auth, make_media):
    media = make_media(status="uploaded")
    task = _start_editing(media, editor)
    resp = client.post(
        f"/api/tasks/{task.id}/abandon",
        data=json.dumps({"reason_type": "technical_issue"}),
        content_type="application/json",
        **auth(editor),
    )
    assert resp.status_code == 200, resp.content
    task.refresh_from_db()
    media.refresh_from_db()
    assert task.status == "abandoned"
    assert media.status == "uploaded"


def test_abandono_motivo_other_exige_descricao(client, editor, auth, make_media):
    media = make_media(status="uploaded")
    task = _start_editing(media, editor)
    resp = client.post(
        f"/api/tasks/{task.id}/abandon",
        data=json.dumps({"reason_type": "other", "reason_custom": ""}),
        content_type="application/json",
        **auth(editor),
    )
    assert resp.status_code == 400
