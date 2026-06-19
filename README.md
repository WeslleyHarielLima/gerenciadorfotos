# Workflow Studio

Sistema de gerenciamento de fluxo de edição de fotos e vídeos.  
Arquivos percorrem fases sequenciais: upload → edição → revisão → publicação.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Django 5 + Django Ninja + uvicorn (ASGI) |
| Admin | django-unfold |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Banco | PostgreSQL 16 |
| Storage | Google Drive API v3 |
| Eventos | Google Calendar API v3 |
| Proxy | Nginx |

---

## Setup local (desenvolvimento)

### Pré-requisitos

- Python 3.11+
- Node.js 18+
- Docker + Docker Compose
- Credenciais Google (ver abaixo)

### 1. Clone e configure o ambiente

```bash
git clone <repo>
cd gerenciadorfotos

# Copia o exemplo de .env
cp .env.example .env
# Edite .env com suas credenciais reais
```

### 2. Suba o Postgres

```bash
docker compose up -d postgres
```

### 3. Configure o backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python manage.py migrate
python manage.py createsuperuser
```

### 4. Configure o frontend

```bash
cd ../frontend
npm install
```

### 5. Suba tudo de uma vez

```bash
# Na raiz do projeto
./dev.sh
```

Acesse:
- App: http://localhost:3000
- Admin: http://localhost:8000/admin
- API docs: http://localhost:8000/api/docs

---

## Credenciais Google

### Google Drive

1. Crie um projeto no GCP e habilite a Drive API v3
2. Crie credenciais OAuth 2.0 (tipo Desktop app) → baixe como `docs/oauth_client.json`
3. Autorize o acesso ao Drive:

```bash
cd backend && source .venv/bin/activate
python scripts/authorize_drive.py
# Adicione ao .env:
# GOOGLE_OAUTH_TOKEN_FILE=../docs/drive_token.json
```

### Google Calendar

```bash
cd backend && source .venv/bin/activate
python scripts/authorize_calendar.py
# Adicione ao .env:
# GOOGLE_OAUTH_CALENDAR_TOKEN_FILE=../docs/calendar_token.json
```

---

## Variáveis de ambiente (.env)

| Variável | Descrição | Exemplo |
|---|---|---|
| `DB_HOST` | Host do Postgres | `localhost` |
| `DB_PORT` | Porta do Postgres | `5433` |
| `DB_NAME` | Nome do banco | `workflow_studio` |
| `DB_USER` | Usuário do banco | `workflow_user` |
| `DB_PASSWORD` | Senha do banco | — |
| `GOOGLE_CALENDAR_ID` | ID do calendário | `email@gmail.com` |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Pasta raiz no Drive | `1Jv...` |
| `GOOGLE_OAUTH_TOKEN_FILE` | Token OAuth2 do Drive | `../docs/drive_token.json` |
| `GOOGLE_OAUTH_CALENDAR_TOKEN_FILE` | Token OAuth2 do Calendar | `../docs/calendar_token.json` |
| `DJANGO_SECRET_KEY` | Chave secreta Django | — |
| `JWT_EXPIRE_HOURS` | Validade do JWT (horas) | `168` |
| `BOTTLENECK_UPLOADED_HOURS` | Threshold gargalo upload | `48` |
| `BOTTLENECK_EDITING_HOURS` | Threshold gargalo edição | `72` |
| `BOTTLENECK_REVIEW_HOURS` | Threshold gargalo revisão | `24` |
| `BOTTLENECK_APPROVED_HOURS` | Threshold gargalo aprovação | `24` |

---

## Deploy em produção (VPS)

### 1. Prepare o servidor

```bash
# Ubuntu 22.04+
apt update && apt install -y docker.io docker-compose-plugin
```

### 2. Clone e configure

```bash
git clone <repo>
cd gerenciadorfotos
cp .env.example .env
# Edite .env com senhas reais e ENVIRONMENT=production
```

### 3. Coloque os arquivos de credenciais

```bash
# Token OAuth2 do Drive e Calendar (gerados localmente, nunca commitar)
scp docs/drive_token.json usuario@vps:~/gerenciadorfotos/docs/
scp docs/calendar_token.json usuario@vps:~/gerenciadorfotos/docs/
```

### 4. (Opcional) Configure HTTPS

```bash
apt install -y certbot
certbot certonly --standalone -d seu-dominio.com.br
cp /etc/letsencrypt/live/seu-dominio.com.br/fullchain.pem nginx/certs/
cp /etc/letsencrypt/live/seu-dominio.com.br/privkey.pem nginx/certs/
# Descomente o bloco HTTPS em nginx/nginx.conf
```

### 5. Suba os serviços

```bash
docker compose up -d
docker compose ps   # todos devem ficar healthy
```

### 6. Aplique as migrações

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

---

## Scripts manuais

```bash
# Sync com Calendar (forçar agora)
docker compose exec calendar_sync python scripts/calendar_sync.py

# Limpeza do Drive (forçar agora)
docker compose exec drive_cleanup python scripts/drive_cleanup.py

# Backup agora
docker compose exec backup python scripts/backup.py

# Logs de execução
docker compose logs -f calendar_sync
docker compose logs -f backup
```

Em desenvolvimento (fora do Docker):

```bash
cd backend && source .venv/bin/activate
python scripts/calendar_sync.py
python scripts/drive_cleanup.py
python scripts/backup.py
```

---

## Restaurar backup

```bash
# 1. Baixe o .sql.gz do Drive (pasta _backups/)
# 2. Restaure:
gunzip backup_workflow_studio_YYYYMMDD_HHMMSS.sql.gz
docker compose exec -T postgres psql -U workflow_user -d workflow_studio \
  < backup_workflow_studio_YYYYMMDD_HHMMSS.sql
```

---

## Troubleshooting

### Backend não sobe
```bash
docker compose logs backend
# Erro comum: DB_HOST=localhost em vez de postgres no Docker
# Solução: docker-compose.yml já define DB_HOST=postgres para o backend
```

### Calendar sync não encontra eventos
```bash
# Verifique se o token tem escopo calendar.readonly
cat docs/calendar_token.json | grep scopes
# Se necessário, re-autorize:
python scripts/authorize_calendar.py
```

### pg_dump falha por versão incompatível
```bash
# Em dev local, o fallback para Docker é automático.
# Em produção (Docker), o pg_dump 16 está no container — não deve ocorrer.
```

### Admin sem visual Unfold (CSS não carrega)
```bash
cd backend && source .venv/bin/activate
python manage.py collectstatic --noinput
# Em produção, o Dockerfile já faz isso na build
```

### Rate limit do nginx (429 Too Many Requests)
```bash
# Aumente BOTTLENECK_* no .env ou ajuste limit_req_zone no nginx.conf
```
