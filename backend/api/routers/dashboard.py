from datetime import date
from typing import List, Optional

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Router, Schema

from core.models import City, Event, Task

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
            event_id=event.id,
            event_name=event.name,
            city_id=event.city.id,
            city_name=str(event.city),
        ))
    return result
