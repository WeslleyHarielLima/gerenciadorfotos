"""
Script de sincronização com Google Calendar.

Execução:
    cd backend
    source .venv/bin/activate
    python scripts/calendar_sync.py

Também pode ser chamado via: python -m scripts.calendar_sync
"""
import logging
import os
import re
import sys
import traceback
import django

logger = logging.getLogger(__name__)


def _calendar_id() -> str:
    return os.environ.get("GOOGLE_CALENDAR_ID", "")


def _drive_root_folder_id() -> str:
    return os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID", "")

BR_STATES = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
    "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
    "RS", "RO", "RR", "SC", "SP", "SE", "TO",
}

_STATE_RE = re.compile(r"\b([A-Z]{2})\b")


def normalize_city_name(location: str) -> tuple[str, str]:
    """
    Extrai (city_name, state_code) da string de localização do Calendar.

    Exemplos aceitos:
      "Porto Velho, RO"
      "Casamento X - Porto Velho/RO"
      "Venue Name - Porto Velho - RO"
      "Porto Velho"         → state="" se não encontrar

    Retorna ("", "") se não conseguir extrair cidade.
    """
    if not location:
        return "", ""

    state = ""
    for match in _STATE_RE.finditer(location):
        if match.group(1) in BR_STATES:
            state = match.group(1)
            break

    clean = location
    for sep in [" - ", ", ", "/", " — "]:
        parts = clean.split(sep)
        for i, part in enumerate(parts):
            part_stripped = part.strip()
            if part_stripped in BR_STATES or (state and part_stripped == state):
                remaining = [p for j, p in enumerate(parts) if j != i]
                clean = sep.join(remaining)
                break

    parts = [p.strip() for p in re.split(r"[,\-/—|]", clean) if p.strip()]
    if not parts:
        return "", state

    city = parts[-1].strip()
    for part in reversed(parts):
        stripped = part.strip()
        if stripped and stripped not in BR_STATES and len(stripped) > 2:
            city = stripped
            break

    return city.title(), state


def _get_or_create_city(city_name: str, state: str):
    from core.models import City
    from shared.drive import create_folder

    city, created = City.objects.get_or_create(
        name=city_name,
        state=state,
        defaults={"drive_folder_id": ""},
    )
    if created:
        logger.info("Nova cidade criada: %s/%s", city_name, state)
        drive_root = _drive_root_folder_id()
        if drive_root:
            try:
                folder_id = create_folder(f"{city_name} - {state}", drive_root)
                city.drive_folder_id = folder_id
                city.save(update_fields=["drive_folder_id"])
                logger.info("Pasta criada no Drive para %s/%s: %s", city_name, state, folder_id)
            except Exception as exc:
                logger.error("Falha ao criar pasta no Drive para %s/%s: %s", city_name, state, exc)
    return city


def _parse_event_date(calendar_event: dict) -> tuple:
    """Retorna (start_date, end_date) como strings YYYY-MM-DD ou None."""
    start = calendar_event.get("start", {})
    end = calendar_event.get("end", {})
    start_date = start.get("date") or (start.get("dateTime", "")[:10] or None)
    end_date = end.get("date") or (end.get("dateTime", "")[:10] or None)
    return start_date, end_date


