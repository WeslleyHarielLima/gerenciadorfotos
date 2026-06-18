"""Wrapper do Google Drive API v3 com backoff exponencial em 429/503."""
import io
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive"]
_RETRYABLE_STATUS = {429, 500, 503}
_BACKOFF_DELAYS = [1, 2, 4, 8, 16]


def _get_credentials():
    from google.oauth2 import service_account
    creds_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_file:
        return service_account.Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    import google.auth
    creds, _ = google.auth.default(scopes=SCOPES)
    return creds


def get_drive_service():
    from googleapiclient.discovery import build
    return build("drive", "v3", credentials=_get_credentials(), cache_discovery=False)


def _with_backoff(fn):
    last_exc = None
    for delay in _BACKOFF_DELAYS:
        try:
            return fn()
        except Exception as exc:
            status = getattr(getattr(exc, "resp", None), "status", None)
            if status and int(status) not in _RETRYABLE_STATUS:
                raise
            last_exc = exc
            logger.warning("Drive API retry em %ds: %s", delay, exc)
            time.sleep(delay)
    raise last_exc


def create_folder(name: str, parent_id: str) -> str:
    """Cria pasta no Drive e retorna seu file_id."""
    def _do():
        service = get_drive_service()
        meta = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        f = service.files().create(body=meta, fields="id").execute()
        return f["id"]
    return _with_backoff(_do)


def upload_file(data: bytes, filename: str, parent_id: str, mime_type: str) -> dict:
    """Faz upload de bytes para o Drive. Retorna {"file_id": ..., "web_view_link": ...}."""
    from googleapiclient.http import MediaIoBaseUpload

    def _do():
        service = get_drive_service()
        meta = {"name": filename, "parents": [parent_id]}
        media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime_type, resumable=True)
        f = service.files().create(body=meta, media_body=media, fields="id,webViewLink").execute()
        return {"file_id": f["id"], "web_view_link": f.get("webViewLink", "")}
    return _with_backoff(_do)


def move_file(file_id: str, new_parent_id: str, old_parent_id: Optional[str] = None) -> bool:
    """Move arquivo para nova pasta."""
    def _do():
        service = get_drive_service()
        kwargs = {"fileId": file_id, "addParents": new_parent_id, "fields": "id"}
        if old_parent_id:
            kwargs["removeParents"] = old_parent_id
        service.files().update(**kwargs).execute()
        return True
    return _with_backoff(_do)


def delete_file(file_id: str) -> bool:
    """Deleta arquivo. Retorna False se não existir, True se deletou."""
    try:
        def _do():
            service = get_drive_service()
            service.files().delete(fileId=file_id).execute()
            return True
        return _with_backoff(_do)
    except Exception as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        if status and int(status) == 404:
            return False
        raise


def get_file_bytes(file_id: str) -> bytes:
    """Baixa arquivo do Drive e retorna bytes."""
    from googleapiclient.http import MediaIoBaseDownload

    def _do():
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()
    return _with_backoff(_do)


def generate_signed_url(file_id: str, expiration_seconds: int = 900) -> str:
    """
    Retorna URL de download do arquivo via Drive.
    Drive não suporta signed URLs como GCS; retorna webContentLink.
    Para exibição privada no curador, use o endpoint /api/media/{id}/download
    que faz proxy autenticado.
    """
    def _do():
        service = get_drive_service()
        f = service.files().get(fileId=file_id, fields="webContentLink,webViewLink").execute()
        return f.get("webContentLink") or f.get("webViewLink", "")
    return _with_backoff(_do)


def get_subfolder_id(parent_id: str, name: str) -> Optional[str]:
    """Localiza subfolder por nome. Retorna None se não encontrar."""
    def _do():
        service = get_drive_service()
        q = (
            f"'{parent_id}' in parents"
            f" and name='{name}'"
            " and mimeType='application/vnd.google-apps.folder'"
            " and trashed=false"
        )
        results = service.files().list(q=q, fields="files(id)").execute()
        files = results.get("files", [])
        return files[0]["id"] if files else None
    return _with_backoff(_do)


_SUBFOLDERS = [
    "01_uploaded",
    "02_editing",
    "03_review",
    "04_approved",
    "05_published",
    "_versions_temp",
]


def create_event_folder_structure(event_name: str, city_folder_id: str) -> dict:
    """
    Cria estrutura completa de pastas do evento:
      city_folder/event_name/{01_uploaded, 02_editing, ...}
    Retorna {"event_folder_id": ..., "subfolders": {"01_uploaded": ..., ...}}
    """
    event_folder_id = create_folder(event_name, city_folder_id)
    subfolders = {sub: create_folder(sub, event_folder_id) for sub in _SUBFOLDERS}
    return {"event_folder_id": event_folder_id, "subfolders": subfolders}
