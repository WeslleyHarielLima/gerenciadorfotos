# Inicialização — Workflow Studio

Este documento reúne **todos os campos (variáveis de ambiente e arquivos de credenciais)** que precisam estar preenchidos para o projeto rodar, em desenvolvimento e em produção.

> Stack: Django 5 + Django Ninja + uvicorn (backend) · Next.js 14 (frontend) · PostgreSQL 16 · Google Drive/Calendar · Cloudinary · Nginx.

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ |
| Docker + Docker Compose | qualquer recente |
| PostgreSQL | 16 (via Docker) |

Credenciais externas necessárias:
- Projeto no **Google Cloud Platform** com Drive API v3 e Calendar API v3 habilitadas.
- Conta no **Cloudinary** (cloud name, API key, API secret).

---

## 2. Arquivos que precisam existir

| Arquivo | Onde | Para quê | Como obter |
|---|---|---|---|
| `.env` | raiz (`gerenciadorfotos/.env`) | Variáveis do backend e dos serviços Docker | `cp .env.example .env` e editar |
| `frontend/.env.local` | `frontend/` | URL da API para o Next.js | criar manualmente (ver §4) |
| `docs/oauth_client.json` | `docs/` | Credencial OAuth 2.0 (Desktop app) do GCP | baixar no GCP → APIs e Serviços → Credenciais |
| `docs/drive_token.json` | `docs/` | Token OAuth do Drive | `python scripts/authorize_drive.py` |
| `docs/calendar_token.json` | `docs/` | Token OAuth do Calendar | `python scripts/authorize_calendar.py` |
| `docs/<service-account>.json` | `docs/` | (Prod/Workspace) chave da service account | baixar no GCP → IAM → Service Accounts |

> ⚠️ Nenhum desses tokens/chaves deve ir para o Git. Apenas `.env.example` e `oauth_client.json` (sem segredos) são versionáveis.

---

## 3. Variáveis do backend — `.env` (raiz)

Todos os campos lidos pelo backend e pelos serviços. Os valores marcados **(obrigatório)** precisam ser preenchidos com valores reais; os demais têm default no código.

### 3.1 Banco de Dados

| Variável | Obrigatório | Default | Descrição |
|---|---|---|---|
| `DB_HOST` | — | `localhost` | Host do Postgres. No Docker o compose força `postgres`. |
| `DB_PORT` | — | `5432` | Porta interna do Postgres. Em dev local: `5433`. |
| `DB_HOST_PORT` | — | `5433` | Porta exposta no host pelo container. |
| `DB_NAME` | — | `workflow_studio` | Nome do banco. |
| `DB_USER` | — | `workflow_user` | Usuário do banco. |
| `DB_PASSWORD` | **sim** | `dev_password` | Senha do banco. Troque em produção. |
| `DB_VOLUME` | — | `workflow_postgres_data` | Nome do volume Docker do Postgres. |
| `GSM_SECRET_NAME` | — | `workflow-postgres-password` | Nome do segredo da senha do banco no Google Secret Manager. |

### 3.2 Google APIs

| Variável | Obrigatório | Descrição |
|---|---|---|
| `GCP_PROJECT_ID` | **sim** | ID do projeto no GCP (usado pelo Secret Manager). |
| `GOOGLE_CALENDAR_ID` | **sim** | ID/e-mail do Google Calendar a sincronizar. |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | **sim** | ID da pasta raiz no Google Drive onde os arquivos são organizados. |
| `GOOGLE_OAUTH_TOKEN_FILE` | **sim (dev)** | Caminho do token OAuth do Drive. Ex.: `../docs/drive_token.json`. |
| `GOOGLE_OAUTH_CALENDAR_TOKEN_FILE` | **sim (dev)** | Caminho do token OAuth do Calendar. Ex.: `../docs/calendar_token.json`. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | prod | E-mail da service account (Drive + Calendar). |
| `GOOGLE_SERVICE_ACCOUNT_SECRET` | prod | Nome do segredo (GSM) com a chave privada da service account. |
| `GOOGLE_APPLICATION_CREDENTIALS` | prod (alt.) | Caminho do JSON da service account (alternativa ao GSM). |

> **Dev com Gmail pessoal** → use OAuth2 (`GOOGLE_OAUTH_TOKEN_FILE` / `GOOGLE_OAUTH_CALENDAR_TOKEN_FILE`).
> **Prod com Google Workspace / Shared Drive** → use service account.

