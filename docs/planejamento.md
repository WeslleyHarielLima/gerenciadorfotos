# PLANEJAMENTO.md — Workflow Studio
> Guia de execução para agente de código (Claude Code)
> Metodologia: cada fase entrega um CRUD funcional + sua tela + testes passando antes de avançar

---

## COMO O AGENTE DEVE TRABALHAR

### Regra de ouro
**Nunca avance para a próxima tarefa sem que a atual esteja 100% testada e funcionando.**

Para cada tarefa, o ciclo é sempre:
```
1. LER o contexto e os requisitos da tarefa
2. CRIAR o código (backend CRUD + frontend tela quando aplicável)
3. ESCREVER os testes
4. RODAR os testes
5. CORRIGIR até todos passarem
6. VALIDAR manualmente o comportamento na tela
7. Só então MARCAR como concluída e seguir
```

### Princípios de implementação
- Vertical slice: cada feature vai do banco até a tela antes da próxima começar
- Teste primeiro o backend (CRUD), depois conecte a tela, depois teste a integração
- Commits pequenos e frequentes, um por tarefa concluída
- Nunca deixe código comentado ou `TODO` sem resolver entre tarefas
- Se uma tarefa revelar problema numa anterior, corrija a anterior antes de continuar

### Definição de "concluído"
Uma tarefa está concluída quando:
- [ ] Backend implementado e endpoints respondendo
- [ ] Testes automatizados escritos e passando
- [ ] Tela implementada e renderizando (quando aplicável)
- [ ] Integração tela ↔ backend testada manualmente
- [ ] Sem erros no console do navegador
- [ ] Sem erros nos logs do backend
- [ ] Nenhum secret exposto em código ou log

---

## CONTEXTO DO SISTEMA (ler antes de tudo)

Workflow Studio gerencia o fluxo de edição de fotos e vídeos de um time de produção. Arquivos passam por fases: upload → edição → revisão → publicação. Cada usuário só vê a sua fase.

**Princípios invioláveis:**
1. Binários ficam no Google Drive — o Postgres só guarda metadados e hashes
2. O Drive é invisível para o usuário — tudo acontece na aplicação web
3. Versões editadas nunca sobrescrevem o original — sempre criam nova linha
4. Anti-fraude: hash da versão editada deve diferir do original
5. Soft delete: desistências marcam, nunca apagam
6. Frontend nunca acessa o banco direto — sempre via API

**Stack:**
```
Backend:        Django 5.0.4 + Django Ninja (API) + django-unfold 0.35.0
Servidor:       uvicorn (ASGI) — um só processo serve /admin e /api
Banco:          PostgreSQL 16 (Docker)
Frontend:       Next.js 14 + TypeScript + Tailwind
Storage:        Google Drive (API v3)
Eventos:        Google Calendar (API v3)
Segredos:       Google Secret Manager
Proxy:          Nginx
```

**Roles:** uploader, editor, curator, publisher, admin

**Fluxo de status:**
```
uploaded → selected_for_edit → pending_review → approved → published
                                      ↓
                          (rejeição com retorno volta para selected_for_edit)
                                      ↓
                          (rejeição total vai para rejected_final)
```

---

# FASE 0 — FUNDAÇÃO E AMBIENTE

> Objetivo: ter o ambiente rodando antes de qualquer código de negócio.
> Nenhuma tela ainda — só infraestrutura testável.

---

## TAREFA 0.1 — Repositório e estrutura

