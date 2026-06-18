import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

_django_app = get_asgi_application()

# Em desenvolvimento, serve arquivos estáticos direto pelo uvicorn
if os.environ.get("ENVIRONMENT", "development") == "development":
    from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler
    application = ASGIStaticFilesHandler(_django_app)
else:
    application = _django_app
