import os
from datetime import timedelta
from typing import List, Optional

from django.utils import timezone
from ninja import Router, Schema

from api.auth import require_role

router = Router(tags=["admin"])


def _threshold(env_var: str, default: int) -> int:
    try:
        return int(os.environ.get(env_var, default))
    except (ValueError, TypeError):
        return default


# ── Schemas ───────────────────────────────────────────────────────────────────

class BottleneckItem(Schema):
    phase: str
    event_id: int
    event_name: str
    city_name: str
    media_id: int
    filename: str
    hours_stuck: float
    threshold_hours: int
    assigned_to: Optional[str] = None


class BottlenecksOut(Schema):
    bottlenecks: List[BottleneckItem]
    thresholds: dict


class PhaseCounts(Schema):
    uploaded: int = 0
    selected_for_edit: int = 0
    pending_review: int = 0
    approved: int = 0
    published: int = 0
    rejected_final: int = 0


class EventOverviewItem(Schema):
    id: int
    name: str
    city_name: str
    event_date: Optional[str] = None
    counts: PhaseCounts
    total_active: int


class ScriptHealthItem(Schema):
    last_status: Optional[str] = None
    last_run: Optional[str] = None
    is_healthy: bool


class AdminOverviewOut(Schema):
    events: List[EventOverviewItem]
    script_health: dict
    pending_validation_count: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/bottlenecks", response=BottlenecksOut)
@require_role("admin")
def bottlenecks(request, city_id: Optional[int] = None):
    from core.models import Media

    thresholds = {
        "uploaded": _threshold("BOTTLENECK_UPLOADED_HOURS", 48),
        "selected_for_edit": _threshold("BOTTLENECK_EDITING_HOURS", 72),
        "pending_review": _threshold("BOTTLENECK_REVIEW_HOURS", 24),
        "approved": _threshold("BOTTLENECK_APPROVED_HOURS", 24),
    }

    now = timezone.now()
    items: List[BottleneckItem] = []

    for phase, hours in thresholds.items():
        cutoff = now - timedelta(hours=hours)
        qs = Media.objects.select_related(
            "event__city", "uploaded_by"
        ).filter(
            status=phase,
            last_status_change__lt=cutoff,
        )
        if city_id:
            qs = qs.filter(event__city_id=city_id)

        for media in qs:
            hours_stuck = (now - media.last_status_change).total_seconds() / 3600

            # Usuário responsável pela fase atual
            assigned_to = None
            if phase == "uploaded":
                assigned_to = None
            elif phase == "selected_for_edit":
                task = media.versions.filter(
                    tasks__role_type="editor",
                    tasks__status="in_progress",
                ).first()
                if task and task.tasks.filter(role_type="editor", status="in_progress").exists():
                    t = task.tasks.filter(role_type="editor", status="in_progress").first()
                    assigned_to = t.assigned_to.username if t else None
            elif phase == "pending_review":
                from core.models import Task
                t = Task.objects.filter(
                    media_version__media=media,
                    role_type="curator",
                    status="pending",
                ).select_related("assigned_to").first()
                assigned_to = t.assigned_to.username if t else None
            elif phase == "approved":
                from core.models import Task
                t = Task.objects.filter(
                    media_version__media=media,
                    role_type="publisher",
                    status="pending",
                ).select_related("assigned_to").first()
                assigned_to = t.assigned_to.username if t else None

            items.append(BottleneckItem(
                phase=phase,
                event_id=media.event.id,
                event_name=media.event.name,
                city_name=str(media.event.city),
                media_id=media.id,
                filename=media.original_filename,
                hours_stuck=round(hours_stuck, 1),
                threshold_hours=hours,
                assigned_to=assigned_to,
            ))

    return BottlenecksOut(bottlenecks=items, thresholds=thresholds)


@router.get("/overview", response=AdminOverviewOut)
@require_role("admin")
def overview(request, city_id: Optional[int] = None):
    from django.db.models import Count, Q
    from core.models import Event, ScriptExecutionLog

    STATUS_FIELDS = [
        "uploaded", "selected_for_edit", "pending_review",
        "approved", "published", "rejected_final",
    ]

    qs = Event.objects.select_related("city").filter(status="active")
    if city_id:
        qs = qs.filter(city_id=city_id)

    qs = qs.annotate(
        **{f"count_{s}": Count("media", filter=Q(media__status=s)) for s in STATUS_FIELDS}
    ).order_by("-event_date")

    events: List[EventOverviewItem] = []
    for event in qs:
        counts = PhaseCounts(**{s: getattr(event, f"count_{s}", 0) for s in STATUS_FIELDS})
        total_active = (
            counts.uploaded + counts.selected_for_edit +
            counts.pending_review + counts.approved
        )
        events.append(EventOverviewItem(
            id=event.id,
            name=event.name,
            city_name=str(event.city),
            event_date=event.event_date.isoformat() if event.event_date else None,
            counts=counts,
            total_active=total_active,
        ))

    # Saúde dos scripts (último log de cada um)
    threshold_min = timezone.now() - timedelta(minutes=15)
    script_health = {}
    for script in ["calendar_sync", "backup", "drive_cleanup"]:
        last = (
            ScriptExecutionLog.objects.filter(script_name=script)
            .order_by("-executed_at")
            .first()
        )
        if last:
            is_healthy = last.status == "success" and last.executed_at >= threshold_min
            script_health[script] = ScriptHealthItem(
                last_status=last.status,
                last_run=last.executed_at.isoformat(),
                is_healthy=is_healthy,
            ).dict()
        else:
            script_health[script] = ScriptHealthItem(is_healthy=False).dict()

    from core.models import Event as Ev
    pending_validation = Ev.objects.filter(status="pending_validation").count()

    return AdminOverviewOut(
        events=events,
        script_health=script_health,
        pending_validation_count=pending_validation,
    )