**Criar:**
```
workflow-studio/
├── backend/
│   ├── config/        # projeto Django: settings, asgi.py, urls
│   ├── core/          # models, admin (Unfold), migrations
│   ├── api/           # Django Ninja: routers, schemas, auth
│   ├── scripts/
│   └── shared/
├── frontend/
├── nginx/
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

**Testar:**
```bash
test -d backend/config && test -d backend/api && echo "OK estrutura"
git status  # repositório inicializado
cat .gitignore | grep -q ".env" && echo "OK .env ignorado"
```

**Concluído quando:** estrutura existe, git inicializado, .env no .gitignore.

---

## TAREFA 0.2 — Docker Compose com Postgres

**Criar `docker-compose.yml`** com serviço postgres (imagem postgres:16, banco workflow_studio, volume persistente, porta 5432 só localhost, healthcheck).

**Criar `.env.example`** com todas as variáveis (DB_*, GSM_*, GOOGLE_*, JWT_*).

**Testar:**
```bash
docker compose up -d
docker compose ps | grep healthy          # postgres saudável
docker compose exec postgres psql -U workflow_user -d workflow_studio -c "\dt"  # conecta
docker compose down && docker compose up -d  # persistência sobrevive ao restart
```

**Concluído quando:** todos os 4 testes acima passam.

---

## TAREFA 0.3 — Requirements e ambiente Python

**Criar** um único `requirements.txt` em `backend/` com versões fixadas: `django==5.0.4`, `django-unfold==0.35.0`, `django-ninja` (1.x), `uvicorn[standard]`, `pyjwt`, `psycopg[binary]`, `google-api-python-client`, `google-cloud-secret-manager`, `piexif`/`pillow` (EXIF), etc. Um só ambiente — admin e API rodam no mesmo processo Django.

**Testar:**
```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && echo "OK deps"
python -c "import ninja, uvicorn, django; print('OK imports')"
```

**Concluído quando:** instala sem conflito de versão e os imports funcionam.

---

# FASE 1 — CRUD DE USUÁRIOS + TELA DE LOGIN

> Objetivo: primeiro vertical slice completo. Criar usuário, autenticar, logar na tela.
> Esta fase prova que banco + Django + API Ninja + Next.js conversam.

---

## TAREFA 1.1 — Model User + Migration

**Criar** model `User` em `core/models.py` estendendo AbstractUser com campo `role` (choices: uploader/editor/curator/publisher/admin) e `created_at`.

**Configurar** `AUTH_USER_MODEL = 'core.User'` no settings.

**Testar:**
```bash
python manage.py makemigrations core
python manage.py migrate
python manage.py shell -c "
from core.models import User
u = User.objects.create_user('teste', 'teste@x.com', 'senha123', role='editor')
assert u.role == 'editor'
print('OK: usuário criado com role')
"
python manage.py check  # zero erros
```

**Concluído quando:** migration aplica, usuário é criado com role, check limpo.

---

## TAREFA 1.2 — CRUD de Usuário no Django Admin (com Unfold)

**Configurar** django-unfold no settings (antes de django.contrib.admin).

**Registrar** UserAdmin com list_display (username, email, role, is_active, created_at), list_filter (role, is_active), search_fields (username, email).

**Criar** superusuário.

**Testar:**
```bash
python manage.py createsuperuser --username admin --email admin@x.com
python manage.py runserver 8000
# Manual no navegador:
# - Acessar localhost:8000/admin → visual Unfold (não o cinza padrão)
# - Logar com superusuário
# - Criar um usuário de cada role pelo admin
# - Filtrar por role → funciona
# - Buscar por username → funciona
```

**Concluído quando:** consegue criar/editar/listar/filtrar usuários pelo admin com visual Unfold.

---

## TAREFA 1.3 — Módulo de Segredos (GSM + fallback)

**Criar** `shared/secrets.py` com `get_secret(name, fallback_env)` e `get_database_url()`.

**Testar:**
```bash
cd backend
python -c "
from shared.secrets import get_secret
import os
os.environ['TEST'] = 'valor'
assert get_secret('inexistente-gsm', 'TEST') == 'valor'
print('OK: fallback')
"
# Verificar que valor não vaza em log
python -c "
import logging; logging.basicConfig(level=logging.DEBUG)
import os; os.environ['T'] = 'SEGREDO_X'
from shared.secrets import get_secret; get_secret('x', 'T')
" 2>&1 | grep -q "SEGREDO_X" && echo "FALHOU: vazou" || echo "OK: não vazou"
```

**Concluído quando:** fallback funciona e segredo nunca aparece em log.

---

## TAREFA 1.4 — Autenticação JWT na API Ninja

**Criar** `api/auth.py`:
- `create_access_token` / `create_refresh_token` / `verify_token` (PyJWT, HS256, expiração de 168h vinda do `.env`).
- Autenticação de senha usando o **auth nativo do Django** (`django.contrib.auth.authenticate`) — sem reimplementar verificação de hash; o usuário e a senha são os mesmos do admin.
- `JWTAuth(HttpBearer)` do Django Ninja para proteger rotas e popular `request.auth` com o usuário.
- `require_role(*roles)` como dependência/decorator que retorna 403 para role incorreta.

**Criar** `api/routers/auth.py` (router Ninja) com POST /api/auth/login, POST /api/auth/refresh, GET /api/auth/me. Montar no `NinjaAPI` em `api/__init__.py`, exposto pelo `config/urls.py`.

**Testar:**
```bash
# Criar usuário de teste no Django primeiro (mesmo banco/admin)
uvicorn config.asgi:application --port 8000 &

