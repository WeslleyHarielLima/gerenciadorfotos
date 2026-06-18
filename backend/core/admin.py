from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import City, Event, User


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