### 3.3 JWT / Autenticação

| Variável | Obrigatório | Default | Descrição |
|---|---|---|---|
| `JWT_SECRET_NAME` | — | `workflow-jwt-secret` | Nome do segredo do JWT no GSM (fallback: `DJANGO_SECRET_KEY`). |
| `JWT_ALGORITHM` | — | `HS256` | Algoritmo de assinatura do JWT. |
| `JWT_EXPIRE_HOURS` | — | `168` | Validade do token em horas (168 = 7 dias). |

### 3.4 Serviços / Geral

| Variável | Obrigatório | Default | Descrição |
|---|---|---|---|
| `DJANGO_PORT` | — | `8000` | Porta do backend. |
| `ENVIRONMENT` | — | `development` | `development` ativa `DEBUG`. Use `production` em produção. |
| `FRONTEND_URL` | **sim (prod)** | `http://localhost:3000` | Origem liberada no CORS. |
| `DJANGO_SECRET_KEY` | **sim** | `django-insecure-…` | Chave secreta do Django. Gere uma nova em produção. |

### 3.5 Cloudinary

| Variável | Obrigatório | Descrição |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | **sim** | Nome da cloud (painel Cloudinary). |
| `CLOUDINARY_API_KEY` | **sim** | API key. |
| `CLOUDINARY_API_SECRET` | **sim** | API secret. |

### 3.6 Thresholds de gargalo (dashboard admin)

Opcionais — têm default no código (`backend/api/routers/admin.py`). Defina no `.env` para ajustar.

| Variável | Default (h) | Descrição |
|---|---|---|
| `BOTTLENECK_UPLOADED_HOURS` | `48` | Limite para arquivos parados em "upload". |
| `BOTTLENECK_EDITING_HOURS` | `72` | Limite para arquivos em "edição". |
| `BOTTLENECK_REVIEW_HOURS` | `24` | Limite para arquivos em "revisão". |
| `BOTTLENECK_APPROVED_HOURS` | `24` | Limite para arquivos "aprovados" aguardando publicação. |

---

## 4. Variáveis do frontend — `frontend/.env.local`

| Variável | Obrigatório | Exemplo | Descrição |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **sim** | `http://localhost:8000/api` | URL base da API consumida pelo Next.js. |

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

---

## 5. Passo a passo de inicialização (desenvolvimento)

```bash
# 1. Variáveis de ambiente
cp .env.example .env          # edite com valores reais (ver §3)
echo "NEXT_PUBLIC_API_URL=http://localhost:8000/api" > frontend/.env.local

# 2. Credenciais Google (coloque oauth_client.json em docs/ primeiro)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/authorize_drive.py       # gera docs/drive_token.json
python scripts/authorize_calendar.py    # gera docs/calendar_token.json
cd ..

# 3. Banco de dados
docker compose up -d postgres

# 4. Migrações + superusuário
cd backend && source .venv/bin/activate
python manage.py migrate
python manage.py createsuperuser
cd ..

# 5. Frontend
cd frontend && npm install && cd ..

# 6. Subir tudo de uma vez
./dev.sh
```

Acesso após `./dev.sh`:
- App: http://localhost:3000
- Admin: http://localhost:8000/admin
- API docs: http://localhost:8000/api/docs

---

## 6. Checklist mínimo antes de rodar

- [ ] `.env` criado na raiz com `DB_PASSWORD`, `DJANGO_SECRET_KEY`, `GCP_PROJECT_ID`, `GOOGLE_CALENDAR_ID`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` e as 3 vars do Cloudinary preenchidas.
- [ ] `frontend/.env.local` com `NEXT_PUBLIC_API_URL`.
- [ ] `docs/oauth_client.json` presente.
- [ ] `docs/drive_token.json` e `docs/calendar_token.json` gerados.
- [ ] Postgres no ar (`docker compose ps` → healthy).
- [ ] Migrações aplicadas e superusuário criado.

> Em produção: defina `ENVIRONMENT=production`, troque `DB_PASSWORD` e `DJANGO_SECRET_KEY`, configure `FRONTEND_URL` com o domínio real e copie os tokens `docs/*.json` para o servidor. Detalhes no [README.md](../README.md).