# Login válido
curl -X POST localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"editor_teste","password":"senha123"}'
# Esperado: access_token, refresh_token, user.role

# Login inválido → 401
# /me sem token → 401
# /me com token → dados do usuário
# /refresh com refresh_token → novo access_token
# require_role: editor tentando endpoint de uploader → 403
# Swagger automático disponível em localhost:8000/api/docs
```

**Concluído quando:** todos os cenários de auth retornam o esperado, usando o auth nativo do Django.

---

## TAREFA 1.5 — Tela de Login (Next.js)

**Iniciar** Next.js 14 em `frontend/` (TypeScript, Tailwind, App Router).

**Criar:**
- `lib/types.ts` — tipos base (User, UserRole, AuthResponse)
- `lib/auth.ts` — saveAuth, loadAuth, clearAuth, decode de JWT
- `lib/api.ts` — ApiClient com login() e refresh silencioso
- `app/page.tsx` — formulário de login
- `middleware.ts` — proteção de rotas /dashboard/*

**Comportamento:** login válido salva tokens e redireciona por role. Login inválido mostra erro.

**Testar:**
```bash
npm run dev &
# Manual:
# - localhost:3000 → tela de login carrega
# - Login com credenciais válidas → redireciona para /dashboard/[role]
# - Login com senha errada → mensagem de erro, sem redirect
# - Acessar /dashboard sem token → redireciona para login
npm run type-check  # zero erros de tipo
```

**Concluído quando:** login funciona ponta a ponta (tela → API Ninja → banco → redirect).

---

### ✅ CHECKPOINT FASE 1
Antes de seguir, validar o slice completo:
```
Criar usuário no admin → logar na tela → ser redirecionado pelo role → rota protegida funciona
```
Se qualquer parte falhar, corrigir antes da Fase 2.

---

# FASE 2 — CRUD DE CIDADES E EVENTOS + TELA DE DASHBOARD ADMIN

> Objetivo: ter eventos no sistema (criados manualmente por enquanto, sync vem depois)
> e a primeira tela de dashboard mostrando dados reais.

---

## TAREFA 2.1 — Models City e Event + Migration

**Criar** models `City` (name, state, drive_folder_id, unique_together name+state) e `Event` (city FK, google_calendar_event_id, google_drive_folder_id, name, description, location, event_date, status com choices incluindo pending_validation).

**Testar:**
```bash
python manage.py makemigrations core && python manage.py migrate
python manage.py shell -c "
from core.models import City, Event
c = City.objects.create(name='Porto Velho', state='RO')
e = Event.objects.create(city=c, name='Casamento Teste', status='active')
assert e.city.name == 'Porto Velho'
print('OK: cidade e evento relacionados')
"
# Constraint: criar cidade duplicada → IntegrityError
```

**Concluído quando:** models criados, relacionamento funciona, constraint de unicidade ativa.

---

## TAREFA 2.2 — CRUD de City e Event no Admin

**Registrar** CityAdmin e EventAdmin no Unfold com list_display, filtros e busca apropriados. EventAdmin com campos do Drive/Calendar como readonly.

**Testar:**
```bash
# Manual no admin:
# - Criar cidade Porto Velho/RO
# - Criar evento vinculado à cidade
# - Filtrar eventos por status
# - Filtrar eventos por cidade
# - Buscar evento por nome
```

**Concluído quando:** CRUD completo de cidade e evento pelo admin funciona.

---

## TAREFA 2.3 — Endpoints de leitura de Cidades/Eventos (API Ninja)

**Criar** `api/routers/dashboard.py` com:
- GET /api/dashboard/cities (filtrado por role e status)
- GET /api/dashboard/cities/{city_id}/events

Por enquanto sem mídia (vem na Fase 3) — retornar eventos ativos da cidade.

**Testar:**
```bash
# Com token de cada role:
curl localhost:8000/api/dashboard/cities -H "Authorization: Bearer $TOKEN"
# Esperado: cidades com eventos ativos
curl localhost:8000/api/dashboard/cities/1/events -H "Authorization: Bearer $TOKEN"
# Esperado: eventos da cidade 1
```

**Concluído quando:** endpoints retornam cidades e eventos corretos por role.

---

## TAREFA 2.4 — Tela de Dashboard com navegação em cascata

**Criar:**
- `app/dashboard/layout.tsx` — header com usuário/role/logout + breadcrumb
- `app/dashboard/page.tsx` — lista de cidades (cards) + seção "Em andamento" (vazia por ora)
- `app/dashboard/[cityId]/page.tsx` — lista de eventos da cidade

**Testar:**
```bash
# Manual:
# - Logar → ver cidades com trabalho
# - Clicar numa cidade → ver eventos
# - Breadcrumb reflete navegação
# - Logout funciona
# - Roles diferentes veem cidades diferentes
```

**Concluído quando:** navegação dashboard → cidade → eventos funciona com dados reais.

---

### ✅ CHECKPOINT FASE 2
```
Criar cidade+evento no admin → aparecer no dashboard → navegar até o evento
```

---

# FASE 3 — CRUD DE MÍDIA + TELA DE UPLOAD (UPLOADER)

> Objetivo: o pipe de ingestão completo. Upload na tela → Drive → metadados no banco.
> Aqui entra a integração com Google Drive.

---

## TAREFA 3.1 — Configurar Google Drive (pré-requisito externo)

**Antes do código**, garantir que existe:
- Projeto GCP `weighty-skyline-499813-b5` com Drive API v3 habilitada
- Service Account **`intakegoogle@weighty-skyline-499813-b5.iam.gserviceaccount.com`** (status: Ativado), key ID em uso `5927c09d22802f3fb3ff78519f1e5bce44c40ca0`
- Pasta raiz no Drive **compartilhada com essa service account** (e-mail acima como Editor)
- `GOOGLE_DRIVE_ROOT_FOLDER_ID=1JvKmD1_QEnLTR43NiakFoDFvIPzsOB0z` no `.env`
- **Chave privada (JSON)** da service account: arquivo `docs/weighty-skyline-499813-b5-5927c09d2280.json` (gitignored). Em dev, referenciar via `GOOGLE_APPLICATION_CREDENTIALS=../docs/weighty-skyline-499813-b5-5927c09d2280.json`. Em produção, carregar do **Google Secret Manager** (nome do segredo: `workflow-intakegoogle-key`)

> ⚠️ O JSON da chave privada e o arquivo `docs/google.md` nunca vão para o repositório (ver `.gitignore`). Em dev local, o JSON fica fora do repo; em produção, só no GSM.

**Testar:**
```bash
python -c "
from shared.drive import get_drive_service
service = get_drive_service()
print('OK: conectou no Drive')
"
```

**Concluído quando:** conexão com Drive autentica sem erro.

---

## TAREFA 3.2 — Módulo Google Drive

**Criar** `shared/drive.py` com upload_file, create_folder, move_file, delete_file, generate_signed_url, get_file_bytes, create_event_folder_structure. Todas com backoff exponencial (5 tentativas: 1s,2s,4s,8s,16s) em erro 429/503.

**Testar:**
```bash
python -c "
from shared.drive import create_folder, upload_file, move_file, delete_file
fid = create_folder('teste', 'ROOT_ID')
r = upload_file(b'teste', 'a.txt', fid, 'text/plain')
assert r['file_id']
assert delete_file(r['file_id'])
assert not delete_file('inexistente')  # retorna False sem exceção
print('OK: todas as operações do Drive')
"
```

**Concluído quando:** todas as funções do Drive operam corretamente.

---

## TAREFA 3.3 — Models Media e MediaVersion + Migration

**Criar** models `Media` (event FK, drive_file_id, links, original_filename, mime_type, file_size, hash_sha256, uploaded_by FK, status, last_status_change) e `MediaVersion` (media FK, version, drive_file_id, hash_sha256, edited_by, edited_at, status, file_size, unique media+version).

**Registrar** ambos no admin (readonly nos campos de Drive/hash).

**Testar:**
```bash
python manage.py makemigrations core && python manage.py migrate
python manage.py shell -c "
from core.models import Media, MediaVersion, Event, User
# criar media + version original, verificar relacionamento
print('OK: media e version')
"
```

**Concluído quando:** models criados, relacionamento media→versions funciona.

---

## TAREFA 3.4 — Endpoint de Upload + hash

**Criar** `api/services/hash.py` (calculate_sha256) e endpoint POST /api/media/upload (role uploader): valida evento existe, valida mime_type, calcula hash, sobe pro Drive, cria Media + MediaVersion original, registra ActivityLog, descarta bytes.

**Testar:**
```bash
curl -X POST localhost:8000/api/media/upload -H "Authorization: Bearer $TOKEN_UPLOADER" \
  -F "event_id=1" -F "files=@foto.jpg"
