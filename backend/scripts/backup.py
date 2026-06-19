"""
Script de backup do banco de dados.

Execução:
    cd backend
    source .venv/bin/activate
    python scripts/backup.py

Fluxo:
  1. pg_dump → bytes em memória
  2. gzip
  3. upload para _backups/ no Drive root
  4. remove backups com mais de 30 dias da pasta _backups/
  5. registra ScriptExecutionLog
"""
import gzip
import io
import logging
import os
import subprocess
import sys
import traceback
import django
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

BACKUP_RETENTION_DAYS = 30
BACKUP_FOLDER_NAME = "_backups"
DRIVE_ROOT_FOLDER_ID = os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID", "")


def _get_db_config() -> dict:
    from django.conf import settings

    db = settings.DATABASES["default"]
    return {
        "host": db.get("HOST", "localhost"),
        "port": str(db.get("PORT", "5432")),
        "name": db.get("NAME", ""),
        "user": db.get("USER", ""),
        "password": db.get("PASSWORD", ""),
    }


def _run_pg_dump(db: dict) -> bytes:
    env = os.environ.copy()
    env["PGPASSWORD"] = db["password"]
    result = subprocess.run(
        [
            "pg_dump",
            "-h", db["host"],
            "-p", db["port"],
            "-U", db["user"],
            "-d", db["name"],
            "--no-password",
            "--format=plain",
        ],
        capture_output=True,
        env=env,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump falhou: {result.stderr.decode()}")
    return result.stdout


def _gzip_bytes(data: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(data)
    return buf.getvalue()


def _get_or_create_backup_folder() -> str:
    from shared.drive import create_folder, get_subfolder_id

    existing_id = get_subfolder_id(DRIVE_ROOT_FOLDER_ID, BACKUP_FOLDER_NAME)
    if existing_id:
        return existing_id
    folder_id = create_folder(BACKUP_FOLDER_NAME, DRIVE_ROOT_FOLDER_ID)
    logger.info("Pasta _backups criada no Drive: %s", folder_id)
    return folder_id


def _delete_old_backups(folder_id: str):
    from shared.drive import get_drive_service, delete_file

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=BACKUP_RETENTION_DAYS)

    def _list_backups():
        service = get_drive_service()
        q = (
            f"'{folder_id}' in parents"
            " and name contains 'backup_'"
            " and trashed=false"
        )
        return service.files().list(
            q=q, fields="files(id,name,createdTime)", orderBy="createdTime"
        ).execute().get("files", [])

    files = _list_backups()
    deleted = 0
    for f in files:
        created_str = f.get("createdTime", "")
        if not created_str:
            continue
        created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        if created < cutoff:
            try:
                delete_file(f["id"])
                logger.info("Backup antigo removido: %s (%s)", f["name"], f["id"])
                deleted += 1
            except Exception as exc:
                logger.warning("Falha ao remover backup %s: %s", f["name"], exc)
    if deleted:
        logger.info("_delete_old_backups: %d arquivo(s) removido(s)", deleted)


def run() -> dict:
    from core.models import ScriptExecutionLog

    if not DRIVE_ROOT_FOLDER_ID:
        logger.error("GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado.")
        ScriptExecutionLog.objects.create(
            script_name="backup",
            status="failed",
            error_traceback="GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado no .env.",
        )
        return {"status": "failed"}

    try:
        db = _get_db_config()
        logger.info("Iniciando pg_dump do banco '%s'...", db["name"])
        dump_bytes = _run_pg_dump(db)
        logger.info("pg_dump concluído: %d bytes", len(dump_bytes))

        compressed = _gzip_bytes(dump_bytes)
        logger.info("Compressão gzip: %d bytes", len(compressed))

        timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"backup_{db['name']}_{timestamp}.sql.gz"

        from shared.drive import upload_file

        backup_folder_id = _get_or_create_backup_folder()
        result = upload_file(compressed, filename, backup_folder_id, "application/gzip")
        logger.info("Backup enviado para o Drive: %s (%s)", filename, result["file_id"])

        _delete_old_backups(backup_folder_id)

        ScriptExecutionLog.objects.create(
            script_name="backup",
            status="success",
            events_processed=1,
            events_failed=0,
        )
        return {"status": "success", "filename": filename, "size_bytes": len(compressed)}

    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("Falha no backup: %s", exc)
        ScriptExecutionLog.objects.create(
            script_name="backup",
            status="failed",
            error_traceback=tb,
        )
        return {"status": "failed", "error": str(exc)}


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    result = run()
    print(result)
