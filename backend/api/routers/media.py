import io
import os
import zipfile
from typing import List

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from ninja import File, Form, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from api.auth import require_role
from api.services.exif import inject_media_id_exif
from api.services.hash import calculate_sha256
from core.models import Event, Media, MediaVersion, Task, TaskHistory
from shared.drive import (
    create_event_folder_structure,
    create_folder,
    get_file_bytes,
    get_subfolder_id,
    move_file,
    upload_file,
)

router = Router(tags=["media"])

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
}


class UploadResultItem(Schema):
    filename: str
    success: bool
    media_id: int | None = None
    error: str | None = None


class UploadResponse(Schema):
    results: List[UploadResultItem]


def _ensure_upload_folder(event: Event) -> str:
    """Garante que a estrutura de pastas do evento existe. Retorna ID da pasta 01_uploaded."""
    if event.drive_upload_folder_id:
        return event.drive_upload_folder_id

    root_folder_id = os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID", "")
    if not root_folder_id:
        raise HttpError(500, "GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado.")

    city = event.city
    if not city.drive_folder_id:
        city.drive_folder_id = create_folder(str(city), root_folder_id)
        city.save(update_fields=["drive_folder_id"])

    if not event.google_drive_folder_id:
        result = create_event_folder_structure(event.name, city.drive_folder_id)
        event.google_drive_folder_id = result["event_folder_id"]
        event.drive_upload_folder_id = result["subfolders"]["01_uploaded"]
        event.save(update_fields=["google_drive_folder_id", "drive_upload_folder_id"])
    else:
        upload_folder_id = get_subfolder_id(event.google_drive_folder_id, "01_uploaded")
        if not upload_folder_id:
            upload_folder_id = create_folder("01_uploaded", event.google_drive_folder_id)
        event.drive_upload_folder_id = upload_folder_id
        event.save(update_fields=["drive_upload_folder_id"])

    return event.drive_upload_folder_id


@router.post("/upload", response=UploadResponse)
@require_role("uploader")
def upload_media(
    request,
    event_id: int = Form(...),
    files: List[UploadedFile] = File(...),
):
    event = get_object_or_404(Event, id=event_id, status="active")
    upload_folder_id = _ensure_upload_folder(event)

    results: List[UploadResultItem] = []
    for f in files:
        if f.content_type not in ALLOWED_MIME_TYPES:
            results.append(
                UploadResultItem(filename=f.name, success=False, error="Tipo de arquivo não permitido.")
            )
            continue

        data = f.read()
        sha256 = calculate_sha256(data)

        try:
            drive_result = upload_file(data, f.name, upload_folder_id, f.content_type)
        except Exception as exc:
            results.append(
                UploadResultItem(filename=f.name, success=False, error=f"Falha no upload para o Drive: {exc}")
            )
            continue

        media = Media.objects.create(
            event=event,
            drive_file_id=drive_result["file_id"],
            drive_folder_id=upload_folder_id,
            web_view_link=drive_result["web_view_link"],
            original_filename=f.name,
            mime_type=f.content_type,
            file_size=len(data),
            hash_sha256=sha256,
            uploaded_by=request.auth,
            status="uploaded",
        )

        MediaVersion.objects.create(
            media=media,
            version=1,
            drive_file_id=drive_result["file_id"],
            hash_sha256=sha256,
            edited_by=None,
            status="original",
            file_size=len(data),
        )

        results.append(UploadResultItem(filename=f.name, success=True, media_id=media.id))

    return UploadResponse(results=results)


class DownloadBatchRequest(Schema):
    media_ids: List[int]


