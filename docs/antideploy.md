# ANTIDEPLOY.md — Checklist de blindagem pré-produção

> **Propósito:** lista executável de correções a aplicar **antes** de colocar o Workflow Studio no ar.
> **Público-alvo:** agente de código (Claude Code / Codex) e dev humano.
> **Como usar:** trabalhe de cima para baixo. Cada tarefa tem `ID`, severidade, arquivos exatos, o problema, **por que importa**, a correção concreta e como validar. Marque `[x]` ao concluir.
> **Origem:** revisão de código de 23/06/2026 (backend Python — 4.313 linhas, `manage.py check --deploy`).
> **Reauditoria de 24/06/2026:** todos os itens abaixo foram reverificados contra o código real (backend agora com **4.754 linhas** — cresceu desde a 1ª revisão, então alguns números de linha citados nos itens originais sofreram pequeno drift; os valores corretos estão nos itens [T1](#t1) e seguintes da reauditoria). **Cada afirmação dos blocos 🔴/🟠/🟡 foi CONFIRMADA.** A reauditoria acrescentou 5 itens novos ([T1](#t1), [I6](#i6), [I7](#i7), [Q6](#q6), [Q7](#q7)) e um aviso de cobertura de testes.
>
> ✅ **Correções aplicadas em 24/06/2026** — ver a seção [Correções aplicadas](#correcoes-aplicadas). Resumo: **B1–B7, I1–I8, Q2, Q4, Q5, Q6, Q7 implementados** no backend/infra; **Q1 e Q3 registrados como dívida consciente** (pós-launch). `check --deploy` em ambiente de produção → **0 issues** (os 5 warnings W004/W008/W009/W012/W016 sumiram). Suíte: **53 passed, 1 xfailed**.
>
> ⚠️ **Cobertura de testes (atualizado).** O backend agora tem suíte automatizada (`backend/tests/`, pytest) cobrindo os caminhos críticos — ver [Suíte de testes](#-suíte-de-testes-criada-em-24062026). O **frontend ainda não tem testes** (T1 resolvido só no backend). O `check --deploy` continua validando só configuração; o comportamento é validado pela suíte.

## Convenções

- **Severidade:** 🔴 bloqueia/expõe produção · 🟠 bug real de dados/segurança · 🟡 qualidade/risco futuro.
- **DoD (Definition of Done) global:** `python manage.py check --deploy` sem WARNINGS de segurança e `docker compose up` sobe com banco migrado e admin acessível via HTTPS.
- Caminhos são relativos a `gerenciadorfotos/`.

## Resumo da execução — testes + inicialização (24/06/2026)

> Registro do que foi feito e verificado nesta sessão.

**Suíte de testes criada e executada:** `49 passed, 3 xfailed` (~1,6 s).
- 52 testes no backend, em `backend/tests/`. Infra hermética: `config/settings_test.py` (SQLite em memória), `pytest.ini`, `conftest.py` (mocks de Google Drive e Cloudinary; módulos de imagem rodam de verdade).
- Os 3 `xfailed` documentam dívidas conhecidas, **não** falhas da suíte: 2× IDOR ([I4](#i4)) + 1× watermark ([I8](#i8)).
- Cobertura: serviços puros (hash, EXIF jpeg/png/webp, watermark, phash); auth/JWT/refresh/`require_role`; upload e validações de mídia; fluxo ponta a ponta (upload→edição→revisão→aprovação→publicação); anti-fraude por hash; rejeição com retorno/final; abandono; isolamento entre curadores.
- Rodar: `cd backend && ./.venv/bin/pip install -r requirements-dev.txt && ./.venv/bin/pytest`.

**Inicialização verificada (conforme `docs/inicializacao.md`):**
- Postgres 16 via `docker compose up -d postgres` → **healthy**.
- `manage.py check` → 0 problemas. **13 migrações aplicadas**, 13 tabelas presentes no Postgres real.
- `manage.py check --deploy` → **5 warnings** de segurança (W004, W008, W009, W012, W016) — confirmam [B3](#b3)/[B5](#b5).

**Achados que surgiram ao escrever/rodar os testes:**
- **[I8](#i8) (novo):** `embed_watermark` é executado em todo download (re-encode full-res), mas `extract_watermark` nunca é chamado em produção → custo de CPU sem retorno. E o bit não sobrevive ao JPEG q95 (falhou até em imagem chapada).
- Fluxos de status, anti-fraude e `require_role` **funcionam como especificado** (todos passaram).
- **Frontend ainda sem testes** — T1 resolvido apenas para o backend.

---

<a id="correcoes-aplicadas"></a>
## ✅ Correções aplicadas (24/06/2026)

> Implementação das correções deste checklist. Validação: `backend && ./.venv/bin/pytest`
> → **53 passed, 1 xfailed**; `check --deploy` em ambiente de produção → **0 issues**.

### 🔴 Bloqueadores
| ID | O que mudou | Arquivos |
|----|-------------|----------|
| B1 | `entrypoint.sh` roda `migrate` + `collectstatic` no boot; `Dockerfile` usa o entrypoint como `CMD` (não mais `uvicorn` direto, nem `collectstatic` no build). | `backend/entrypoint.sh` (novo), `backend/Dockerfile` |
| B2 | `DEBUG` agora é fail-safe: `DEBUG=false` por omissão (lê env `DEBUG`, não mais `ENVIRONMENT`). `dev.sh` exporta `DEBUG=true`. | `config/settings.py:11`, `dev.sh` |
| B3 | Boot **aborta** em produção se `SECRET_KEY` for o default; `auth._get_secret()` sem fallback `"insecure"` (estoura se vazio). | `config/settings.py` (fim), `api/auth.py:13` |
| B4 | `ALLOWED_HOSTS` vem de env (`localhost,127.0.0.1` em dev), não mais `["*"]`. | `config/settings.py:13` |
| B5 | Bloco `if not DEBUG`: `SECURE_SSL_REDIRECT`, cookies `Secure`, HSTS, `SECURE_PROXY_SSL_HEADER`, `CSRF_TRUSTED_ORIGINS`. `nginx.conf` reescrito: HTTP→HTTPS 301 + bloco TLS ativo. | `config/settings.py`, `nginx/nginx.conf` |
| B6 | Service account montada em runtime (volume `:ro` → `/secrets/sa.json`) nos 5 serviços; `GOOGLE_OAUTH_TOKEN_FILE` zerado no container. | `docker-compose.yml` |
| B7 | Sem mudança de código (verificação pré-commit). Greps de segredo permanecem no gate final. | — |

### 🟠 Bugs importantes
| ID | O que mudou | Arquivos |
|----|-------------|----------|
| I1 | `download_batch`: valida **tudo** e monta o zip antes de mutar; mutação numa 2ª passada `transaction.atomic()`. | `api/routers/media.py` |
| I2 | `approve/reject_with_return/reject_final/publish/abandon` envoltos em `transaction.atomic()`; `upload_edited` idem; `delete_media` move a deleção do Cloudinary para `transaction.on_commit`. | `api/routers/tasks.py`, `media.py` |
| I3 | `imghdr` substituído por detecção via Pillow (`_detect_image_content_type`). | `api/routers/media.py` |
| I4 | `media_detail` exige vínculo (`_user_can_access_media`); `proxy_media` recebe `media_id/version` e resolve o `drive_file_id` internamente, com `@require_role(editor/curator/publisher/admin)`. URLs atualizadas em `tasks.py`. | `api/routers/media.py`, `tasks.py` |
| I5 | Teto por arquivo (`MAX_UPLOAD_BYTES`, 100 MB) no upload; lote limitado (`MAX_DOWNLOAD_BATCH`, 50) e total acumulado (`MAX_DOWNLOAD_TOTAL_BYTES`, 500 MB → 413). | `api/routers/media.py` |
| I6 | `select_for_update()` + revalidação de status sob lock em `download_batch`; claim atômico com lock nos handlers de `tasks.py`. | `media.py`, `tasks.py` |
| I7 | `next_version` calculado por `Max("version")` dentro da transação com a mídia travada (a constraint `unique_together (media,version)` já era rede de segurança). | `api/routers/media.py` |
| I8 | `embed_watermark` **removido** do `download_batch` (dead-read + custo de CPU). O serviço continua no módulo; o teste `xfail` documenta a limitação do esquema. | `api/routers/media.py` |

### 🟡 Qualidade
| ID | O que mudou | Arquivos |
|----|-------------|----------|
| Q1 | **Dívida consciente** (pós-launch): assignação ainda pega o "primeiro ativo". Premissa: hoje há 1 curador e 1 publicador. Trocar por round-robin/claim quando houver mais de um. | — |
| Q2 | `get_subfolder_id` escapa `\` e `'` antes de interpolar `name`/`parent_id` na query do Drive. | `shared/drive.py` |
| Q3 | **Dívida consciente** (pós-launch): backoff síncrono do Drive (até 31 s) segue no request. Mover uploads pesados para fila quando o volume justificar. | — |
| Q4 | `CORS_ALLOWED_ORIGINS` derivado de `FRONTEND_URL` (+ `CORS_EXTRA_ORIGINS`); localhost só em `DEBUG`. | `config/settings.py` |
| Q5 | `.env.example` com placeholders (sem project-id/e-mail/folder reais) + novas envs documentadas. | `.env.example` |
| Q6 | Cloudinary `api_key`/`api_secret` via `get_secret()` (GSM com fallback a env); só `cloud_name` fica em env. | `api/services/cloudinary_service.py` |
| Q7 | Boot aborta em prod se `DB_PASSWORD` for `dev_password`/vazio; `shared/secrets.py` loga a causa real do GSM em vez de engolir o erro. | `config/settings.py`, `shared/secrets.py` |

**Nota de contrato de API (I4):** o proxy mudou de `/api/media/proxy/{drive_file_id}` para
`/api/media/proxy/{media_id}/{version}`. O frontend consome as URLs retornadas pela API
(`*_proxy_url`), então é transparente; o helper morto `ApiClient.proxyUrl()` (não usado) pode
ser removido num passe de limpeza do frontend.

---

## Mapa rápido (ordem de execução sugerida)

| ID | Sev | Tema | Arquivo principal |
|----|-----|------|-------------------|
| [B1](#b1) | 🔴 | Migrações não rodam em prod | `docker-compose.yml`, novo `backend/entrypoint.sh` |
| [B2](#b2) | 🔴 | `DEBUG` liga sozinho | `backend/config/settings.py` |
| [B3](#b3) | 🔴 | SECRET_KEY/JWT inseguros por default | `settings.py`, `api/auth.py` |
| [B4](#b4) | 🔴 | `ALLOWED_HOSTS = ["*"]` | `settings.py` |
| [B5](#b5) | 🔴 | Flags HTTPS/cookies + nginx só HTTP | `settings.py`, `nginx/nginx.conf` |
| [B6](#b6) | 🔴 | Credenciais Google inacessíveis no container | `.env`, `docker-compose.yml`, `Dockerfile` |
| [B7](#b7) | 🔴 | Segredos no disco antes do 1º commit | `.gitignore`, `docs/` |
| [I1](#i1) | 🟠 | `download_batch` sem atomicidade | `api/routers/media.py` |
| [I2](#i2) | 🟠 | Fluxos multi-passo sem transação | `api/routers/tasks.py`, `media.py` |
| [I3](#i3) | 🟠 | `imghdr` removido no Python 3.13 | `api/routers/media.py` |
| [I4](#i4) | 🟠 | IDOR em `proxy` e `detail` | `api/routers/media.py` |
| [I5](#i5) | 🟠 | Risco de OOM em upload/zip | `api/routers/media.py`, `settings.py` |
| [Q1](#q1) | 🟡 | Assignação de fila ingênua | `media.py`, `tasks.py` |
| [Q2](#q2) | 🟡 | Query injection teórica no Drive | `shared/drive.py` |
| [Q3](#q3) | 🟡 | Backoff síncrono bloqueia worker | `shared/drive.py` |
| [Q4](#q4) | 🟡 | CORS com localhost em prod | `settings.py` |
| [Q5](#q5) | 🟡 | `.env.example` com infra real | `.env.example` |
| **Reauditoria 24/06** | | | |
| [T1](#t1) | 🟠 | Zero testes automatizados (sem rede de segurança) | projeto inteiro |
| [I6](#i6) | 🟠 | TOCTOU: estado mutado sem `select_for_update` | `tasks.py`, `media.py` |
| [I7](#i7) | 🟠 | `next_version` por `count()` → versões duplicadas | `api/routers/media.py` |
| [I8](#i8) | 🟡 | Watermark embutido mas nunca extraído (dead-read + CPU) | `api/services/watermark.py`, `media.py` |
| [Q6](#q6) | 🟡 | `CLOUDINARY_API_SECRET` fora do GSM | `api/services/cloudinary_service.py` |
| [Q7](#q7) | 🟡 | `DB_PASSWORD`/SA com fallback inseguro | `settings.py`, `shared/secrets.py` |

---

# 🔴 Bloqueadores

<a id="b1"></a>
## B1 — Migrações nunca rodam em produção

- **Arquivos:** `docker-compose.yml` (serviço `backend`), criar `backend/entrypoint.sh`, `backend/Dockerfile`.
- **Problema:** o serviço `backend` no compose só executa `uvicorn`. Nenhum passo roda `manage.py migrate`. O `dev.sh` roda em dev, mas o compose de produção **não**.
- **Por que importa:** no primeiro deploy o Postgres sobe vazio, sem tabelas. Toda request que toca o banco (login, listagem, tudo) retorna 500. O sistema não funciona um segundo.
- **Correção:**

  1. Criar `backend/entrypoint.sh`:
     ```bash
     #!/usr/bin/env sh
     set -e
     echo "[entrypoint] aplicando migrações..."
     python manage.py migrate --noinput
     echo "[entrypoint] coletando estáticos..."
     python manage.py collectstatic --noinput
     echo "[entrypoint] iniciando uvicorn..."
     exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --workers 2
     ```
  2. No `Dockerfile`, dar permissão e usar como CMD:
     ```dockerfile
     COPY entrypoint.sh /app/entrypoint.sh
     RUN chmod +x /app/entrypoint.sh
     CMD ["/app/entrypoint.sh"]
     ```
  3. **Importante:** rodar `migrate` apenas no serviço `backend`, **não** nos serviços de script (`calendar_sync`, `drive_cleanup`, etc.) — eles compartilham a imagem mas devem só esperar o banco já migrado. Se houver risco de corrida no boot, os scripts já têm `depends_on: postgres healthy`; aceitável que o primeiro ciclo falhe e o `restart` recupere após o `backend` migrar.
- **Validação:** `docker compose up` em banco limpo → `docker compose exec backend python manage.py showmigrations` mostra tudo `[X]`; login funciona.

<a id="b2"></a>
## B2 — `DEBUG` liga sozinho quando `ENVIRONMENT` não está setado

- **Arquivo:** `backend/config/settings.py:11`.
- **Problema:**
  ```python
  DEBUG = os.environ.get("ENVIRONMENT", "development") == "development"
  ```
  O default é `"development"`, então **qualquer** execução sem `ENVIRONMENT` definido liga `DEBUG=True`.
- **Por que importa:** `DEBUG=True` expõe tracebacks completos (com trechos de código e settings), desativa checagens de `ALLOWED_HOSTS` e vaza a `SECRET_KEY` em páginas de erro. É a falha de configuração mais comum em deploy.
- **Correção:** inverter para *fail-safe* (seguro por omissão):
  ```python
  DEBUG = os.environ.get("DEBUG", "false").lower() in ("1", "true", "yes")
  ```
  E em dev setar `DEBUG=true` explicitamente no `.env` local / `dev.sh`.
- **Validação:** sem `DEBUG` no ambiente → `python -c "import django; ..."` ou `manage.py shell -c "from django.conf import settings; print(settings.DEBUG)"` imprime `False`.

<a id="b3"></a>
## B3 — SECRET_KEY e segredo JWT inseguros por padrão

- **Arquivos:** `backend/config/settings.py:9`, `backend/api/auth.py:13-14`.
- **Problema:**
  - `settings.py`: `SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-change-in-production")`.
  - `auth.py`: `_get_secret()` cai em `os.environ.get("DJANGO_SECRET_KEY", "insecure")` quando o GSM não responde.
- **Por que importa:** o JWT é assinado com esse segredo (HS256). Se ele for o default conhecido, **qualquer pessoa forja um token com `"role": "admin"`** e assume o sistema inteiro — login, aprovação, deleção. `check --deploy` sinaliza `security.W009`.
- **Correção:** falhar no boot em produção se não houver chave forte. No fim de `settings.py`:
  ```python
  if not DEBUG and SECRET_KEY in ("", "django-insecure-change-in-production"):
      raise RuntimeError("DJANGO_SECRET_KEY não definida em produção.")
  ```
  Em `auth.py`, remover o fallback `"insecure"` — se `get_jwt_secret()` e `DJANGO_SECRET_KEY` vierem vazios, deixar estourar (melhor 500 explícito que segredo previsível).
  Gerar chave: `python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"`.
- **Validação:** subir sem `DJANGO_SECRET_KEY` e `DEBUG=false` → boot falha com mensagem clara.

<a id="b4"></a>
## B4 — `ALLOWED_HOSTS = ["*"]`

- **Arquivo:** `backend/config/settings.py:13`.
- **Problema:** aceita qualquer cabeçalho `Host`.
- **Por que importa:** habilita ataques de Host header poisoning (envenenamento de cache, links de reset forjados) e remove uma camada de defesa esperada em prod.
- **Correção:**
  ```python
  ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
  ```
  Definir `ALLOWED_HOSTS=seu-dominio.com.br,www.seu-dominio.com.br` no `.env` de produção.
- **Validação:** `check --deploy` não reclama; request com `Host` desconhecido → 400.

<a id="b5"></a>
## B5 — Flags de HTTPS/cookies ausentes e nginx só em HTTP

- **Arquivos:** `backend/config/settings.py` (fim), `nginx/nginx.conf:92-118`.
- **Problema:** faltam `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS`, `SECURE_PROXY_SSL_HEADER`. O `nginx.conf` serve só HTTP — bloco TLS e o `return 301 https` estão comentados.
- **Por que importa:** sem isso, cookies de sessão/CSRF trafegam em claro (sniffáveis), não há redirect forçado para HTTPS e o Django não reconhece que está atrás de proxy TLS. `check --deploy` aponta `W004/W008/W012/W016`.
- **Correção:** adicionar em `settings.py`, condicionado a prod:
  ```python
  if not DEBUG:
      SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
      SECURE_SSL_REDIRECT = True
      SESSION_COOKIE_SECURE = True
      CSRF_COOKIE_SECURE = True
      SECURE_HSTS_SECONDS = 31536000
      SECURE_HSTS_INCLUDE_SUBDOMAINS = True
      SECURE_HSTS_PRELOAD = True
      CSRF_TRUSTED_ORIGINS = [o for o in [os.environ.get("FRONTEND_URL")] if o]
  ```
  No `nginx.conf`: instalar certificado (Certbot), descomentar o bloco `server { listen 443 ssl ... }` e o `return 301 https://$host$request_uri;` do bloco :80.
- **Validação:** `check --deploy` sem warnings; `curl -I http://dominio` → 301 para https; cookies com flag `Secure`.

<a id="b6"></a>
## B6 — Credenciais do Google inacessíveis dentro do container

- **Arquivos:** `.env`, `docker-compose.yml`, `backend/shared/drive.py:15-41`, `backend/shared/calendar_client.py`.
- **Problema:** o `.env` aponta `GOOGLE_OAUTH_TOKEN_FILE=../docs/drive_token.json`, mas o container do backend tem `WORKDIR /app` e o build copia só `./backend` — a pasta `docs/` fica **fora** do contexto e não existe no container. `GOOGLE_APPLICATION_CREDENTIALS` está comentado no exemplo. Resultado: `_get_credentials()` cai no ADC (`google.auth.default`) e falha.
- **Por que importa:** sem credenciais válidas, todo upload/move/download no Drive e a sincronização do Calendar quebram — o núcleo do produto.
- **Correção (escolher 1):**
  - **Service account (recomendado p/ prod com Shared Drive):** montar a chave via volume e setar a env:
    ```yaml
    # serviço backend (e os de script) no docker-compose
    volumes:
      - ./docs/weighty-skyline-499813-b5-5927c09d2280.json:/secrets/sa.json:ro
    environment:
      GOOGLE_APPLICATION_CREDENTIALS: /secrets/sa.json
    ```
    e remover/limpar `GOOGLE_OAUTH_TOKEN_FILE` em prod.
  - **OAuth token:** montar `./docs/drive_token.json` e `calendar_token.json` em caminho absoluto dentro do container e apontar as envs para lá.
- **Por que NÃO via `COPY`:** nunca copiar segredos para dentro da imagem (ficam em camadas do registry). Sempre montar em runtime.
- **Validação:** `docker compose exec backend python -c "from shared.drive import get_drive_service; get_drive_service(); print('ok')"`.

<a id="b7"></a>
## B7 — Segredos no disco e o primeiro commit ainda não aconteceu

- **Contexto:** `git status` → `?? gerenciadorfotos/` e **0 arquivos versionados**. Nada foi commitado ainda.
- **Arquivos sensíveis presentes em `docs/`:**
  - `weighty-skyline-499813-b5-5927c09d2280.json` — **chave privada da service account GCP** (crítico).
  - `oauth_client.json` — client secret OAuth2.
  - `drive_token.json`, `calendar_token.json` — tokens de usuário.
- **Por que importa:** se qualquer um vazar no primeiro `git add .`/push, a conta Google fica comprometida. O `.gitignore` já cobre todos esses padrões, mas isso só é testável após o primeiro commit.
- **Correção / verificação obrigatória antes do 1º push:**
  ```bash
  git add -A
  git status --short | grep -iE 'token|secret|oauth|weighty|\.env$'   # deve vir VAZIO
  git ls-files | grep -iE 'token|secret|oauth|weighty|\.env$'         # deve listar só .env.example
  ```
  Se algum segredo aparecer rastreado: `git rm --cached <arquivo>` e revisar o `.gitignore`.
- **Recomendação adicional:** rotacionar a chave da service account após o go-live, já que ela circulou em disco/docs durante o desenvolvimento.
- **Validação:** os dois greps acima retornam apenas `.env.example`.

---

# 🟠 Bugs importantes

<a id="i1"></a>
## I1 — `download_batch` muta estado sem atomicidade

- **Arquivo:** `backend/api/routers/media.py:255-307` (`download_batch`).
- **Problema:** dentro do `for media_id in payload.media_ids`, cada mídia é marcada `selected_for_edit` e ganha uma `Task` **dentro do loop**. Se a mídia nº _k_ lançar `HttpError` (409 status inválido, 500 sem versão, 502 falha no Drive), as _k-1_ anteriores já foram commitadas, mas o cliente recebe erro e **nenhum zip**.
- **Por que importa:** mídias ficam presas em "em edição" com task atribuída, mas o editor nunca recebeu o arquivo. Inconsistência silenciosa que trava o pool.
- **Correção:** validar tudo antes de mutar **e** envolver o efeito colateral em transação. Padrão:
  ```python
  from django.db import transaction
  # 1ª passada: valida e coleta (sem mutar)
  prepared = []
  for media_id in payload.media_ids:
      media = get_object_or_404(Media, id=media_id)
      if media.status != "uploaded":
          raise HttpError(409, f"Mídia #{media_id} indisponível (status: {media.status}).")
      original = media.versions.filter(status="original").order_by("version").first()
      if not original:
          raise HttpError(500, f"Versão original da mídia #{media_id} não encontrada.")
      prepared.append((media, original))
  # monta o zip (download + watermark + phash) usando `prepared`
  # 2ª passada: muta tudo de uma vez
  with transaction.atomic():
      for media, original in prepared:
          media.status = "selected_for_edit"
          media.save(update_fields=["status", "last_status_change"])
          Task.objects.create(media_version=original, assigned_to=editor,
                              role_type="editor", status="in_progress", perceptual_hash=...)
  ```
- **Validação:** enviar um lote com 1 media_id inválido no meio → nenhuma mídia muda de status, nenhuma task criada, erro retornado.

<a id="i2"></a>
## I2 — Fluxos multi-passo sem transação

- **Arquivos:** `backend/api/routers/tasks.py` (`approve_task`, `reject_with_return`, `reject_final`, `publish_task`), `media.py` (`upload_edited`, `delete_media`).
- **Problema:** cada endpoint faz vários `save()`/`create()` sequenciais sem `transaction.atomic()`. Pior caso — `publish_task` (`tasks.py:601-610`): move o arquivo no Drive **e depois** salva o status; se o `save()` falhar, o arquivo já foi movido e o estado fica inconsistente.
- **Por que importa:** uma falha no meio (erro de banco, exceção do Drive) deixa version/media/task em estados divergentes, exigindo correção manual.
- **Correção:**
  - Envolver as escritas relacionadas de cada handler em `with transaction.atomic():`.
  - Em `publish_task`, ordenar para que o efeito externo irreversível (move no Drive) venha **após** o commit das mudanças de banco, ou tratar compensação se o move falhar. Mínimo: `atomic()` em volta dos saves de banco; o `move_file` fica antes, e se ele falhar nada de banco foi tocado (já é o caso) — o risco real é o save falhar depois do move; logar e expor 500 claro.
  - `delete_media` (`media.py:223-246`): hoje apaga thumbnails no Cloudinary **antes** da transação de banco; se o banco falhar, o thumbnail já sumiu. Mover a deleção do Cloudinary para depois do commit (`transaction.on_commit(...)`).
- **Validação:** simular exceção no meio (ex.: mock do `save`) e confirmar rollback.

<a id="i3"></a>
## I3 — `imghdr` foi removido no Python 3.13

- **Arquivo:** `backend/api/routers/media.py:590` (`proxy_media`).
- **Problema:** `import imghdr` — módulo depreciado em 3.11, **removido em 3.13**. Roda hoje (3.10 local / `python:3.11-slim` no Dockerfile), mas qualquer bump da imagem base quebra o endpoint de visualização.
- **Por que importa:** dívida que vira incidente silencioso num upgrade de rotina.
- **Correção:** detectar o tipo por magic bytes (já existe esse padrão em `api/services/exif.py:86-94`) ou via Pillow:
  ```python
  from PIL import Image
  try:
      kind = Image.open(io.BytesIO(data)).format  # "JPEG", "PNG", "WEBP"...
      content_type = f"image/{kind.lower()}" if kind else "application/octet-stream"
  except Exception:
      content_type = "application/octet-stream"
  ```
- **Validação:** `proxy_media` serve JPEG/PNG/WebP com `Content-Type` correto; remover `import imghdr`.

<a id="i4"></a>
## I4 — IDOR em `proxy` e `detail` (qualquer papel acessa qualquer arquivo)

- **Arquivos:** `backend/api/routers/media.py:542` (`media_detail`), `:578` (`proxy_media`).
- **Problema:** ambos exigem apenas estar autenticado (sem `@require_role`). Qualquer usuário logado pode baixar qualquer arquivo do Drive sabendo/adivinhando o `drive_file_id`, ou ver metadados de qualquer mídia por `id` sequencial.
- **Por que importa:** quebra o isolamento entre papéis/eventos. Um uploader poderia ler material de outro fluxo.
- **Correção (decidir conforme regra de negócio):**
  - Restringir por papel relevante (editor/curador/publicador/admin) com `@require_role`, ou
  - Validar que o usuário tem vínculo com a mídia/evento (ex.: é o uploader, tem task ativa nela, ou é curador/publicador do evento).
  - Para `proxy_media`, preferir receber `media_id`/`version_id` e resolver o `drive_file_id` internamente, em vez de aceitar o `drive_file_id` cru do cliente (evita enumeração de arquivos do Drive).
- **Validação:** usuário sem vínculo recebe 403 ao chamar `proxy`/`detail` de mídia alheia.

<a id="i5"></a>
## I5 — Risco de OOM em upload e download em lote

- **Arquivos:** `backend/api/routers/media.py` (`upload_media`, `upload_edited`, `download_batch`), `nginx.conf` (`client_max_body_size 500M`), Dockerfile (`--workers 2`).
- **Problema:** `f.read()` carrega o arquivo inteiro em RAM; `download_batch` monta o `.zip` inteiro em memória somando vários originais (cada um lido por inteiro do Drive). Limite de corpo é 500 MB.
- **Por que importa:** com 2 workers e poucos uploads/downloads grandes simultâneos, o processo estoura memória e o container reinicia (derruba requests em andamento).
- **Correção:**
  - Limitar quantidade de `media_ids` por lote em `download_batch` (ex.: 50) e tamanho total.
  - Validar tamanho por arquivo no upload contra um teto realista (`MAX_UPLOAD_BYTES`) bem abaixo de 500 MB, ou ajustar `client_max_body_size`.
  - Dimensionar memória do container vs. `--workers` × tamanho médio do lote.
- **Validação:** lote no limite não ultrapassa o teto de memória configurado; arquivo acima do teto → 413/400 claro.

---

# 🟡 Qualidade / risco futuro

<a id="q1"></a>
## Q1 — Assignação de fila pega sempre o "primeiro ativo"

- **Arquivos:** `media.py:510-516` (`_get_any_curator`), `tasks.py:358-361` (publicador em `approve_task`).
- **Problema:** toda edição vai para o primeiro curador ativo e toda aprovação para o primeiro publicador ativo. Já documentado como TODO.
- **Por que importa:** com mais de um curador/publicador, um recebe toda a carga; os demais ficam ociosos.
- **Correção:** distribuir (round-robin por menor fila pendente, ou pool com claim). Pode ficar pós-launch se houver só 1 curador e 1 publicador hoje — **registrar a premissa**.

<a id="q2"></a>
## Q2 — Query injection teórica na busca de subpasta do Drive

- **Arquivo:** `backend/shared/drive.py:148-161` (`get_subfolder_id`).
- **Problema:** a query é montada por f-string com `name`. Hoje só recebe nomes fixos (`"01_uploaded"`, `"_versions_temp"`), mas se um dia passar nome de evento com aspas simples, a query quebra (ou é manipulável).
- **Correção:** escapar `'` (`name.replace("'", "\\'")`) antes de interpolar.
- **Validação:** subpasta com nome contendo `'` é localizada sem erro.

<a id="q3"></a>
## Q3 — Backoff síncrono bloqueia a thread do worker

- **Arquivo:** `backend/shared/drive.py:12,49-61` (`_BACKOFF_DELAYS = [1,2,4,8,16]`).
- **Problema:** em falha do Drive, dorme até 31 s **dentro do request** de upload, segurando uma thread do pool.
- **Por que importa:** com Drive instável, poucos uploads concorrentes saturam os workers e o throughput cai.
- **Correção (pós-launch aceitável):** mover uploads pesados para fila assíncrona (já existe `PendingCloudinaryUpload`/`PendingDriveDeletion` como padrão), ou reduzir tentativas no caminho síncrono e enfileirar o resto.

<a id="q4"></a>
## Q4 — CORS com localhost em produção

- **Arquivo:** `backend/config/settings.py:90-97`.
- **Problema:** `CORS_ALLOWED_ORIGINS` fixa `localhost:3000-3004` além do `FRONTEND_URL`.
- **Correção:** em prod, derivar a lista só de `FRONTEND_URL` (e domínios reais). Manter localhost apenas quando `DEBUG`.

<a id="q5"></a>
## Q5 — `.env.example` expõe infraestrutura real

- **Arquivo:** `.env.example`.
- **Problema:** traz `GCP_PROJECT_ID`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, e-mail pessoal do Calendar e e-mail da service account reais. Não são segredos, mas vazam topologia.
- **Correção:** substituir por placeholders (`your-project-id`, `your-folder-id`, `seu-email@exemplo.com`).

---

# 🔁 Reauditoria 24/06/2026 — achados adicionais verificados

> Itens encontrados ao reverificar **todo** o backend linha a linha contra o código atual (4.754 linhas). Cada um foi confirmado lendo o trecho real.

<a id="t1"></a>
## T1 — Zero testes automatizados em todo o projeto

- **Escopo:** projeto inteiro (`backend/` e `frontend/`).
- **Problema:** não existe **nenhum** arquivo de teste. Backend: zero `test_*.py`, zero `TestCase`, zero `def test_`, sem `pytest.ini`/`conftest.py`. Frontend: sem jest/vitest/playwright/cypress no `package.json` (só os scripts `dev/build/start/lint`).
- **Por que importa:** todas as correções 🔴/🟠 deste documento mexem em fluxo de status, transações e controle de acesso — exatamente o tipo de mudança que regride em silêncio. Sem testes, a única validação é manual e não-repetível. O `check --deploy` valida **configuração**, nunca **comportamento** (não pega IDOR, não pega rollback faltando, não pega corrida).
- **Correção (mínimo viável antes do go-live):**
  - Backend: suíte `pytest` + `pytest-django` cobrindo o que é crítico e tem regra clara — anti-fraude por hash (idêntico → 400), matching EXIF, transições de status por papel ([I2](#i2)), e **negação de acesso** em `proxy_media`/`media_detail` ([I4](#i4)).
  - Pelo menos um teste de fumaça ponta a ponta: login → upload → download → upload editado → aprovação → publicação.
- **Validação:** `pytest` roda em CI com banco de teste; cobertura mínima acordada nos caminhos de [I1](#i1)–[I5](#i5).

<a id="i6"></a>
## I6 — TOCTOU: estado mutado sem `select_for_update` (corrida entre usuários)

- **Arquivos:** `api/routers/tasks.py` (`approve_task`, `reject_with_return`, `reject_final`, `publish_task`), `api/routers/media.py` (`download_batch`).
- **Problema:** o padrão é sempre `Task.objects.filter(..., status="pending").first()` seguido de `save()`, **sem `select_for_update()`** e (em `tasks.py`) **sem nenhum `transaction.atomic()`** — confirmado: `tasks.py` tem **0** ocorrências de `transaction.atomic`; `media.py` tem **1** (só em `delete_media:229`); `select_for_update` não aparece em nenhum lugar do projeto.
- **Por que importa:** entre o `.first()` e o `.save()`, outro request pode mudar a mesma task/mídia. Dois curadores abrindo a mesma revisão, ou dois editores baixando a mesma mídia em `download_batch`, podem ambos passar pela checagem `status="pending"`/`"uploaded"` e ambos mutarem — gerando tasks duplicadas e estado divergente.
- **Correção:** envolver leitura+escrita em `with transaction.atomic():` e travar a linha com `select_for_update()`, **ou** trocar o padrão por update condicional atômico:
  ```python
  updated = Task.objects.filter(id=task_id, assigned_to=curator, status="pending") \
      .update(status="completed", updated_at=timezone.now())
  if not updated:
      raise HttpError(409, "Tarefa já foi processada por outro usuário.")
  ```
- **Validação:** dois requests concorrentes na mesma task → exatamente um sucede, o outro recebe 409; nenhuma task duplicada.

<a id="i7"></a>
## I7 — `next_version` calculado por `count()` permite versões duplicadas

- **Arquivo:** `api/routers/media.py:466` — `next_version = media.versions.count() + 1`.
- **Problema:** o número da próxima versão é derivado de `count()` fora de transação/lock. Dois uploads editados quase simultâneos da mesma mídia leem `count()` igual e criam **duas** `MediaVersion` com o mesmo `version`.
- **Por que importa:** quebra a numeração de versões (`v1_edited`, `v2_edited`...) que o curador e a limpeza de versões usam; pode mascarar qual versão foi aprovada.
- **Correção:** calcular dentro da mesma `transaction.atomic()`/`select_for_update` da mídia, ou usar `Max("version")` agregado sob lock, ou uma constraint única `(media, version)` no banco para falhar explicitamente. Combina com a correção de [I6](#i6).
- **Validação:** dois uploads editados concorrentes → versões `n` e `n+1` distintas, nunca duas iguais.

<a id="q6"></a>
## Q6 — `CLOUDINARY_API_SECRET` lido direto do ambiente, fora do GSM

- **Arquivo:** `api/services/cloudinary_service.py:43-45` — `api_secret=os.environ["CLOUDINARY_API_SECRET"]`.
- **Problema:** o projeto já tem o padrão de buscar segredos no Google Secret Manager (`shared/secrets.py`, usado para JWT e senha do Postgres), mas o **secret do Cloudinary** (credencial sensível — permite deletar/alterar todos os assets) fica só em variável de ambiente.
- **Por que importa:** inconsistência com [B6](#b6)/arquitetura de segredos; envs vazam mais fácil (logs, `docker inspect`, dumps de processo) do que um segredo com TTL curto no GSM.
- **Correção:** mover `CLOUDINARY_API_SECRET` (e, idealmente, `API_KEY`) para o GSM via `get_secret(...)`, mantendo só o `cloud_name` em env. Aceitável pós-launch **se** registrado como dívida, mas o secret não deve ir para `.env` versionável.
- **Validação:** `cloudinary_service` configura a partir do GSM; nenhum secret do Cloudinary aparece em `git ls-files`/logs.

<a id="q7"></a>
## Q7 — Fallbacks inseguros de credencial de banco e segredo

- **Arquivos:** `backend/config/settings.py:67` (`DB_PASSWORD` default `"dev_password"`), `:9` (`SECRET_KEY` default conhecido — já em [B3](#b3)), `shared/secrets.py:18` (catch genérico).
- **Problema:** `"PASSWORD": os.environ.get("DB_PASSWORD", "dev_password")` cai num default previsível se a env faltar. Em `shared/secrets.py`, o `except Exception:` engole **qualquer** erro do GSM (auth inválida, project errado, timeout) e silenciosamente cai no env local — mascarando uma falha real de configuração de segredo em produção.
- **Por que importa:** soma-se a [B3](#b3): se o GSM falhar em prod, o sistema não para — ele segue com fallback fraco/previsível sem avisar.
- **Correção:** em produção (`not DEBUG`), exigir `DB_PASSWORD` não-default e falhar no boot caso contrário (mesmo padrão do [B3](#b3)); estreitar o `except` em `secrets.py` para logar o erro real do GSM em vez de silenciá-lo.
- **Validação:** boot em prod sem `DB_PASSWORD` forte → falha clara; falha de GSM aparece no log com a causa, não como "indisponível" genérico.

<a id="i8"></a>
## I8 — Watermark esteganográfico é embutido mas nunca lido (dead-read + custo de CPU)

- **Arquivos:** `api/services/watermark.py` (`embed_watermark`/`extract_watermark`), `api/routers/media.py:285-286`.
- **Problema (descoberto pela suíte de testes):** `embed_watermark` é chamado em **todo** `download_batch` — re-decodifica e re-encoda a imagem inteira para gravar o `media_id` nos pixels. Mas `extract_watermark` **não é chamado em lugar nenhum** do código de produção (só nos testes). O matching de `upload_edited` usa EXIF → nome de arquivo → hash perceptual, nunca o watermark.
- **Agravante (verificado em teste):** mesmo se fosse lido, o bit (bit 2 do canal vermelho) **não sobrevive** à recompressão JPEG q95 — falhou inclusive em imagem chapada. A robustez anunciada ("sobrevive ao JPEG") não se confirma com os inputs testados.
- **Por que importa:** custo de CPU/latência por arquivo baixado (re-encode full-res) sem nenhum benefício de identificação. Em lote grande, soma.
- **Correção (escolher):** (a) remover `embed_watermark` do `download_batch` se a identificação por EXIF+nome+phash é suficiente; ou (b) se o watermark é desejado como fallback robusto, **ligar** `extract_watermark` no `upload_edited` e trocar o esquema por um resistente a JPEG (ex.: DCT mid-band) — validado por teste de sobrevivência. Hoje é o pior dos mundos: paga o custo, não colhe o valor.
- **Validação:** teste `tests/test_services.py::test_watermark_sobrevive_jpeg` (hoje `xfail`) passa após a correção do esquema, ou o embed é removido do caminho de download.

---

# 🧪 Suíte de testes (criada em 24/06/2026)

> Resolve o item [T1](#t1) parcialmente: cobre os caminhos críticos do backend. **Não** cobre frontend ainda.

- **Localização:** `backend/tests/` · config em `backend/pytest.ini` · settings hermético em `backend/config/settings_test.py` (SQLite em memória) · fixtures e mocks em `backend/conftest.py`.
- **Como rodar:**
  ```bash
  cd backend
  ./.venv/bin/pip install -r requirements-dev.txt   # pytest + pytest-django
  ./.venv/bin/pytest
  ```
- **Resultado atual:** **49 passed, 3 xfailed** (~1,6 s). Os `xfail` documentam vulnerabilidades/dívidas conhecidas, não erros da suíte: 2× IDOR ([I4](#i4)) e 1× watermark ([I8](#i8)). Quando uma correção for aplicada, o `xfail` vira `xpass` e sinaliza para remover a marca.
- **Cobertura:** serviços puros (hash, EXIF jpeg/png/webp, watermark, phash); auth/JWT/refresh/`require_role`; upload e validações de mídia; fluxo ponta a ponta (upload → edição → revisão → aprovação → publicação); anti-fraude por hash; rejeição com retorno / final; abandono; isolamento entre curadores; IDOR.
- **Externos mockados:** Google Drive e Cloudinary (sem rede/credenciais). Os módulos de imagem rodam de verdade.

---

# 🧹 Limpeza da pasta `docs/` e do projeto

> Objetivo: enxugar o repositório antes do primeiro commit. Tudo abaixo está hoje **não versionado** (0 arquivos rastreados).

## Não versionar / nunca subir (segredos — manter só local)

Já cobertos pelo `.gitignore`, **confirmar** que ficam de fora ([B7](#b7)):

- `docs/weighty-skyline-499813-b5-5927c09d2280.json` (chave SA — crítica)
- `docs/oauth_client.json`
- `docs/drive_token.json`
- `docs/calendar_token.json`

→ **Ação:** manter no disco enquanto necessários para dev; **nunca** `git add`. Considerar movê-los para fora do repo (ex.: `~/.config/workflow-studio/`) e apontar as envs para lá, eliminando o risco na raiz.

## Seguro apagar (regenerável / lixo de build)

| Item | Tamanho | Por quê |
|------|---------|---------|
| `docs/fluxo.pdf` | ~210 KB | Binário regenerável a partir de `fluxo.md`. Não versionar PDF gerado. |
| `frontend/.next/` | ~44 MB | Build artifact do Next.js (já no `.gitignore`). Apagável a qualquer momento. |
| `frontend/tsconfig.tsbuildinfo` | ~86 KB | Cache incremental do TS. Regenerável. |
| `__pycache__/` (493 dirs) | — | Bytecode Python. `find . -name __pycache__ -type d -prune -exec rm -rf {} +`. |
| `backend/.venv/` | ~303 MB | Virtualenv; nunca versionar (já ignorado). Recriável via `requirements.txt`. |
| `/tmp/calendar_sync_dev.log` | — | Log de dev gerado pelo `dev.sh`. |

## Manter (documentação útil) — mas avaliar arquivar

- `prd.md`, `planejamento.md`, `agents.md`, `fluxo.md`, `inicializacao.md` → **manter** (fonte de verdade / onboarding de agente).
- `ANALISE_IMPACTO.md`, `CHECKLIST_IMPLEMENTACAO.md`, `MELHORIAS_FUTURAS.md` → docs históricos da reunião de 19/06/2026. **Manter**, mas se quiser enxugar, mover para `docs/historico/` para separar do que é corrente.

## Antes do primeiro commit

```bash
# 1. limpar caches
find . -name __pycache__ -type d -prune -exec rm -rf {} +
rm -f docs/fluxo.pdf frontend/tsconfig.tsbuildinfo

# 2. conferir que nenhum segredo será rastreado (deve listar só .env.example)
git add -A && git status --short | grep -iE 'token|secret|oauth|weighty|\.env$'
```

---

# Critérios de pronto para deploy (gate final)

- [x] `python manage.py check --deploy` → **0 warnings de segurança** (verificado com env de produção).
- [x] B1–B7 concluídos (B1–B6 implementados; B7 é verificação pré-commit — greps abaixo).
- [x] Suíte mínima de testes ([T1](#t1)) cobrindo anti-fraude por hash, transições de status por papel e negação de acesso ([I4](#i4)). **Falta:** plugar no CI.
- [x] I6–I7 (corridas) endereçados; Q6–Q7 (segredos) endereçados; Q1/Q3 registrados como dívida consciente.
- [x] B5/B1 no código: `nginx.conf` faz HTTP→HTTPS e bloco TLS; `entrypoint.sh` migra no boot. **Validar em runtime:** `docker compose up` em banco limpo (requer certificado TLS em `nginx/certs/`).
- [x] HTTPS/cookies `Secure`/HSTS ligados em `settings.py` (`if not DEBUG`); redirect no nginx.
- [ ] `git ls-files | grep -iE 'token|secret|oauth|weighty|\.env$'` → só `.env.example` *(rodar no 1º commit — [B7](#b7))*.
- [ ] Credenciais Google acessíveis dentro do container (teste de `get_drive_service` após `docker compose up` com a SA montada — [B6](#b6)).
- [ ] Chave da service account rotacionada pós go-live.

> **Pendências de runtime/operação (não-código):** instalar certificado TLS (Certbot) em
> `nginx/certs/{fullchain,privkey}.pem`; validar `docker compose up` em banco limpo; rodar os
> greps de segredo no 1º commit; plugar a suíte no CI; rotacionar a chave da SA. Tudo o que era
> **código/config** deste checklist está aplicado.
