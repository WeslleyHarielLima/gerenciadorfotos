from collections import defaultdict
from typing import List, Optional

from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from api.auth import require_role
from core.models import Media, MediaVersion, PendingDriveDeletion, Task, TaskHistory

router = Router(tags=["tasks"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class MediaItemSchema(Schema):
    id: int
    original_filename: str
    mime_type: str
    file_size: int
    status: str
    cloudinary_url: Optional[str] = None


class TaskItemSchema(Schema):
    task_id: int
    media_id: int
    original_filename: str
    mime_type: str
    file_size: int
    status: str
    cloudinary_url: Optional[str] = None
    feedback: str = ""
    is_revision: bool = False


class EditorBoardSchema(Schema):
    available: List[MediaItemSchema]
    editing: List[TaskItemSchema]
    sent: List[TaskItemSchema]


# ── Board do editor ───────────────────────────────────────────────────────────

@router.get("/editor/board/{event_id}", response=EditorBoardSchema)
@require_role("editor")
def editor_board(request, event_id: int):
    from core.models import Event
    from django.shortcuts import get_object_or_404

    event = get_object_or_404(Event, id=event_id)
    editor = request.auth

    available = [
        MediaItemSchema(
            id=m.id,
            original_filename=m.original_filename,
            mime_type=m.mime_type,
            file_size=m.file_size,
            status=m.status,
            cloudinary_url=m.cloudinary_url or None,
        )
        for m in Media.objects.filter(event=event, status="uploaded")
    ]

    editing_tasks = Task.objects.select_related("media_version__media").filter(
        assigned_to=editor,
        role_type="editor",
        status="in_progress",
        media_version__media__event=event,
    )
    editing = [
        TaskItemSchema(
            task_id=t.id,
            media_id=t.media_version.media.id,
            original_filename=t.media_version.media.original_filename,
            mime_type=t.media_version.media.mime_type,
            file_size=t.media_version.media.file_size,
            status=t.media_version.media.status,
            cloudinary_url=t.media_version.media.cloudinary_url or None,
            # Tasks devolvidas pelo curador carregam o motivo e têm parent_task.
            feedback=t.feedback,
            is_revision=t.parent_task_id is not None,
        )
        for t in editing_tasks
    ]

    # "Enviadas": submissões que ainda valem — aguardando revisão, aprovadas ou
    # publicadas. Uma submissão rejeitada faz a mídia voltar para selected_for_edit
    # (e reabre uma task de edição), então a task completed antiga fica obsoleta e
    # NÃO deve aparecer aqui. Como todas as tentativas compartilham a media_version
    # original, deduplicamos por mídia mantendo a submissão mais recente.
    SENT_STATUSES = ("pending_review", "approved", "published")
    completed_tasks = Task.objects.select_related("media_version__media").filter(
        assigned_to=editor,
        role_type="editor",
        status="completed",
        media_version__media__event=event,
    ).order_by("media_version__media_id", "-updated_at")

    sent: List[TaskItemSchema] = []
    seen_media: set[int] = set()
    for t in completed_tasks:
        media = t.media_version.media
        if media.id in seen_media:
            continue
        seen_media.add(media.id)
        if media.status not in SENT_STATUSES:
            continue
        sent.append(
            TaskItemSchema(
                task_id=t.id,
                media_id=media.id,
                original_filename=media.original_filename,
                mime_type=media.mime_type,
                file_size=media.file_size,
                status=media.status,
                cloudinary_url=media.cloudinary_url or None,
            )
        )

    return EditorBoardSchema(available=available, editing=editing, sent=sent)


class AbandonRequest(Schema):
    reason_type: str
    reason_custom: str = ""


VALID_REASON_TYPES = {choice[0] for choice in Task.DELETION_REASON_CHOICES}


@router.post("/{task_id}/abandon")
@require_role("editor")
def abandon_task(request, task_id: int, payload: AbandonRequest):
    editor = request.auth

    task = Task.objects.select_related("media_version__media").filter(
        id=task_id, assigned_to=editor, role_type="editor"
    ).first()

    if not task:
        raise HttpError(404, "Tarefa não encontrada ou não pertence a você.")

    if task.status != "in_progress":
        raise HttpError(400, f"Tarefa não está em andamento (status atual: {task.status}).")

    if payload.reason_type not in VALID_REASON_TYPES:
        raise HttpError(
            400,
            f"Motivo inválido. Escolha entre: {', '.join(VALID_REASON_TYPES)}.",
        )

    if payload.reason_type == "other" and not payload.reason_custom.strip():
        raise HttpError(400, "Descrição obrigatória quando o motivo é 'outro'.")

    task.status = "abandoned"
    task.deletion_reason_type = payload.reason_type
    task.deletion_reason_custom = payload.reason_custom.strip()
    task.deleted_at = timezone.now()
    task.deleted_by = editor
    task.save(update_fields=[
        "status", "deletion_reason_type", "deletion_reason_custom",
        "deleted_at", "deleted_by", "updated_at",
    ])

    media = task.media_version.media
    media.status = "uploaded"
    media.save(update_fields=["status", "last_status_change"])

    return {"detail": "Tarefa abandonada. Arquivo devolvido ao pool."}


# ── Schemas do curador ────────────────────────────────────────────────────────

class VersionHistoryItem(Schema):
    version: int
    status: str
    edited_by: Optional[str]
    edited_at: str
    file_size: int


class ReviewItemSchema(Schema):
    task_id: int
    media_id: int
    original_filename: str
    mime_type: str
    cloudinary_url: Optional[str] = None
    edited_cloudinary_url: Optional[str] = None
    original_proxy_url: str
    edited_proxy_url: str
    version_history: List[VersionHistoryItem]


class ReviewListSchema(Schema):
    items: List[ReviewItemSchema]


class CuratorDecisionRequest(Schema):
    feedback: str = ""


# ── Endpoints do curador ──────────────────────────────────────────────────────

@router.get("/review", response=ReviewListSchema)
@require_role("curator")
def review_queue(request):
    """Lista itens aguardando revisão do curador autenticado."""
    curator = request.auth

    tasks = Task.objects.select_related(
        "media_version__media__event"
    ).filter(
        assigned_to=curator,
        role_type="curator",
        status="pending",
    )

    items: List[ReviewItemSchema] = []
    for task in tasks:
        edited_version = task.media_version
        media = edited_version.media

        original_version = media.versions.filter(status="original").order_by("version").first()
        original_proxy = (
            f"/api/media/proxy/{original_version.drive_file_id}" if original_version else ""
        )
        edited_proxy = f"/api/media/proxy/{edited_version.drive_file_id}"

        history = [
            VersionHistoryItem(
                version=v.version,
                status=v.status,
                edited_by=v.edited_by.username if v.edited_by else None,
                edited_at=v.edited_at.isoformat(),
                file_size=v.file_size,
            )
            for v in media.versions.order_by("version")
        ]

        items.append(
            ReviewItemSchema(
                task_id=task.id,
                media_id=media.id,
                original_filename=media.original_filename,
                mime_type=media.mime_type,
                cloudinary_url=media.cloudinary_url or None,
                edited_cloudinary_url=edited_version.cloudinary_url or None,
                original_proxy_url=original_proxy,
                edited_proxy_url=edited_proxy,
                version_history=history,
            )
        )

    return ReviewListSchema(items=items)


@router.post("/{task_id}/approve")
@require_role("curator")
def approve_task(request, task_id: int):
    """Aprova versão editada. Registra versões intermediárias para deleção e cria task do publicador."""
    curator = request.auth

    task = Task.objects.select_related("media_version__media").filter(
        id=task_id, assigned_to=curator, role_type="curator", status="pending"
    ).first()

    if not task:
        raise HttpError(404, "Tarefa de revisão não encontrada ou não pertence a você.")

    edited_version = task.media_version
    media = edited_version.media

    # Marcar versão editada como aprovada
    edited_version.status = "approved"
    edited_version.save(update_fields=["status"])

    media.status = "approved"
    media.save(update_fields=["status", "last_status_change"])

    # Registrar versões intermediárias (edited que não é a aprovada) para deleção
    intermediate_versions = media.versions.filter(status="edited").exclude(id=edited_version.id)
    for v in intermediate_versions:
        PendingDriveDeletion.objects.create(
            drive_file_id=v.drive_file_id,
            media_version=v,
        )

    # Concluir task do curador
    task.status = "completed"
    task.save(update_fields=["status", "updated_at"])

    # Histórico
    TaskHistory.objects.create(
        media=media,
        media_version=edited_version,
        reviewed_by=curator,
        decision="approved",
    )

    # Criar task do publicador
    from core.models import User
    publisher = User.objects.filter(role="publisher", is_active=True).first()
    if not publisher:
        raise HttpError(500, "Nenhum publicador ativo encontrado no sistema.")

    Task.objects.create(
        media_version=edited_version,
        assigned_to=publisher,
        role_type="publisher",
        status="pending",
    )

    return {"detail": "Mídia aprovada. Task do publicador criada."}


@router.post("/{task_id}/reject-with-return")
@require_role("curator")
def reject_with_return(request, task_id: int, payload: CuratorDecisionRequest):
    """Rejeita com retorno ao editor: volta para selected_for_edit e reabre task do editor."""
    if not payload.feedback.strip():
        raise HttpError(400, "Justificativa obrigatória para rejeição.")

    curator = request.auth

    task = Task.objects.select_related("media_version__media").filter(
        id=task_id, assigned_to=curator, role_type="curator", status="pending"
    ).first()

    if not task:
        raise HttpError(404, "Tarefa de revisão não encontrada ou não pertence a você.")

    edited_version = task.media_version
    media = edited_version.media

    # Marcar versão editada como rejeitada
    edited_version.status = "rejected"
    edited_version.save(update_fields=["status"])

    # Voltar status da mídia
    media.status = "selected_for_edit"
    media.save(update_fields=["status", "last_status_change"])

    # Concluir task do curador
    task.status = "completed"
    task.feedback = payload.feedback.strip()
    task.save(update_fields=["status", "feedback", "updated_at"])

    # Histórico
    TaskHistory.objects.create(
        media=media,
        media_version=edited_version,
        reviewed_by=curator,
        decision="rejected_with_return",
        feedback=payload.feedback.strip(),
    )

    # Criar nova task do editor (cadeia pai/filho): a task rejeitada vira parent,
    # permitindo rastrear original → rejeição V1 → nova tentativa V2 → aprovação.
    original_version = media.versions.filter(status="original").first()
    if original_version:
        previous_editor_task = Task.objects.filter(
            media_version=original_version,
            role_type="editor",
            status="completed",
        ).order_by("-updated_at").first()

        if previous_editor_task:
            Task.objects.create(
                media_version=original_version,
                assigned_to=previous_editor_task.assigned_to,
                role_type="editor",
                status="in_progress",
                feedback=payload.feedback.strip(),
                parent_task=previous_editor_task,
            )

    return {"detail": "Mídia devolvida ao editor para correção."}


@router.post("/{task_id}/reject-final")
@require_role("curator")
def reject_final(request, task_id: int, payload: CuratorDecisionRequest):
    """Rejeição definitiva: rejected_final, todas as versões editadas entram na fila de deleção."""
    if not payload.feedback.strip():
        raise HttpError(400, "Justificativa obrigatória para rejeição definitiva.")

    curator = request.auth

    task = Task.objects.select_related("media_version__media").filter(
        id=task_id, assigned_to=curator, role_type="curator", status="pending"
    ).first()

    if not task:
        raise HttpError(404, "Tarefa de revisão não encontrada ou não pertence a você.")

    edited_version = task.media_version
    media = edited_version.media

    media.status = "rejected_final"
    media.save(update_fields=["status", "last_status_change"])

    # Registrar todas as versões editadas para deleção
    for v in media.versions.filter(status="edited"):
        PendingDriveDeletion.objects.create(
            drive_file_id=v.drive_file_id,
            media_version=v,
        )
        v.status = "rejected"
        v.save(update_fields=["status"])

    # Concluir task do curador
    task.status = "completed"
    task.feedback = payload.feedback.strip()
    task.save(update_fields=["status", "feedback", "updated_at"])

    # Histórico
    TaskHistory.objects.create(
        media=media,
        media_version=edited_version,
        reviewed_by=curator,
        decision="rejected_final",
        feedback=payload.feedback.strip(),
    )

    return {"detail": "Mídia rejeitada definitivamente. Versões editadas agendadas para deleção."}


# ── Schemas do publicador ─────────────────────────────────────────────────────

class PublishItemSchema(Schema):
    task_id: int
    media_id: int
    original_filename: str
    mime_type: str
    cloudinary_url: Optional[str] = None
    proxy_url: str
    event_name: str
    city_name: str
    event_id: int
    city_id: int


class PublishListSchema(Schema):
    items: List[PublishItemSchema]


class PublishHistoryItemSchema(Schema):
    task_id: int
    media_id: int
    original_filename: str
    mime_type: str
    published_at: str
    event_name: str
    city_name: str


class PublishHistoryGroupSchema(Schema):
    date: str
    items: List[PublishHistoryItemSchema]


class PublishHistorySchema(Schema):
    groups: List[PublishHistoryGroupSchema]


# ── Endpoints do publicador ───────────────────────────────────────────────────

@router.get("/publish", response=PublishListSchema)
@require_role("publisher")
def publish_queue(request):
    """Lista tasks pendentes do publicador autenticado."""
    publisher = request.auth

    tasks = Task.objects.select_related(
        "media_version__media__event__city"
    ).filter(
        assigned_to=publisher,
        role_type="publisher",
        status="pending",
    )

    items: List[PublishItemSchema] = []
    for task in tasks:
        version = task.media_version
        media = version.media
        event = media.event
        city = event.city

        items.append(PublishItemSchema(
            task_id=task.id,
            media_id=media.id,
            original_filename=media.original_filename,
            mime_type=media.mime_type,
            # Mostra a versão editada/aprovada (a que será publicada), não a original.
            cloudinary_url=version.cloudinary_url or media.cloudinary_url or None,
            proxy_url=f"/api/media/proxy/{version.drive_file_id}",
            event_name=event.name,
            city_name=str(city),
            event_id=event.id,
            city_id=city.id,
        ))

    return PublishListSchema(items=items)


@router.post("/{task_id}/publish")
@require_role("publisher")
def publish_task(request, task_id: int):
    """Publica versão aprovada: move arquivo para 05_published e atualiza status."""
    from shared.drive import create_folder, get_subfolder_id, move_file

    publisher = request.auth

    task = Task.objects.select_related("media_version__media__event").filter(
        id=task_id, assigned_to=publisher, role_type="publisher", status="pending"
    ).first()

    if not task:
        raise HttpError(404, "Tarefa de publicação não encontrada ou não pertence a você.")

    version = task.media_version
    media = version.media
    event = media.event

    if not event.google_drive_folder_id:
        raise HttpError(500, "Evento sem pasta no Drive configurada.")

    published_folder_id = get_subfolder_id(event.google_drive_folder_id, "05_published")
    if not published_folder_id:
        published_folder_id = create_folder("05_published", event.google_drive_folder_id)

    try:
        move_file(version.drive_file_id, published_folder_id)
    except Exception as exc:
        raise HttpError(502, f"Falha ao mover arquivo no Drive: {exc}")

    media.status = "published"
    media.save(update_fields=["status", "last_status_change"])

    task.status = "completed"
    task.save(update_fields=["status", "updated_at"])

    return {"detail": "Mídia publicada com sucesso."}


@router.get("/publish/history", response=PublishHistorySchema)
@require_role("publisher")
def publish_history(request):
    """Retorna histórico de publicações agrupadas por data."""
    publisher = request.auth

    tasks = Task.objects.select_related(
        "media_version__media__event__city"
    ).filter(
        assigned_to=publisher,
        role_type="publisher",
        status="completed",
    ).order_by("-updated_at")

    groups_dict: dict = defaultdict(list)
    for task in tasks:
        media = task.media_version.media
        event = media.event
        city = event.city
        date_str = task.updated_at.date().isoformat()

        groups_dict[date_str].append(PublishHistoryItemSchema(
            task_id=task.id,
            media_id=media.id,
            original_filename=media.original_filename,
            mime_type=media.mime_type,
            published_at=task.updated_at.isoformat(),
            event_name=event.name,
            city_name=str(city),
        ))

    groups = [
        PublishHistoryGroupSchema(date=date, items=items)
        for date, items in groups_dict.items()
    ]

    return PublishHistorySchema(groups=groups)