# Esperado: success com media_id

# Verificar no banco: Media com status=uploaded, hash de 64 chars, MediaVersion original
# Verificar no Drive: arquivo na pasta 01_uploaded
# event_id inexistente → 404
# tipo inválido (PDF) → erro
# role editor → 403
# hash bate com sha256 do arquivo local
```

**Concluído quando:** upload cria registros corretos e arquivo aparece no Drive.

---

## TAREFA 3.5 — Tela de Upload (Uploader)

**Criar** `app/dashboard/uploader/[cityId]/[eventId]/page.tsx`: dropzone drag-and-drop, aceita imagem/vídeo, lista com miniatura e tamanho, botão remover, barra de progresso, upload em grupos de 10, resultado por arquivo. Verificar evento existe antes de liberar dropzone.

**Testar:**
```bash
# Manual:
# - Arrastar fotos → aparecem na lista com miniatura
# - Tipo inválido → rejeitado visualmente
# - Enviar → barra de progresso → sucesso por arquivo
# - Arquivos aparecem no Drive e no admin
# - Evento inexistente → dropzone bloqueado com mensagem
```

**Concluído quando:** upload pela tela funciona ponta a ponta.

---

### ✅ CHECKPOINT FASE 3
```
Logar como uploader → navegar até evento → upload de fotos → ver no admin e no Drive
```

---

# FASE 4 — CRUD DE TAREFAS + KANBAN DO EDITOR

> Objetivo: o coração do sistema. Editor seleciona, baixa, edita, devolve com anti-fraude.

---

## TAREFA 4.1 — Models Task, TaskHistory + Migration

**Criar** models `Task` (media_version FK, assigned_to, role_type, status, feedback, deletion_reason_type/custom, deleted_at/by, timestamps) e `TaskHistory` (media FK, version, reviewed_by, decision, feedback, created_at). Registrar no admin (TaskHistory readonly).

**Testar:**
```bash
python manage.py makemigrations core && python manage.py migrate
# Criar task via shell, verificar choices de deletion_reason_type
```

**Concluído quando:** models criados e registrados no admin.

---

## TAREFA 4.2 — Módulo EXIF

**Criar** `api/services/exif.py` com inject_media_id_exif e extract_media_id_exif (campo UserComment, formato "workflow_media_id:{id}", tolerante a falha).

**Testar:**
```bash
python -c "
from services.exif import inject_media_id_exif, extract_media_id_exif
with open('foto.jpg','rb') as f: data = f.read()
modificado = inject_media_id_exif(data, 847, 'image/jpeg')
assert extract_media_id_exif(modificado) == 847
print('OK: EXIF round-trip')
"
```

**Concluído quando:** injeta e extrai media_id do EXIF corretamente.

---

## TAREFA 4.3 — Endpoint de Download em Lote (com EXIF)

**Criar** POST /api/media/download-batch (role editor): para cada media baixa do Drive, injeta EXIF, monta ZIP, cria Task na coluna editando, muda status para selected_for_edit, registra ActivityLog.

**Testar:**
```bash
curl -X POST localhost:8000/api/media/download-batch -H "Authorization: Bearer $TOKEN_EDITOR" \
  -H "Content-Type: application/json" -d '{"media_ids":[1,2,3]}' --output z.zip
