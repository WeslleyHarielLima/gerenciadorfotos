#!/usr/bin/env sh
set -e

echo "[entrypoint] aplicando migrações..."
python manage.py migrate --noinput

echo "[entrypoint] coletando estáticos..."
python manage.py collectstatic --noinput

echo "[entrypoint] iniciando uvicorn..."
exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --workers 2
