from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import City, Event, Media, MediaVersion, Task, TaskHistory, User


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
    list_display = ("id", "media_version", "assigned_to", "role_type", "status", "created_at")
    list_filter = ("role_type", "status")
    search_fields = ("assigned_to__username", "media_version__media__original_filename")
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "updated_at", "deleted_at", "deleted_by")


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