# ZIP tem 3 arquivos, cada um com EXIF media_id
# Tasks criadas, status = selected_for_edit
```

**Concluído quando:** ZIP sai com EXIF e tasks/status atualizados.

---

## TAREFA 4.4 — Endpoint de Upload Editado + Anti-Fraude

**Criar** POST /api/media/upload-edited (role editor): extrai media_id do EXIF (sem EXIF → unlinked), valida task do editor, calcula hash, compara com original (igual → fraud_attempt), valida tipo/tamanho, sobe versão pro _versions_temp, cria MediaVersion vN_edited, status pending_review, completa task editor, cria task curador.

**Testar:**
```bash
# Versão editada genuína → success, MediaVersion criada, task curador criada
# Arquivo idêntico ao original → fraud_detected + ActivityLog fraud_attempt
# Arquivo sem EXIF → unlinked
# Tamanho < 10% original → erro
```

**Concluído quando:** anti-fraude detecta idêntico e versão genuína passa.

---

## TAREFA 4.5 — Endpoint de Desistência (Soft Delete)

**Criar** POST /api/tasks/{id}/abandon (role editor): valida task do editor e in_progress, exige motivo (custom obrigatório se "outro"), soft delete, status volta para uploaded, ActivityLog abandoned.

**Testar:**
```bash
# Desistência com motivo → soft delete, status uploaded
# "outro" sem texto → 400
# task de outro editor → 403
# task já abandonada → 400
```

**Concluído quando:** desistência registra motivo e devolve arquivo ao pool.

---

## TAREFA 4.6 — Kanban do Editor (Tela)

**Criar** `app/dashboard/editor/[cityId]/[eventId]/page.tsx` com 3 colunas:
- **Disponíveis**: grid com checkbox, botão "Baixar selecionados"
- **Editando**: cards com botão "Enviar editadas" e "Desistir" (modal com dropdown de motivos, textarea só no "outro")
- **Enviadas**: somente leitura

Mais tela de **vínculo manual** quando houver arquivos sem EXIF (dois painéis, clique-clique para vincular).

**Testar:**
```bash
# Manual:
# - Selecionar com checkbox → baixar ZIP → cards vão para Editando
# - Enviar editadas → vão para Enviadas
# - Desistir → modal valida motivo → arquivo volta para Disponíveis
# - Upload sem EXIF → tela de vínculo aparece → vincular funciona
```

**Concluído quando:** ciclo completo do editor funciona na tela.

---

### ✅ CHECKPOINT FASE 4
```
Editor seleciona → baixa → "edita" → reenvia → anti-fraude valida → vai para revisão
Desistência devolve ao pool. Vínculo manual resolve arquivo sem EXIF.
```

---

# FASE 5 — KANBAN DO CURADOR

> Objetivo: revisão com comparação visual e as três decisões.

---

## TAREFA 5.1 — Models PendingDriveDeletion + Migration

**Criar** model `PendingDriveDeletion` (drive_file_id, media_version FK, attempts, last_attempt_at, error_message, status). Registrar no admin com alerta visual em attempts≥3.

**Testar:**
```bash
python manage.py makemigrations core && python manage.py migrate
```

**Concluído quando:** model criado e visível no admin.

---

## TAREFA 5.2 — Endpoints do Curador

**Criar** em `api/routers/tasks.py`:
- GET /api/tasks/review (signed URLs original+editado 15min, histórico completo)
- POST /api/tasks/{id}/approve (status approved, registra versões intermediárias em PendingDriveDeletion, cria task publisher, TaskHistory)
- POST /api/tasks/{id}/reject-with-return (feedback obrigatório, volta para selected_for_edit, reabre task editor, TaskHistory)
- POST /api/tasks/{id}/reject-final (feedback obrigatório, rejected_final, registra versões para deleção, TaskHistory)

**Testar:**
```bash
# GET retorna signed URLs que carregam (200)
# Aprovar → status approved, task publisher, deleções pendentes registradas
# Rejeitar sem feedback → 400
# Rejeitar com retorno → volta para selected_for_edit, task editor reaberta
# Histórico completo retornado
```

**Concluído quando:** as três decisões funcionam com seus efeitos no banco.

---

## TAREFA 5.3 — Job de Limpeza do Drive

**Criar** `scripts/drive_cleanup.py`: processa PendingDriveDeletion, deleta do Drive, retry com incremento de attempts, failed_max_attempts após limite, registra em ScriptExecutionLog.

**Testar:**
```bash
# Arquivo real → deletado, registro removido, MediaVersion removida
# Arquivo inexistente → attempts++, erro salvo
# Após N falhas → failed_max_attempts
```

**Concluído quando:** limpeza deleta e faz retry corretamente.

---

## TAREFA 5.4 — Kanban do Curador (Tela)

**Criar** `app/dashboard/curator/[cityId]/[eventId]/page.tsx`: lista de cards aguardando revisão, modal com original|editado lado a lado (signed URL), histórico de versões, textarea de justificativa, três botões (rejeição exige justificativa, confirmação na rejeição total).

**Testar:**
```bash
# Manual:
# - Imagens carregam no modal via signed URL
# - Histórico aparece
# - Botões de rejeição desabilitados sem justificativa
# - Aprovar → card sai → task publisher criada
# - Rejeitar com retorno → volta para editor
# - Rejeição total → confirmação → rejected_final
```

**Concluído quando:** revisão completa funciona na tela.

---

### ✅ CHECKPOINT FASE 5
```
Curador compara original vs editado → aprova/rejeita → efeitos corretos no fluxo
Versões intermediárias entram na fila de limpeza ao aprovar.
```

---

# FASE 6 — KANBAN DO PUBLICADOR

> Objetivo: fechar o fluxo. Publicar move para a pasta final.

---

## TAREFA 6.1 — Endpoints do Publicador

**Criar:**
- GET /api/tasks/publish (versão aprovada, signed URL, evento, cidade)
- POST /api/tasks/{id}/publish (move 04_approved → 05_published no Drive, status published, ActivityLog)
- GET /api/tasks/publish/history (publicados agrupados por data)

**Testar:**
```bash
# Publicar → arquivo move no Drive, status published
# Histórico agrupado por data
# task de outro publisher → 403
```

**Concluído quando:** publicação move arquivo e atualiza status.

---

## TAREFA 6.2 — Kanban do Publicador (Tela)

**Criar** `app/dashboard/publisher/[cityId]/[eventId]/page.tsx`: aba "Para publicar" (cards com botão Publicar + confirmação) e aba "Histórico" (agrupado por data com timestamp).

**Testar:**
```bash
# Manual:
# - Publicar com confirmação → card sai de "Para publicar"
# - Aparece em "Histórico" com data/hora
# - Arquivo na pasta 05_published no Drive
```

**Concluído quando:** publicação pela tela funciona ponta a ponta.

---

### ✅ CHECKPOINT FASE 6 — FLUXO COMPLETO
```
TESTE INTEGRADO PONTA A PONTA:
uploader sobe → editor baixa/edita/envia → curador aprova → publicador publica
Verificar: só original + versão aprovada sobram no banco; arquivo em 05_published.
```

---

# FASE 7 — AUTOMAÇÃO (CALENDAR SYNC + BACKUP)

> Objetivo: tirar a criação manual de eventos do caminho. Calendar vira fonte.

---

## TAREFA 7.1 — Models ScriptExecutionLog e ActivityLog + Migration

**Criar** (se ainda não criados nas fases anteriores) `ScriptExecutionLog` e `ActivityLog`. Registrar no admin como readonly com alerta visual em status=failed.

**Testar:** migration aplica, models no admin.

---

## TAREFA 7.2 — Configurar Google Calendar (pré-requisito externo)

**Garantir:** Calendar API habilitada no projeto `weighty-skyline-499813-b5`, a service account `intakegoogle@weighty-skyline-499813-b5.iam.gserviceaccount.com` com acesso de leitura ao calendário (compartilhar o calendário com esse e-mail), `GOOGLE_CALENDAR_ID=consultoria.weslleypalomeque@gmail.com` no `.env`. Reutiliza a mesma chave privada do Drive, guardada no GSM.

**Testar:**
```bash
python -c "
from scripts.calendar_sync import get_calendar_service
print('OK: conectou no Calendar')
"
```

---

## TAREFA 7.3 — Script de Sync com Calendar

**Criar** `scripts/calendar_sync.py`: busca eventos novos/modificados/cancelados, valida campos (sem local → pending_validation), normaliza cidade, cria city+pasta se nova, cria event+estrutura de pastas, registra ScriptExecutionLog, nunca falha silenciosamente.

**Testar:**
```bash
# normalize_city_name: vários casos
# Evento completo → city+event+pastas criadas
# Evento sem local → pending_validation
# Exceção geral → log com status failed e traceback
```

**Concluído quando:** sync cria eventos automaticamente e trata erros.

---

## TAREFA 7.4 — Monitoramento de Scripts no Admin

**Criar** view no admin: última execução de cada script, alerta vermelho se >15min sem sucesso, lista de pending_validation com botão reprocessar, cidades novas para confirmar.

**Testar:**
```bash
# Manual: painel mostra saúde, alerta aparece ao simular atraso
```

---

## TAREFA 7.5 — Script de Backup

**Criar** `scripts/backup.py`: pg_dump → gzip → upload para _backups no Drive, retenção 30 dias, ScriptExecutionLog.

**Testar:**
```bash
# Backup gera .sql.gz no Drive, é SQL válido, log criado
```

---

### ✅ CHECKPOINT FASE 7
```
Criar evento no Google Calendar → aguardar sync → evento e pastas aparecem automaticamente
Backup roda e sobe para o Drive.
```

---

# FASE 8 — DASHBOARD ADMIN E INDICADORES

> Objetivo: visão de gestão. Gargalos, contadores, saúde do sistema.

---

## TAREFA 8.1 — Endpoint de Gargalos

**Criar** GET /api/admin/bottlenecks (role admin): arquivos parados além do threshold por fase (thresholds do .env), agrupados por evento e usuário.

**Testar:**
```bash
# Arquivo parado além do threshold → aparece
# Dentro do threshold → não aparece
# role não-admin → 403
```

---

## TAREFA 8.2 — Tela de Dashboard Admin

**Criar** `app/dashboard/admin/page.tsx`: visão geral de eventos com contadores por fase, filtro por cidade, indicadores de gargalo com alerta visual, saúde dos scripts.

**Testar:**
```bash
# Manual: contadores corretos, filtro por cidade, gargalos destacados
```

---

## TAREFA 8.3 — Seção "Em andamento" no Dashboard

**Implementar** GET /api/dashboard/active-tasks e a seção no topo do dashboard de cada role (cards ativos do usuário, link direto para o card).

**Testar:**
```bash
# Editor com tasks in_progress → aparecem em "Em andamento"
# Link leva direto ao card certo
```

---

### ✅ CHECKPOINT FASE 8
```
Admin vê gargalos e saúde do sistema. Cada usuário vê suas tarefas em andamento ao logar.
```

---

# FASE 9 — INFRAESTRUTURA E DEPLOY

> Objetivo: sistema rodando na VPS atrás do Nginx com HTTPS.

---

## TAREFA 9.1 — Nginx como Proxy Reverso

**Criar** `nginx/nginx.conf`: /admin e /api → backend Django (uvicorn, mesmo upstream na porta 8000), / →frontend, client_max_body_size 500M, rate limiting 100/min, gzip, HTTPS.

**Testar:**
```bash
curl -o /dev/null -w "%{http_code}" localhost/admin/   # 302
curl localhost/api/health                               # 200
# Rate limit dispara após 100 req/min
# Upload grande não dá timeout
```

---

## TAREFA 9.2 — Docker Compose Completo

**Atualizar** `docker-compose.yml` com todos os serviços (postgres, backend [Django+uvicorn servindo admin+API], nginx, calendar_sync, drive_cleanup, backup) com restart unless-stopped, healthchecks, log rotation.

**Testar:**
```bash
docker compose up -d
docker compose ps  # todos healthy
docker compose stop backend && sleep 5 && docker compose ps backend  # reiniciou
```

---

## TAREFA 9.3 — README e Documentação

**Criar** README com setup local, variáveis de ambiente, restauração de backup, execução manual de scripts, troubleshooting.

**Testar:** seguir o README do zero numa máquina limpa e o sistema sobe.

---

### ✅ CHECKPOINT FINAL
```
TESTE DE ACEITAÇÃO COMPLETO NA VPS:
1. Criar evento no Calendar → sync cria estrutura
2. Uploader sobe fotos
3. Editor baixa, edita, reenvia (anti-fraude ativo)
4. Curador aprova
5. Publicador publica
6. Backup roda
7. Admin vê tudo no painel
Tudo via HTTPS, atrás do Nginx, com restart automático.
```

---

## ORDEM DE DEPENDÊNCIAS (resumo visual)

```
FASE 0 (ambiente)
  └→ FASE 1 (user + login) ────────────┐
       └→ FASE 2 (city/event + dash)    │
            └→ FASE 3 (media + upload) ──┤ precisa Drive
                 └→ FASE 4 (task + editor) ── precisa EXIF
                      └→ FASE 5 (curador)
                           └→ FASE 6 (publicador)
                                └→ FASE 7 (calendar sync) ── precisa Calendar
                                     └→ FASE 8 (admin/indicadores)
                                          └→ FASE 9 (nginx/deploy)
```

---

## REGRAS FINAIS PARA O AGENTE

1. **Uma tarefa por vez.** Não pule, não antecipe.
2. **Teste antes de avançar.** Sem teste verde, sem próxima tarefa.
3. **Cada CRUD tem sua tela testada** antes da próxima feature.
4. **Checkpoints são obrigatórios** — valide o slice inteiro antes de mudar de fase.
5. **Corrija o passado se necessário.** Bug numa fase anterior bloqueia a atual.
6. **Nunca exponha secrets.** Verifique logs a cada tarefa.
7. **Commit por tarefa concluída** com mensagem clara.
8. **Se algo estiver ambíguo, consulte o PRD** antes de assumir.

---

*Workflow Studio · PLANEJAMENTO.md para Agente de Código · v1.0 · Junho 2026*
