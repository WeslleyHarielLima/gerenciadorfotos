from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils import timezone
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import (
    ActivityLog,
    City,
    Event,
    Media,
    MediaVersion,
    PendingDriveDeletion,
    ScriptExecutionLog,
    Task,
    TaskHistory,
    User,
)


@admin.register(City)
class CityAdmin(ModelAdmin):
    list_display = ("name", "state", "drive_folder_id")
    list_filter = ("state",)
    search_fields = ("name", "state")
    ordering = ("name",)


@admin.register(Event)
class EventAdmin(ModelAdmin):
    list_display = ("name", "city", "event_date", "status", "location")
    list_filter = ("status", "city")
    search_fields = ("name", "location")
    ordering = ("-event_date",)
    readonly_fields = ("google_calendar_event_id", "google_drive_folder_id", "created_at", "updated_at")
    actions = ["reprocess_pending_validation"]

    @admin.action(description="Reprocessar eventos pendentes de validação")
    def reprocess_pending_validation(self, request, queryset):
        pending = queryset.filter(status="pending_validation")
        count = 0
        for event in pending:
            if event.city and event.location:
                event.status = "active"
                event.save(update_fields=["status"])
                count += 1
        self.message_user(request, f"{count} evento(s) reprocessado(s) para 'active'.")

    def changelist_view(self, request, extra_context=None):
        pending_count = Event.objects.filter(status="pending_validation").count()
        extra_context = extra_context or {}
        if pending_count:
            self.message_user(
                request,
                f"⚠ {pending_count} evento(s) aguardando validação (sem localização no Calendar).",
                level="warning",
            )
        return super().changelist_view(request, extra_context=extra_context)


@admin.register(Media)
class MediaAdmin(ModelAdmin):
    list_display = ("original_filename", "event", "uploaded_by", "status", "mime_type", "file_size", "created_at")
    list_filter = ("status", "mime_type", "event__city")
    search_fields = ("original_filename", "hash_sha256")
    ordering = ("-created_at",)
    readonly_fields = ("drive_file_id", "drive_folder_id", "web_view_link", "hash_sha256", "file_size", "last_status_change", "created_at")


@admin.register(MediaVersion)
class MediaVersionAdmin(ModelAdmin):
    list_display = ("media", "version", "status", "edited_by", "file_size", "edited_at")
    list_filter = ("status",)
    search_fields = ("media__original_filename", "hash_sha256")
    ordering = ("media", "version")
    readonly_fields = ("drive_file_id", "hash_sha256", "file_size", "edited_at")


@admin.register(Task)
class TaskAdmin(ModelAdmin):
    list_display = ("id", "media_version", "assigned_to", "role_type", "status", "parent_task", "iterations", "created_at")
    list_filter = ("role_type", "status")
    search_fields = ("assigned_to__username", "media_version__media__original_filename")
    ordering = ("-created_at",)
    raw_id_fields = ("parent_task",)
    readonly_fields = ("created_at", "updated_at", "deleted_at", "deleted_by")

    @admin.display(description="Iterações")
    def iterations(self, obj):
        """Profundidade da cadeia pai/filho — nº de tentativas até esta task."""
        depth = 1
        seen = {obj.pk}
        node = obj.parent_task
        while node and node.pk not in seen:
            seen.add(node.pk)
            depth += 1
            node = node.parent_task
        return depth


@admin.register(TaskHistory)
class TaskHistoryAdmin(ModelAdmin):
    list_display = ("id", "media", "media_version", "reviewed_by", "decision", "created_at")
    list_filter = ("decision",)
    search_fields = ("media__original_filename", "reviewed_by__username")
    ordering = ("-created_at",)
    readonly_fields = ("media", "media_version", "reviewed_by", "decision", "feedback", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(PendingDriveDeletion)
class PendingDriveDeletionAdmin(ModelAdmin):
    list_display = ("id", "drive_file_id", "media_version", "attempts", "status", "last_attempt_at", "created_at")
    list_filter = ("status",)
    search_fields = ("drive_file_id",)
    ordering = ("-created_at",)
    readonly_fields = ("drive_file_id", "media_version", "attempts", "last_attempt_at", "error_message", "created_at")

    def get_list_display_links(self, request, list_display):
        return ("id",)

    def changelist_view(self, request, extra_context=None):
        high_attempts = PendingDriveDeletion.objects.filter(attempts__gte=3, status="pending").count()
        extra_context = extra_context or {}
        if high_attempts:
            self.message_user(
                request,
                f"⚠ {high_attempts} item(ns) com 3+ tentativas falhas aguardando limpeza.",
                level="warning",
            )
        return super().changelist_view(request, extra_context=extra_context)


@admin.register(ScriptExecutionLog)
class ScriptExecutionLogAdmin(ModelAdmin):
    list_display = ("script_name", "status", "events_processed", "events_failed", "executed_at")
    list_filter = ("script_name", "status")
    ordering = ("-executed_at",)
    readonly_fields = ("script_name", "status", "events_processed", "events_failed", "error_traceback", "executed_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        threshold = timezone.now() - timezone.timedelta(minutes=15)
        scripts_to_check = ["calendar_sync", "backup"]
        alerts = []
        for script in scripts_to_check:
            last_ok = (
                ScriptExecutionLog.objects.filter(script_name=script, status="success")
                .order_by("-executed_at")
                .first()
            )
            if not last_ok or last_ok.executed_at < threshold:
                alerts.append(script)

        if alerts:
            self.message_user(
                request,
                f"⚠ Scripts sem sucesso nos últimos 15 min: {', '.join(alerts)}",
                level="warning",
            )

        failed_count = ScriptExecutionLog.objects.filter(status="failed").count()
        if failed_count:
            self.message_user(
                request,
                f"⛔ {failed_count} execução(ões) com status 'failed' no histórico.",
                level="error",
            )

        return super().changelist_view(request, extra_context=extra_context)


@admin.register(ActivityLog)
class ActivityLogAdmin(ModelAdmin):
    list_display = ("action", "user", "media", "created_at")
    list_filter = ("action",)
    search_fields = ("user__username", "details", "media__original_filename")
    ordering = ("-created_at",)
    readonly_fields = ("user", "action", "media", "details", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm

    list_display = ("username", "email", "role", "is_active", "created_at")
    list_filter = ("role", "is_active", "is_staff")
    search_fields = ("username", "email")
    ordering = ("-created_at",)

    fieldsets = BaseUserAdmin.fieldsets + (
        ("Perfil", {"fields": ("role",)}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ("Perfil", {"fields": ("role", "email")}),
    )
