import io
import os
import zipfile
from typing import List

from django.db import transaction
from django.db.models import Max
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Form, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from api.auth import require_role
from api.services.cloudinary_service import (
    IMAGE_MIME_TYPES,
    upload_thumbnail,
    upload_version_thumbnail,
)
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

# I5 — tetos para conter uso de memória (upload/zip são montados em RAM).
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

# Teto por arquivo no upload (bem abaixo do client_max_body_size 500M do nginx).
MAX_UPLOAD_BYTES = _env_int("MAX_UPLOAD_BYTES", 100 * 1024 * 1024)  # 100 MB
# Máximo de itens por lote de download (cada original é lido inteiro do Drive).
MAX_DOWNLOAD_BATCH = _env_int("MAX_DOWNLOAD_BATCH", 50)
# Teto do tamanho total acumulado do zip em memória.
MAX_DOWNLOAD_TOTAL_BYTES = _env_int("MAX_DOWNLOAD_TOTAL_BYTES", 500 * 1024 * 1024)  # 500 MB


class UploadResultItem(Schema):
    filename: str
    success: bool
    media_id: int | None = None
    cloudinary_url: str | None = None
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

        # I5 — rejeita arquivos acima do teto antes de subir ao Drive.
        if len(data) > MAX_UPLOAD_BYTES:
            results.append(
                UploadResultItem(filename=f.name, success=False,
                                 error=f"Arquivo excede o tamanho máximo de {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
            )
            continue

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

        cloudinary_result = upload_thumbnail(data, media.id, f.content_type)
        if cloudinary_result:
            media.cloudinary_url = cloudinary_result["url"]
            media.cloudinary_public_id = cloudinary_result["public_id"]
            media.save(update_fields=["cloudinary_url", "cloudinary_public_id"])
        elif f.content_type in IMAGE_MIME_TYPES:
            # Falhou no caminho síncrono — enfileira para retry offline (não bloqueia o upload).
            from core.models import PendingCloudinaryUpload
            PendingCloudinaryUpload.objects.create(media=media)

        results.append(UploadResultItem(
            filename=f.name,
            success=True,
            media_id=media.id,
            cloudinary_url=media.cloudinary_url or None,
        ))

    return UploadResponse(results=results)


class EventUploadStats(Schema):
    total: int
    in_pool: int


@router.get("/event/{event_id}/upload-stats", response=EventUploadStats)
@require_role("uploader", "admin")
def event_upload_stats(request, event_id: int):
    """Contador cumulativo de mídias já enviadas neste evento (persiste entre sessões)."""
    event = get_object_or_404(Event, id=event_id)
    qs = Media.objects.filter(event=event)
    return EventUploadStats(total=qs.count(), in_pool=qs.filter(status="uploaded").count())


class EventMediaItem(Schema):
    id: int
    original_filename: str
    mime_type: str
    status: str
    cloudinary_url: str | None = None


@router.get("/event/{event_id}/list", response=List[EventMediaItem])
@require_role("uploader", "admin")
def event_media_list(request, event_id: int):
    """Lista as mídias já enviadas no evento (para o uploader conferir/preview)."""
    event = get_object_or_404(Event, id=event_id)
    return [
        EventMediaItem(
            id=m.id,
            original_filename=m.original_filename,
            mime_type=m.mime_type,
            status=m.status,
            cloudinary_url=m.cloudinary_url or None,
        )
        for m in Media.objects.filter(event=event).order_by("-created_at")
    ]


@router.delete("/{int:media_id}")
@require_role("uploader", "admin")
def delete_media(request, media_id: int):
    """Remove uma mídia que o uploader enviou, enquanto ainda está no pool.

    Permitido apenas para mídias em status 'uploaded' (ainda não puxadas por um
    editor). Enfileira a deleção do arquivo no Drive (limpeza offline), apaga o
    thumbnail no Cloudinary (best-effort) e remove os registros do banco.
    """
    from django.db import transaction

    from core.models import ActivityLog, PendingDriveDeletion
    from api.services.cloudinary_service import delete_asset

    media = get_object_or_404(Media, id=media_id)

    if media.status != "uploaded":
        raise HttpError(
            409,
            "Esta mídia já entrou no fluxo de edição e não pode mais ser removida pelo uploader.",
        )

    filename = media.original_filename
    event_id = media.event_id

    # Coleta os public_ids do Cloudinary ANTES de apagar as versões.
    cloudinary_public_ids = []
    if media.cloudinary_public_id:
        cloudinary_public_ids.append(media.cloudinary_public_id)
    for v in media.versions.all():
        if v.cloudinary_public_id:
            cloudinary_public_ids.append(v.cloudinary_public_id)

    with transaction.atomic():
        # Drive: enfileira deleção offline de cada arquivo das versões.
        for v in media.versions.all():
            if v.drive_file_id:
                PendingDriveDeletion.objects.create(
                    drive_file_id=v.drive_file_id,
                    media_version=v,
                )

        ActivityLog.objects.create(
            user=request.auth,
            action="deleted",
            details=f"Mídia #{media_id} ({filename}) removida do evento #{event_id} pelo uploader.",
        )

        # Versões usam on_delete=PROTECT na Media — apaga antes.
        media.versions.all().delete()
        media.delete()

        # I2 — só remove thumbnails no Cloudinary se o commit do banco suceder
        # (evita apagar o asset e depois o banco fazer rollback, deixando órfão).
        def _cleanup_cloudinary(ids=cloudinary_public_ids):
            for pid in ids:
                delete_asset(pid)

        transaction.on_commit(_cleanup_cloudinary)

    return {"detail": "Mídia removida."}


class DownloadBatchRequest(Schema):
    media_ids: List[int]


@router.post("/download-batch")
@require_role("editor")
def download_batch(request, payload: DownloadBatchRequest):
    if not payload.media_ids:
        raise HttpError(400, "Informe ao menos um media_id.")

    # I5 — limita itens por lote (cada original é lido inteiro do Drive para a RAM).
    media_ids = list(dict.fromkeys(payload.media_ids))  # dedup preservando ordem
    if len(media_ids) > MAX_DOWNLOAD_BATCH:
        raise HttpError(400, f"Lote excede o máximo de {MAX_DOWNLOAD_BATCH} itens.")

    editor = request.auth
    buf = io.BytesIO()
    prepared = []  # (media_id, original_version_id, perceptual_hash)
    total_bytes = 0

    # I1 — 1ª passada: valida tudo e monta o zip (leituras read-only no Drive),
    # SEM mutar estado de banco. Se qualquer item falhar, nada foi commitado.
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for media_id in media_ids:
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

            # I5 — corta antes de estourar a memória do worker.
            total_bytes += len(data)
            if total_bytes > MAX_DOWNLOAD_TOTAL_BYTES:
                raise HttpError(413, "Tamanho total do lote excede o limite. Baixe em partes menores.")

            data = inject_media_id_exif(data, media.id, media.mime_type)

            # I8 — watermark removido: extract_watermark nunca era chamado em produção
            # (a identificação no upload-edited usa EXIF → nome → hash perceptual) e o
            # bit não sobrevivia ao JPEG. Re-encode full-res era custo de CPU sem retorno.
            from api.services.perceptual import compute as phash_compute, to_hex as phash_to_hex
            perceptual_hash = phash_to_hex(phash_compute(data))

            zf.writestr(media.original_filename, data)
            prepared.append((media.id, original_version.id, perceptual_hash))

    # I6 — 2ª passada: muta tudo atomicamente, com lock por linha. Revalida o status
    # sob o lock para que dois editores não puxem a mesma mídia simultaneamente.
    with transaction.atomic():
        locked = {
            m.id: m
            for m in Media.objects.select_for_update().filter(
                id__in=[mid for mid, _, _ in prepared]
            )
        }
        for media_id, _, _ in prepared:
            if locked.get(media_id) and locked[media_id].status != "uploaded":
                raise HttpError(409, f"Mídia #{media_id} já foi puxada por outro editor.")

        for media_id, original_version_id, perceptual_hash in prepared:
            media = locked[media_id]
            media.status = "selected_for_edit"
            media.save(update_fields=["status", "last_status_change"])
            Task.objects.create(
                media_version_id=original_version_id,
                assigned_to=editor,
                role_type="editor",
                status="in_progress",
                perceptual_hash=perceptual_hash,
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

        # I5 — rejeita arquivos acima do teto antes de qualquer processamento.
        if len(data) > MAX_UPLOAD_BYTES:
            results.append(
                UploadEditedResultItem(filename=f.name, success=False,
                                       error=f"Arquivo excede o tamanho máximo de {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
            )
            continue

        from api.services.exif import extract_media_id_exif
        media_id = extract_media_id_exif(data)

        task = None
        media = None

        if media_id is not None:
            # Identificação via EXIF (JPEG/JPG)
            try:
                media = Media.objects.get(id=media_id)
            except Media.DoesNotExist:
                results.append(
                    UploadEditedResultItem(filename=f.name, success=False,
                                           error=f"Mídia #{media_id} não encontrada.")
                )
                continue

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
        else:
            # Fallback 1: por nome de arquivo original
            task = Task.objects.filter(
                assigned_to=editor,
                role_type="editor",
                status="in_progress",
                media_version__media__original_filename=f.name,
            ).select_related("media_version__media").first()

            if task is None:
                # Fallback 2: hash perceptual (sobrevive recompressão JPEG e renomeação)
                from api.services.perceptual import compute as phash_compute, distance as phash_distance, from_hex as phash_from_hex, MATCH_THRESHOLD
                upload_hash = phash_compute(data)

                if upload_hash is not None:
                    active_tasks = Task.objects.select_related("media_version__media").filter(
                        assigned_to=editor,
                        role_type="editor",
                        status="in_progress",
                        perceptual_hash__isnull=False,
                    )
                    best_task = None
                    best_dist = MATCH_THRESHOLD + 1
                    for candidate in active_tasks:
                        dist = phash_distance(upload_hash, phash_from_hex(candidate.perceptual_hash))
                        if dist < best_dist:
                            best_dist = dist
                            best_task = candidate
                    if best_task is not None:
                        task = best_task
                        media = task.media_version.media

            if task is None:
                results.append(
                    UploadEditedResultItem(filename=f.name, success=False, unlinked=True,
                                           error="Arquivo não identificado (EXIF, nome e hash visual não encontrados). Mantenha o nome original ao exportar.")
                )
                continue

            if media is None:
                media = task.media_version.media

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

        # I2/I6/I7 — escritas de banco atômicas, com a mídia travada (select_for_update)
        # e o número da versão calculado por Max() sob o lock. Evita versões duplicadas
        # em uploads editados concorrentes e estado divergente em falha no meio do fluxo.
        with transaction.atomic():
            Media.objects.select_for_update().get(id=media.id)
            next_version = (media.versions.aggregate(m=Max("version"))["m"] or 0) + 1

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

        # Cloudinary é efeito externo best-effort — fica FORA da transação (após o commit).
        cloudinary_result = upload_version_thumbnail(data, media.id, next_version, f.content_type)
        if cloudinary_result:
            media_version.cloudinary_url = cloudinary_result["url"]
            media_version.cloudinary_public_id = cloudinary_result["public_id"]
            media_version.save(update_fields=["cloudinary_url", "cloudinary_public_id"])
        elif f.content_type in IMAGE_MIME_TYPES:
            from core.models import PendingCloudinaryUpload
            PendingCloudinaryUpload.objects.create(media_version=media_version)

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


class MediaVersionDetail(Schema):
    version: int
    status: str
    edited_by: str | None = None
    edited_at: str
    file_size: int


class MediaDetailSchema(Schema):
    id: int
    original_filename: str
    mime_type: str
    file_size: int
    status: str
    cloudinary_url: str | None = None
    event_id: int
    event_name: str
    city_name: str
    uploaded_by: str
    created_at: str
    versions: List[MediaVersionDetail]


def _user_can_access_media(user, media: Media) -> bool:
    """I4 — vínculo do usuário com a mídia/evento.

    Acesso permitido a: admin; quem enviou a mídia; curador/publicador (operam o
    fluxo de revisão/publicação do evento); ou qualquer usuário com uma task
    (ativa ou concluída) em alguma versão desta mídia.
    """
    if not user:
        return False
    if user.role in ("admin", "curator", "publisher"):
        return True
    if media.uploaded_by_id == user.id:
        return True
    return Task.objects.filter(media_version__media=media, assigned_to=user).exists()


@router.get("/{int:media_id}/detail", response=MediaDetailSchema)
def media_detail(request, media_id: int):
    """Retorna metadados completos e histórico de versões de uma mídia."""
    if not request.auth:
        raise HttpError(401, "Não autenticado.")

    media = get_object_or_404(Media, id=media_id)

    if not _user_can_access_media(request.auth, media):
        raise HttpError(404, "Mídia não encontrada.")

    versions = [
        MediaVersionDetail(
            version=v.version,
            status=v.status,
            edited_by=v.edited_by.username if v.edited_by else None,
            edited_at=v.edited_at.isoformat(),
            file_size=v.file_size,
        )
        for v in media.versions.order_by("version")
    ]

    return MediaDetailSchema(
        id=media.id,
        original_filename=media.original_filename,
        mime_type=media.mime_type,
        file_size=media.file_size,
        status=media.status,
        cloudinary_url=media.cloudinary_url or None,
        event_id=media.event.id,
        event_name=media.event.name,
        city_name=str(media.event.city),
        uploaded_by=media.uploaded_by.username,
        created_at=media.created_at.isoformat(),
        versions=versions,
    )


@router.get("/proxy/{int:media_id}/{int:version}")
@require_role("editor", "curator", "publisher", "admin")
def proxy_media(request, media_id: int, version: int):
    """Proxy autenticado para visualização de uma versão de mídia do Drive.

    I4 — recebe ``media_id``/``version`` e resolve o ``drive_file_id`` internamente
    (em vez de aceitar o id cru do Drive vindo do cliente), impedindo enumeração de
    arquivos do Drive. Restrito a papéis que participam do fluxo de revisão.
    """
    media_version = get_object_or_404(MediaVersion, media_id=media_id, version=version)

    try:
        data = get_file_bytes(media_version.drive_file_id)
    except Exception as exc:
        raise HttpError(502, f"Falha ao obter arquivo do Drive: {exc}")

    # I3 — detectar o tipo via Pillow (imghdr foi removido no Python 3.13).
    content_type = _detect_image_content_type(data)

    response = HttpResponse(data, content_type=content_type)
    response["Cache-Control"] = "private, max-age=900"
    return response


def _detect_image_content_type(data: bytes) -> str:
    """Detecta o Content-Type da imagem por magic bytes (via Pillow)."""
    from PIL import Image
    try:
        kind = Image.open(io.BytesIO(data)).format  # "JPEG", "PNG", "WEBP"...
        return f"image/{kind.lower()}" if kind else "application/octet-stream"
    except Exception:
        return "application/octet-stream"
