"""Testes de controle de acesso: papéis, isolamento entre usuários e IDOR.

Os testes marcados com xfail documentam vulnerabilidades CONHECIDAS (ver
docs/antideploy.md, item I4): hoje o endpoint passa, mas o comportamento
desejado é negar. Quando a correção for aplicada, o xfail vira xpass e nos
avisa para remover a marca.
"""
import pytest

from core.models import Task
from conftest import make_jpeg

pytestmark = pytest.mark.django_db


# ── Matriz de papéis: cada endpoint protegido recusa o papel errado ───────────

@pytest.mark.parametrize("path_tmpl,method", [
    ("/api/tasks/review", "get"),
    ("/api/tasks/publish", "get"),
])
def test_endpoints_recusam_papel_errado(client, uploader, auth, path_tmpl, method):
    resp = getattr(client, method)(path_tmpl, **auth(uploader))
    assert resp.status_code == 403


def test_curador_nao_aprova_task_de_outro_curador(client, make_user, editor, auth, make_media):
    """Curador B não pode aprovar revisão atribuída ao curador A (isolamento por assigned_to)."""
    from api.services.exif import inject_media_id_exif
    from django.core.files.uploadedfile import SimpleUploadedFile

    curator_a = make_user("curator", username="curator_a")
    make_user("publisher", username="pub")
    media = make_media(status="uploaded")
    # coloca em edição e gera a revisão para o curador A
    media.status = "selected_for_edit"
    media.save(update_fields=["status"])
    original = media.versions.get(status="original")
    Task.objects.create(media_version=original, assigned_to=editor,
                        role_type="editor", status="in_progress")
    edited = inject_media_id_exif(make_jpeg(seed=77), media.id, "image/jpeg")
    client.post("/api/media/upload-edited",
                data={"files": SimpleUploadedFile("foto.jpg", edited, content_type="image/jpeg")},
                **auth(editor))
    review_task = Task.objects.get(role_type="curator", status="pending")
    # garante que a revisão pertence ao curador A
    review_task.assigned_to = curator_a
    review_task.save(update_fields=["assigned_to"])

    curator_b = make_user("curator", username="curator_b")
    resp = client.post(f"/api/tasks/{review_task.id}/approve", **auth(curator_b))
    assert resp.status_code == 404  # não enxerga task de outro curador


# ── IDOR (item I4 do antideploy) — CORRIGIDO ──────────────────────────────────

def test_proxy_exige_autenticacao(client, make_media):
    media = make_media()
    # Sem Authorization → 401 (a camada de auth nega antes de resolver a mídia).
    assert client.get(f"/api/media/proxy/{media.id}/1").status_code == 401


def test_detail_exige_autenticacao(client, make_media):
    media = make_media()
    assert client.get(f"/api/media/{media.id}/detail").status_code == 401


def test_detail_nega_usuario_sem_vinculo(client, make_media, make_user, auth):
    """I4 corrigido: uploader sem vínculo NÃO lê metadados de mídia alheia (404)."""
    media = make_media()
    estranho = make_user("uploader", username="sem_vinculo")
    resp = client.get(f"/api/media/{media.id}/detail", **auth(estranho))
    assert resp.status_code == 404


def test_detail_permite_uploader_dono(client, make_media, auth, uploader):
    """O uploader que enviou a mídia (make_media usa o fixture `uploader`) a enxerga."""
    media = make_media()
    resp = client.get(f"/api/media/{media.id}/detail", **auth(uploader))
    assert resp.status_code == 200


def test_detail_permite_curador(client, make_media, make_user, auth):
    """Curador participa do fluxo de revisão do evento → enxerga a mídia."""
    media = make_media()
    curador = make_user("curator", username="cur_detail")
    resp = client.get(f"/api/media/{media.id}/detail", **auth(curador))
    assert resp.status_code == 200


def test_proxy_nega_papel_sem_fluxo(client, make_media, make_user, auth):
    """I4 corrigido: uploader não acessa o proxy (restrito a editor/curador/publicador/admin)."""
    media = make_media()
    estranho = make_user("uploader", username="sem_vinculo3")
    resp = client.get(f"/api/media/proxy/{media.id}/1", **auth(estranho))
    assert resp.status_code == 403


def test_proxy_permite_papel_de_fluxo(client, make_media, editor, auth):
    """Editor (papel de fluxo) acessa o proxy resolvendo media_id/version internamente."""
    media = make_media()
    resp = client.get(f"/api/media/proxy/{media.id}/1", **auth(editor))
    assert resp.status_code == 200
