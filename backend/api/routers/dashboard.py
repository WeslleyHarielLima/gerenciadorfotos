from collections import defaultdict
from datetime import date
from typing import List, Optional

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Router, Schema

from core.models import City, Event, Media, Task

router = Router(tags=["dashboard"])


class CityOut(Schema):
    id: int
    name: str
    state: str
    drive_folder_id: str
    active_event_count: int = 0

    @staticmethod
    def resolve_active_event_count(obj):
        return getattr(obj, "active_event_count", 0)


class EventOut(Schema):
    id: int
    name: str
    description: str
    location: str
    event_date: Optional[date] = None
    status: str
    city_name: str

    @staticmethod
    def resolve_city_name(obj):
        return obj.city.name


@router.get("/cities", response=List[CityOut])
def list_cities(request):
    return (
        City.objects.annotate(
            active_event_count=Count("events", filter=Q(events__status="active"))
        )
        .filter(active_event_count__gt=0)
        .order_by("name")
    )


@router.get("/cities/{city_id}/events", response=List[EventOut])
def list_events(request, city_id: int):
    get_object_or_404(City, pk=city_id)
    return (
        Event.objects.filter(city_id=city_id, status="active")
        .select_related("city")
        .order_by("-event_date")
    )


class ActiveTaskOut(Schema):
    task_id: int
    role_type: str
    media_id: int
    filename: str
    cloudinary_url: str | None = None
    event_id: int
    event_name: str
    city_id: int
    city_name: str


@router.get("/active-tasks", response=List[ActiveTaskOut])
def active_tasks(request):
    """Retorna as tasks em andamento ou pendentes do usuário autenticado."""
    user = request.auth
    tasks = (
        Task.objects.select_related(
            "media_version__media__event__city"
        )
        .filter(assigned_to=user, status__in=["pending", "in_progress"])
        .order_by("-created_at")
    )
    result = []
    for t in tasks:
        media = t.media_version.media
        event = media.event
        result.append(ActiveTaskOut(
            task_id=t.id,
            role_type=t.role_type,
            media_id=media.id,
            filename=media.original_filename,
            cloudinary_url=media.cloudinary_url or None,
            event_id=event.id,
            event_name=event.name,
            city_id=event.city.id,
            city_name=str(event.city),
        ))
    return result


# ── Resumo de trabalho por papel (badges/contador) ────────────────────────────

class WorkCityCount(Schema):
    city_id: int
    count: int


class WorkEventCount(Schema):
    event_id: int
    count: int


class WorkSummaryOut(Schema):
    role: str
    total: int
    active_events: int
    cities: List[WorkCityCount]
    events: List[WorkEventCount]


@router.get("/work-summary", response=WorkSummaryOut)
def work_summary(request):
    """Contagem de trabalho pendente do usuário, agrupada por cidade e evento.

    - curador/publicador: tasks pendentes atribuídas a ele.
    - editor: pool de mídias aguardando edição (status "uploaded").
    - uploader/admin: sem fila (retorna vazio).

    Alimenta os badges de notificação (Cidades/Eventos) e o contador do Início.
    """
    user = request.auth
    role = getattr(user, "role", "")
    by_city = defaultdict(int)
    by_event = defaultdict(int)

    if role in ("curator", "publisher"):
        tasks = Task.objects.select_related(
            "media_version__media__event"
        ).filter(assigned_to=user, role_type=role, status="pending")
        for t in tasks:
            event = t.media_version.media.event
            by_city[event.city_id] += 1
            by_event[event.id] += 1
    elif role == "editor":
        for media in Media.objects.select_related("event").filter(status="uploaded"):
            event = media.event
            by_city[event.city_id] += 1
            by_event[event.id] += 1

    return WorkSummaryOut(
        role=role,
        total=sum(by_event.values()),
        active_events=len(by_event),
        cities=[WorkCityCount(city_id=cid, count=c) for cid, c in by_city.items()],
        events=[WorkEventCount(event_id=eid, count=c) for eid, c in by_event.items()],
    )
