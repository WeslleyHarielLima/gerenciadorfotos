from typing import List, Optional

from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from api.auth import require_role
from core.models import Media, Task

router = Router(tags=["tasks"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class MediaItemSchema(Schema):
    id: int
    original_filename: str
    mime_type: str
    file_size: int
    status: str


class TaskItemSchema(Schema):
    task_id: int
    media_id: int
    original_filename: str
    mime_type: str
    file_size: int
    status: str


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
        )
        for t in editing_tasks
    ]

    sent_tasks = Task.objects.select_related("media_version__media").filter(
        assigned_to=editor,
        role_type="editor",
        status="completed",
        media_version__media__event=event,
    )
    sent = [
        TaskItemSchema(
            task_id=t.id,
            media_id=t.media_version.media.id,
            original_filename=t.media_version.media.original_filename,
            mime_type=t.media_version.media.mime_type,
            file_size=t.media_version.media.file_size,
            status=t.media_version.media.status,
        )
        for t in sent_tasks
    ]

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
