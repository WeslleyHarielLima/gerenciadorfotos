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
    cloudinary_url = models.URLField(max_length=1000, blank=True)
    cloudinary_public_id = models.CharField(max_length=300, blank=True)
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
    cloudinary_url = models.URLField(max_length=1000, blank=True)
    cloudinary_public_id = models.CharField(max_length=300, blank=True)

    class Meta:
        verbose_name = "Versão de Mídia"
        verbose_name_plural = "Versões de Mídia"
        unique_together = ("media", "version")
        ordering = ["media", "version"]

    def __str__(self):
        return f"{self.media.original_filename} v{self.version}"


class Task(models.Model):
    ROLE_TYPE_CHOICES = [
        ("editor", "Editor"),
        ("curator", "Curador"),
        ("publisher", "Publicador"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pendente"),
        ("in_progress", "Em andamento"),
        ("completed", "Concluída"),
        ("abandoned", "Abandonada"),
    ]
    DELETION_REASON_CHOICES = [
        ("technical_issue", "Problema técnico"),
        ("wrong_file", "Arquivo errado"),
        ("duplicate", "Arquivo duplicado"),
        ("client_request", "Pedido do cliente"),
        ("other", "Outro"),
    ]

    media_version = models.ForeignKey(
        "MediaVersion", on_delete=models.PROTECT, related_name="tasks"
    )
    assigned_to = models.ForeignKey(
        "User", on_delete=models.PROTECT, related_name="tasks"
    )
    role_type = models.CharField(max_length=20, choices=ROLE_TYPE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    feedback = models.TextField(blank=True)
    deletion_reason_type = models.CharField(
        max_length=30, choices=DELETION_REASON_CHOICES, blank=True
    )
    deletion_reason_custom = models.TextField(blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "User",
        on_delete=models.PROTECT,
        related_name="abandoned_tasks",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Tarefa"
        verbose_name_plural = "Tarefas"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Task #{self.pk} [{self.role_type}] {self.status} — {self.media_version}"


class TaskHistory(models.Model):
    DECISION_CHOICES = [
        ("approved", "Aprovado"),
        ("rejected_with_return", "Rejeitado com retorno"),
        ("rejected_final", "Rejeitado definitivamente"),
    ]

    media = models.ForeignKey(Media, on_delete=models.PROTECT, related_name="task_history")
    media_version = models.ForeignKey(
        MediaVersion, on_delete=models.PROTECT, related_name="task_history"
    )
    reviewed_by = models.ForeignKey(
        "User", on_delete=models.PROTECT, related_name="task_reviews"
    )
    decision = models.CharField(max_length=30, choices=DECISION_CHOICES)
    feedback = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Histórico de Tarefa"
        verbose_name_plural = "Histórico de Tarefas"
        ordering = ["-created_at"]

    def __str__(self):
        return f"TaskHistory #{self.pk} [{self.decision}] — {self.media}"


class PendingDriveDeletion(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pendente"),
        ("deleted", "Deletado"),
        ("failed_max_attempts", "Falha máxima"),
    ]

    drive_file_id = models.CharField(max_length=200)
    media_version = models.ForeignKey(
        "MediaVersion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pending_deletions",
    )
    attempts = models.PositiveIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Deleção Pendente"
        verbose_name_plural = "Deleções Pendentes"
        ordering = ["-created_at"]

    def __str__(self):
        return f"PendingDeletion #{self.pk} [{self.status}] {self.drive_file_id}"


class ScriptExecutionLog(models.Model):
    STATUS_CHOICES = [
        ("success", "Sucesso"),
        ("partial", "Parcial"),
        ("failed", "Falha"),
    ]

    script_name = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    events_processed = models.PositiveIntegerField(default=0)
    events_failed = models.PositiveIntegerField(default=0)
    error_traceback = models.TextField(blank=True)
    executed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Log de Script"
        verbose_name_plural = "Logs de Script"
        ordering = ["-executed_at"]

    def __str__(self):
        return f"{self.script_name} [{self.status}] {self.executed_at:%Y-%m-%d %H:%M}"


class ActivityLog(models.Model):
    ACTION_CHOICES = [
        ("uploaded", "Upload"),
        ("selected", "Selecionado"),
        ("submitted", "Enviado para revisão"),
        ("approved", "Aprovado"),
        ("rejected", "Rejeitado"),
        ("published", "Publicado"),
        ("abandoned", "Desistência"),
        ("fraud_attempt", "Tentativa de fraude"),
        ("calendar_sync_created", "Sync: evento criado"),
        ("calendar_sync_updated", "Sync: evento atualizado"),
        ("calendar_sync_cancelled", "Sync: evento cancelado"),
    ]

    user = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)
    media = models.ForeignKey(
        "Media",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    details = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Log de Atividade"
        verbose_name_plural = "Logs de Atividade"
        ordering = ["-created_at"]

    def __str__(self):
        user_str = self.user.username if self.user else "sistema"
        return f"{self.action} por {user_str} em {self.created_at:%Y-%m-%d %H:%M}"


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
