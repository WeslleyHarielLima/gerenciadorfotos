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
    drive_upload_folder_id = models.CharField(max_length=200, blank=True)
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


class Media(models.Model):
    STATUS_CHOICES = [
        ("uploaded", "Enviado"),
        ("selected_for_edit", "Em edição"),
        ("pending_review", "Aguardando revisão"),
        ("approved", "Aprovado"),
        ("published", "Publicado"),
        ("rejected_final", "Rejeitado"),
    ]

    event = models.ForeignKey(Event, on_delete=models.PROTECT, related_name="media")
    drive_file_id = models.CharField(max_length=200)
    drive_folder_id = models.CharField(max_length=200, blank=True)
    web_view_link = models.URLField(max_length=1000, blank=True)
    original_filename = models.CharField(max_length=500)
    mime_type = models.CharField(max_length=100)
    file_size = models.BigIntegerField()
    hash_sha256 = models.CharField(max_length=64)
    uploaded_by = models.ForeignKey(
        "User", on_delete=models.PROTECT, related_name="uploaded_media"
    )
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="uploaded")
    last_status_change = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Mídia"
        verbose_name_plural = "Mídias"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.original_filename} ({self.event})"


class MediaVersion(models.Model):
    STATUS_CHOICES = [
        ("original", "Original"),
        ("edited", "Editada"),
        ("approved", "Aprovada"),
        ("rejected", "Rejeitada"),
    ]

    media = models.ForeignKey(Media, on_delete=models.PROTECT, related_name="versions")
    version = models.PositiveIntegerField(default=1)
    drive_file_id = models.CharField(max_length=200)
    hash_sha256 = models.CharField(max_length=64)
    edited_by = models.ForeignKey(
        "User",
        on_delete=models.PROTECT,
        related_name="edited_versions",
        null=True,
        blank=True,
    )
    edited_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="original")
    file_size = models.BigIntegerField()

    class Meta:
        verbose_name = "Versão de Mídia"
        verbose_name_plural = "Versões de Mídia"
        unique_together = ("media", "version")
        ordering = ["media", "version"]

    def __str__(self):
        return f"{self.media.original_filename} v{self.version}"


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
