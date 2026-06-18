from django.contrib.auth.models import AbstractUser
from django.db import models


class City(models.Model):
    name = models.CharField(max_length=200)
    state = models.CharField(max_length=2)
    drive_folder_id = models.CharField(max_length=200, blank=True)

    class Meta:
        verbose_name = "Cidade"
        verbose_name_plural = "Cidades"
        unique_together = ("name", "state")
        ordering = ["name"]

    def __str__(self):
        return f"{self.name}/{self.state}"


class Event(models.Model):
    STATUS_CHOICES = [
        ("active", "Ativo"),
        ("completed", "Concluído"),
        ("cancelled", "Cancelado"),
        ("pending_validation", "Aguardando validação"),
    ]

    city = models.ForeignKey(City, on_delete=models.PROTECT, related_name="events")
    google_calendar_event_id = models.CharField(max_length=200, blank=True)
    google_drive_folder_id = models.CharField(max_length=200, blank=True)
    name = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    location = models.CharField(max_length=500, blank=True)
    event_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Evento"
        verbose_name_plural = "Eventos"
        ordering = ["-event_date"]

    def __str__(self):
        return f"{self.name} ({self.city})"


class User(AbstractUser):
    ROLE_CHOICES = [
        ("uploader", "Uploader"),
        ("editor", "Editor"),
        ("curator", "Curador"),
        ("publisher", "Publicador"),
        ("admin", "Admin"),
    ]

    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="uploader")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Usuário"
        verbose_name_plural = "Usuários"

    def __str__(self):
        return f"{self.username} ({self.role})"