def _sync_event(calendar_event: dict) -> str:
    """
    Processa um evento do Calendar.
    Retorna: "created" | "updated" | "cancelled" | "pending_validation" | "skipped"
    """
    from core.models import City, Event
    from shared.drive import create_event_folder_structure

    cal_id = calendar_event.get("id", "")
    status = calendar_event.get("status", "")
    summary = calendar_event.get("summary", "").strip()
    description = calendar_event.get("description", "") or ""
    location = calendar_event.get("location", "") or ""
    start_date, end_date = _parse_event_date(calendar_event)

    if status == "cancelled":
        updated = Event.objects.filter(google_calendar_event_id=cal_id).update(status="cancelled")
        if updated:
            logger.info("Evento cancelado no Calendar: %s (%s)", summary, cal_id)
        return "cancelled"

    if not location.strip():
        existing = Event.objects.filter(google_calendar_event_id=cal_id).first()
        if existing:
            existing.name = summary
            existing.description = description
            existing.status = "pending_validation"
            if start_date:
                existing.event_date = start_date
            existing.save(update_fields=["name", "description", "status", "event_date"])
            logger.warning("Evento sem localização (updated): %s (%s)", summary, cal_id)
            return "pending_validation"
        else:
            if not summary:
                return "skipped"
            dummy_city, _ = City.objects.get_or_create(
                name="Sem cidade",
                state="XX",
                defaults={"drive_folder_id": ""},
            )
            Event.objects.create(
                city=dummy_city,
                google_calendar_event_id=cal_id,
                name=summary,
                description=description,
                location=location,
                event_date=start_date,
                status="pending_validation",
            )
            logger.warning("Novo evento sem localização: %s (%s)", summary, cal_id)
            return "pending_validation"

    city_name, state = normalize_city_name(location)
    if not city_name:
        logger.warning("Não foi possível extrair cidade de: '%s' (evento: %s)", location, summary)
        return "pending_validation"

    city = _get_or_create_city(city_name, state)

    existing = Event.objects.filter(google_calendar_event_id=cal_id).first()
    if existing:
        existing.name = summary
        existing.description = description
        existing.location = location
        existing.city = city
        if start_date:
            existing.event_date = start_date
        if existing.status == "cancelled":
            existing.status = "active"
        existing.save(update_fields=["name", "description", "location", "city", "event_date", "status"])
        logger.info("Evento atualizado: %s (%s)", summary, cal_id)
        return "updated"
    else:
        drive_folder_id = ""
        drive_upload_folder_id = ""
        drive_root = _drive_root_folder_id()
        if city.drive_folder_id and drive_root:
            try:
                folders = create_event_folder_structure(summary, city.drive_folder_id)
                drive_folder_id = folders["event_folder_id"]
                drive_upload_folder_id = folders["subfolders"].get("01_uploaded", "")
            except Exception as exc:
                logger.error("Falha ao criar pastas no Drive para '%s': %s", summary, exc)

        Event.objects.create(
            city=city,
            google_calendar_event_id=cal_id,
            name=summary,
            description=description,
            location=location,
            event_date=start_date,
            google_drive_folder_id=drive_folder_id,
            drive_upload_folder_id=drive_upload_folder_id,
            status="active",
        )
        logger.info("Novo evento criado: %s (%s) — cidade: %s/%s", summary, cal_id, city_name, state)
        return "created"


def run() -> dict:
    from django.utils import timezone
    from core.models import ScriptExecutionLog
    from shared.calendar_client import list_events

    calendar_id = _calendar_id()
    if not calendar_id:
        logger.error("GOOGLE_CALENDAR_ID não configurado.")
        ScriptExecutionLog.objects.create(
            script_name="calendar_sync",
            status="failed",
            error_traceback="GOOGLE_CALENDAR_ID não configurado no .env.",
        )
        return {"status": "failed", "processed": 0, "failed": 0}

    last_log = (
        ScriptExecutionLog.objects.filter(script_name="calendar_sync", status="success")
        .order_by("-executed_at")
        .first()
    )

    sync_kwargs = {}
    if last_log:
        sync_kwargs["time_min"] = last_log.executed_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        sync_kwargs["time_min"] = "2020-01-01T00:00:00Z"

    try:
        result = list_events(calendar_id, **sync_kwargs)
    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("Falha ao buscar eventos do Calendar: %s", exc)
        ScriptExecutionLog.objects.create(
            script_name="calendar_sync",
            status="failed",
            error_traceback=tb,
        )
        return {"status": "failed", "processed": 0, "failed": 0}

    items = result.get("items", [])
    logger.info("calendar_sync: %d evento(s) recebido(s) do Calendar", len(items))

    processed = 0
    failed_count = 0

    for item in items:
        try:
            outcome = _sync_event(item)
            if outcome != "skipped":
                processed += 1
        except Exception as exc:
            failed_count += 1
            logger.error(
                "Erro ao processar evento '%s' (%s): %s",
                item.get("summary", "?"),
                item.get("id", "?"),
                exc,
            )

    final_status = "success" if failed_count == 0 else ("partial" if processed > 0 else "failed")
    ScriptExecutionLog.objects.create(
        script_name="calendar_sync",
        status=final_status,
        events_processed=processed,
        events_failed=failed_count,
        error_traceback="" if final_status == "success" else f"{failed_count} evento(s) falharam.",
    )

    logger.info(
        "calendar_sync concluído: %d processado(s), %d falha(s), status=%s",
        processed,
        failed_count,
        final_status,
    )
    return {"status": final_status, "processed": processed, "failed": failed_count}


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    result = run()
    print(result)