@router.post("/download-batch")
@require_role("editor")
def download_batch(request, payload: DownloadBatchRequest):
    if not payload.media_ids:
        raise HttpError(400, "Informe ao menos um media_id.")

    editor = request.auth
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for media_id in payload.media_ids:
            media = get_object_or_404(Media, id=media_id)

            if media.status != "uploaded":
                raise HttpError(
                    409,
                    f"Mídia #{media_id} não está disponível para edição (status: {media.status}).",
                )

            original_version = media.versions.filter(status="original").order_by("version").first()
            if not original_version:
                raise HttpError(500, f"Versão original da mídia #{media_id} não encontrada.")

            try:
                data = get_file_bytes(media.drive_file_id)
            except Exception as exc:
                raise HttpError(502, f"Falha ao baixar mídia #{media_id} do Drive: {exc}")

            data = inject_media_id_exif(data, media.id, media.mime_type)

            zf.writestr(media.original_filename, data)

            media.status = "selected_for_edit"
            media.save(update_fields=["status", "last_status_change"])

            Task.objects.create(
                media_version=original_version,
                assigned_to=editor,
                role_type="editor",
                status="in_progress",
            )

    buf.seek(0)
    response = HttpResponse(buf.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = 'attachment; filename="edicao.zip"'
    return response


class UploadEditedResultItem(Schema):
    filename: str
    success: bool
    media_version_id: int | None = None
    fraud_detected: bool = False
    unlinked: bool = False
    error: str | None = None


class UploadEditedResponse(Schema):
    results: List[UploadEditedResultItem]


def _get_versions_temp_folder(media: Media) -> str:
    """Retorna ID da pasta _versions_temp do evento da mídia."""
    event = media.event
    if not event.google_drive_folder_id:
        raise HttpError(500, "Evento sem pasta no Drive configurada.")
    folder_id = get_subfolder_id(event.google_drive_folder_id, "_versions_temp")
    if not folder_id:
        from shared.drive import create_folder as _create_folder
        folder_id = _create_folder("_versions_temp", event.google_drive_folder_id)
    return folder_id


@router.post("/upload-edited", response=UploadEditedResponse)
@require_role("editor")
def upload_edited(
    request,
    files: List[UploadedFile] = File(...),
):
    editor = request.auth
    results: List[UploadEditedResultItem] = []

    for f in files:
        data = f.read()

        # Extrair media_id do EXIF
        from api.services.exif import extract_media_id_exif
        media_id = extract_media_id_exif(data)

        if media_id is None:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False, unlinked=True,
                                       error="Arquivo sem EXIF de vínculo. Use a tela de vínculo manual.")
            )
            continue

        try:
            media = Media.objects.get(id=media_id)
        except Media.DoesNotExist:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error=f"Mídia #{media_id} não encontrada.")
            )
            continue

        # Validar task ativa do editor para essa mídia
        original_version = media.versions.filter(status="original").order_by("version").first()
        if not original_version:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error=f"Versão original da mídia #{media_id} não encontrada.")
            )
            continue

        task = Task.objects.filter(
            media_version=original_version,
            assigned_to=editor,
            role_type="editor",
            status="in_progress",
        ).first()

        if not task:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error=f"Nenhuma task ativa de edição para mídia #{media_id}.")
            )
            continue

        # Anti-fraude: hash da versão editada deve diferir do original
        new_hash = calculate_sha256(data)
        if new_hash == media.hash_sha256:
            task.feedback = "fraud_attempt: hash idêntico ao original"
            task.save(update_fields=["feedback", "updated_at"])
            results.append(
                UploadEditedResultItem(filename=f.name, success=False, fraud_detected=True,
                                       error="Arquivo idêntico ao original detectado (fraude).")
            )
            continue

        # Validar tamanho: mínimo 10% do original
        if len(data) < media.file_size * 0.10:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error="Arquivo muito pequeno em relação ao original (< 10%).")
            )
            continue

        # Validar mime_type
        if f.content_type not in ALLOWED_MIME_TYPES:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error="Tipo de arquivo não permitido.")
            )
            continue

        # Upload para _versions_temp
        try:
            temp_folder_id = _get_versions_temp_folder(media)
            drive_result = upload_file(data, f.name, temp_folder_id, f.content_type)
        except Exception as exc:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error=f"Falha no upload para o Drive: {exc}")
            )
            continue

        # Próximo número de versão
        next_version = media.versions.count() + 1

        media_version = MediaVersion.objects.create(
            media=media,
            version=next_version,
            drive_file_id=drive_result["file_id"],
            hash_sha256=new_hash,
            edited_by=editor,
            status="edited",
            file_size=len(data),
        )

        media.status = "pending_review"
        media.save(update_fields=["status", "last_status_change"])

        # Completa task do editor
        task.status = "completed"
        task.save(update_fields=["status", "updated_at"])

        # Cria task para o curador
        Task.objects.create(
            media_version=media_version,
            assigned_to=_get_any_curator(),
            role_type="curator",
            status="pending",
        )

        results.append(
            UploadEditedResultItem(filename=f.name, success=True, media_version_id=media_version.id)
        )

    return UploadEditedResponse(results=results)


def _get_any_curator():
    """Retorna qualquer curador ativo. Em produção, usar fila/assignment mais sofisticado."""
    from core.models import User
    curator = User.objects.filter(role="curator", is_active=True).first()
    if not curator:
        raise HttpError(500, "Nenhum curador ativo encontrado no sistema.")
    return curator
