import os
from typing import List

from django.shortcuts import get_object_or_404
from ninja import File, Form, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from api.auth import require_role
from api.services.hash import calculate_sha256
from core.models import Event, Media, MediaVersion
from shared.drive import (
    create_event_folder_structure,
    create_folder,
    get_subfolder_id,
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
