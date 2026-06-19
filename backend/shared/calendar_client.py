"""Wrapper do Google Calendar API v3."""
import logging
import os
import time

logger = logging.getLogger(__name__)

CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
_RETRYABLE_STATUS = {429, 500, 503}
_BACKOFF_DELAYS = [1, 2, 4, 8, 16]


def _get_calendar_credentials():
    token_file = os.environ.get("GOOGLE_OAUTH_CALENDAR_TOKEN_FILE") or os.environ.get(
        "GOOGLE_OAUTH_TOKEN_FILE"
    )
    if token_file and os.path.exists(token_file):
        import json

        from google.oauth2.credentials import Credentials

        with open(token_file) as f:
            data = json.load(f)
        return Credentials(
            token=data.get("token"),
            refresh_token=data["refresh_token"],
            token_uri=data["token_uri"],
            client_id=data["client_id"],
            client_secret=data["client_secret"],
            scopes=data.get("scopes", CALENDAR_SCOPES),
        )

    creds_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_file and os.path.exists(creds_file):
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_file(
            creds_file, scopes=CALENDAR_SCOPES
        )

    import google.auth

    creds, _ = google.auth.default(scopes=CALENDAR_SCOPES)
    return creds


def get_calendar_service():
    from googleapiclient.discovery import build

    return build(
        "calendar", "v3", credentials=_get_calendar_credentials(), cache_discovery=False
    )


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
            logger.warning("Calendar API retry em %ds: %s", delay, exc)
            time.sleep(delay)
    raise last_exc


def list_events(calendar_id: str, time_min: str = None, sync_token: str = None) -> dict:
    """
    Busca eventos do Calendar.
    Se sync_token fornecido, faz incremental sync (só mudanças desde o último sync).
    Se time_min fornecido, filtra a partir dessa data (formato RFC3339).
    Retorna {"items": [...], "next_sync_token": "...", "next_page_token": "..."}
    """

    def _do():
        service = get_calendar_service()
        params = {
            "calendarId": calendar_id,
            "singleEvents": True,
            "maxResults": 250,
        }
        if sync_token:
            params["syncToken"] = sync_token
        elif time_min:
            params["timeMin"] = time_min
            params["orderBy"] = "startTime"

        all_items = []
        next_page_token = None
        next_sync_token = None

        while True:
            if next_page_token:
                params["pageToken"] = next_page_token
            result = service.events().list(**params).execute()
            all_items.extend(result.get("items", []))
            next_page_token = result.get("nextPageToken")
            next_sync_token = result.get("nextSyncToken")
            if not next_page_token:
                break

        return {"items": all_items, "next_sync_token": next_sync_token}

    return _with_backoff(_do)
