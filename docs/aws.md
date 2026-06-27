# Workflow Studio — Auditoria Técnica e Plano de Migração para AWS

> Documento de engenharia consolidado.
> **Objetivo:** primeiro deixar o projeto *redondo* (corrigir os problemas reais de código),
> depois migrar para a AWS levando uma base sólida — não bugs.
>
> Estratégia definida: **rodar numa VM (EC2)** + serviços gerenciados ao redor.
> A nuvem resolve **resiliência e operação**; **performance e escala** continuam sendo trabalho de código.

---

## Sumário

1. [Visão geral da plataforma](#1-visão-geral-da-plataforma)
2. [Pontos fortes](#2-pontos-fortes-o-que-já-está-bem-feito)
3. [Problemas identificados (auditoria de código)](#3-problemas-identificados-auditoria-de-código)
   - [Crítico](#-crítico--quebra-em-uso-normal-ou-corrompe-dados)
   - [Alto](#-alto--falha-em-cenários-comuns-performance-ou-segurança)
   - [Médio](#-médio--robustez-idempotência-custo)
   - [Baixo](#-baixo--limpeza-e-bordas)
   - [Verificado e correto](#-verificado-e-está-correto)
4. [Fase 0 — Deixar o projeto redondo (antes da AWS)](#4-fase-0--deixar-o-projeto-redondo-antes-da-aws)
5. [Arquitetura alvo na AWS](#5-arquitetura-alvo-na-aws-uma-vm--serviços-gerenciados)
6. [Roadmap de migração por fases](#6-roadmap-de-migração-por-fases)
7. [Mapa: problema → solução AWS](#7-mapa-problema--solução-aws)
8. [Considerações de custo](#8-considerações-de-custo)
9. [Definição de pronto](#9-definição-de-pronto)

**Legenda de severidade:** 🔴 Crítico · 🟠 Alto · 🟡 Médio · ⚪ Baixo

---

## 1. Visão geral da plataforma

Sistema de gerenciamento de fluxo de edição de fotos/vídeos. Os arquivos percorrem fases
sequenciais: **upload → edição → revisão → publicação**, com papéis distintos (uploader,
editor, curador, publicador, admin).

| Camada | Tecnologia |
|---|---|
| Backend | Django 5 + Django Ninja + uvicorn (ASGI) |
| Admin | django-unfold |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Banco | PostgreSQL 16 |
| Storage | Google Drive API v3 |
| Eventos | Google Calendar API v3 |
| Thumbnails | Cloudinary |
| Proxy/TLS | Nginx + Certbot |
| Orquestração | Docker Compose (1 VPS) |

**Jobs de fundo** (hoje como containers em loop `while-sleep`): `calendar_sync` (60s),
`drive_cleanup` (30min), `cloudinary_retry` (10min), `backup` (24h).

---

## 2. Pontos fortes (o que já está bem feito)

Este projeto tem higiene de engenharia acima da média para uma ferramenta interna. Vale
preservar tudo isto na migração:

- **Hardening de produção que falha-seguro.** `settings.py` *aborta o boot* se a `SECRET_KEY`
  for a default ou a senha do banco for `dev_password`; `DEBUG` desligado por omissão;
  HSTS, cookies seguros e CORS travado em `FRONTEND_URL` quando `DEBUG=False`.
- **Segredos fora da imagem.** A service account é montada em runtime (read-only), nunca
  copiada para camadas do Docker. `.gitignore` cobre tokens, `.env`, `*.pem`, chave da SA.
- **Concorrência correta.** Claim atômico com `select_for_update` + filtro de status em
  approve/reject/publish; `download_batch` em duas passadas (valida → trava → muta);
  numeração de versão com `Max()` sob lock; `transaction.on_commit` para efeitos externos.
- **Resiliência de integração.** Backoff exponencial em 429/503 no Drive/Calendar; filas de
  retry (`PendingDriveDeletion`, `PendingCloudinaryUpload`).
- **Trilha de auditoria.** `ActivityLog`, `TaskHistory`, `ScriptExecutionLog`, cadeia
  `parent_task` para rastrear rejeição → reedição.
- **Anti-fraude.** Comparação de hash, identificação por EXIF + hash perceptual de fallback.
- **Testes existem** (~53, cobrindo auth, segurança, fluxo, mídia, serviços) e as migrations
  batem 100% com os models.

---

## 3. Problemas identificados (auditoria de código)

> Varredura completa: 4 auditorias paralelas (API, scripts/integrações, frontend,
> modelo/migrations/testes) + verificação manual das críticas.
> Todos os itens abaixo foram **confirmados no código**, salvo os marcados como decisão de produto.

### 🔴 Crítico — quebra em uso normal ou corrompe dados

#### C1 — `delete_media` dá 500 e a mídia fica impossível de apagar após um abandono
**Arquivo:** [`backend/api/routers/media.py:272-273`](../backend/api/routers/media.py#L272)

Fluxo real: o editor puxa a foto (cria `Task` apontando para a `MediaVersion` original) →
abandona (`abandon_task` devolve a mídia para `status="uploaded"`, mas a `Task` abandonada
**continua** referenciando a versão). O uploader então tenta apagar: o guard `status == "uploaded"`
passa, o código faz `media.versions.all().delete()` — e a versão está protegida por
`on_delete=PROTECT` da `Task` abandonada ([`models.py:141`](../backend/core/models.py#L141)) →
`ProtectedError` → 500. A mídia nunca mais pode ser removida.

**Correção:** apagar/`SET_NULL` as `Task`/`TaskHistory` relacionadas antes das versões, ou
bloquear a deleção com mensagem clara se existir qualquer task vinculada.

#### C2 — `reject_with_return` deixa a mídia órfã no fluxo
**Arquivo:** [`backend/api/routers/tasks.py:423-439`](../backend/api/routers/tasks.py#L423)

Se não houver uma task de editor `completed` anterior (ex.: o editor abandonou em vez de
concluir), a mídia vai para `selected_for_edit` mas **nenhuma task de editor é reaberta**.
Ela some de todos os boards e o endpoint mesmo assim retorna `200 "devolvida ao editor"`.
Item travado para sempre, silenciosamente.

**Correção:** se não achar editor anterior, devolver ao pool (`status="uploaded"`) ou erro
explícito — nunca 200 silencioso.

#### C3 — `upload_edited` faz 500 e deixa arquivo órfão no Drive quando não há curador ativo
**Arquivo:** [`backend/api/routers/media.py:529`](../backend/api/routers/media.py#L529) ·
[`:564`](../backend/api/routers/media.py#L564) ·
[`_get_any_curator:586`](../backend/api/routers/media.py#L586)

O upload ao Drive acontece *antes* da transação. Dentro do `atomic`, `_get_any_curator()`
levanta `HttpError(500)` se não houver curador → o banco faz rollback, mas o arquivo já subido
fica perdido em `_versions_temp`. Pior: a exceção aborta o loop inteiro — num upload de vários
arquivos, **um curador ausente derruba o lote todo** em vez de gerar erro por-arquivo.

**Correção:** resolver o curador antes do upload/loop; devolver erro por-arquivo; limpar o
temp no Drive em falha.

#### C4 — Sync de calendário pode criar eventos duplicados
**Arquivo:** [`backend/core/models.py:29`](../backend/core/models.py#L29) +
[`backend/scripts/calendar_sync.py`](../backend/scripts/calendar_sync.py)

`Event.google_calendar_event_id` não tem unique constraint, e o script faz
`filter(...).first()` → `create(...)`. Duas execuções sobrepostas (ou retry após falha parcial)
para o mesmo `cal_id` criam **dois Events** para a mesma entrada, fragmentando mídias/tasks.

**Correção:** `UniqueConstraint` parcial (excluindo `""`) + trocar para `update_or_create`.

### 🟠 Alto — falha em cenários comuns, performance ou segurança

#### A1 — Sync de calendário perde eventos por usar cursor errado
**Arquivo:** [`backend/scripts/calendar_sync.py:238`](../backend/scripts/calendar_sync.py#L238)

Usa o `executed_at` da última execução como `timeMin`, que filtra pela **data de início** do
evento (`orderBy=startTime`), não por "modificado desde". Um evento cadastrado hoje com data
passada (ou edição de evento antigo) cai *antes* do cursor e nunca é sincronizado. Agrava com
o fato de que uma run onde todas as pastas do Drive falharam ainda grava `success` e **avança
o cursor** por cima desses eventos.

**Correção:** usar `nextSyncToken` (o `list_events` já o retorna) ou janela fixa de lookback
com upsert idempotente.

#### A2 — Ausência total de índices nas colunas mais consultadas
**Arquivo:** [`Task.Meta:178`](../backend/core/models.py#L178) ·
[`Media.Meta:76`](../backend/core/models.py#L76)

Todo board/fila filtra `Task(assigned_to, role_type, status)` e `Media(status, event)`, mas
não há `indexes`. O Django só indexa a FK isolada. Cada carga de tela e cada poll de badge faz
varredura completa; cresce linearmente e vira gargalo de banco.

**Correção:** índices compostos:
```python
# Task.Meta
indexes = [
    models.Index(fields=["assigned_to", "role_type", "status"]),
    models.Index(fields=["status"]),
]
# Media.Meta
indexes = [
    models.Index(fields=["event", "status"]),
    models.Index(fields=["status", "last_status_change"]),
]
```

#### A3 — Autorização ampla demais: enumeração de mídias/eventos por ID *(decisão de produto)*
**Arquivo:** [`_user_can_access_media:618-631`](../backend/api/routers/media.py#L618) ·
[`event_media_list:206`](../backend/api/routers/media.py#L206)

`media_detail` e o `proxy` liberam **qualquer** curador/publicador a ler metadados e bytes de
**qualquer** mídia por ID; `event_media_list` deixa um uploader ver as mídias de qualquer
evento. A API é a fronteira real (tudo exige JWT), mas o escopo é "qualquer papel vê tudo".
Se a operação é multi-cidade/multi-equipe, é vazamento entre equipes.

**Correção:** escopar por vínculo (cidade/evento/atribuição). **Antes, confirmar a intenção
do produto.**

#### A4 — Proteção de rota no front é decorativa + logout quebrado
**Arquivo:** [`middleware.ts:5`](../frontend/src/middleware.ts#L5) ·
[`dashboard/layout.tsx`](../frontend/src/app/dashboard/layout.tsx) ·
[`api.ts:34-41`](../frontend/src/lib/api.ts#L34)

O middleware deixa tudo passar; a "proteção" lê o objeto `user` do `localStorage` (forjável).
E quando o refresh falha, **não há logout nem redirect** — o usuário fica num dashboard
renderizado com todos os painéis em erro, sem saída. (O dado em si está protegido pelo backend;
o problema é UX e gating de UI falso.)

**Correção:** tratar ausência/expiração do *token* como deslogado; no refresh falho,
`clearAuth()` + redirect para `/`.

#### A5 — Refresh stampede: 401s concorrentes disparam N refreshes simultâneos
**Arquivo:** [`api.ts:6-42`](../frontend/src/lib/api.ts#L6)

Várias telas fazem `Promise.all([...])`. Com o access token expirado, cada request bate 401 e
chama `refreshSilently()` em paralelo, corrida no mesmo refresh token. Se o backend rotacionar
refresh tokens, o primeiro vence e os outros são invalidados → logout espúrio.

**Correção:** memoizar uma única promessa de refresh in-flight (módulo-level); todos os 401s
aguardam a mesma.

#### A6 — Código crítico de concorrência não tem teste (e o test DB não consegue testá-lo)
**Arquivo:** [`backend/tests/test_flow.py`](../backend/tests/test_flow.py) +
[`config/settings_test.py`](../backend/config/settings_test.py)

Toda a lógica de claim atômico (`select_for_update`) não tem nenhum teste de dois atores
concorrentes. E o teste roda em SQLite `:memory:`, onde `select_for_update` é **no-op** —
mesmo que escrevessem o teste, daria falso-positivo. A parte mais sensível do sistema é
não-verificável hoje.

**Correção:** testes de concorrência contra Postgres (`TransactionTestCase` + threads): dois
curadores aprovando a mesma task, dois editores no mesmo `download_batch`, numeração de versão
concorrente. *(Naturalmente resolvido quando o banco de teste virar Postgres — ver Fase 1.)*

### 🟡 Médio — robustez, idempotência, custo

| ID | Problema | Local |
|---|---|---|
| M1 | Scripts **sem lock** — runs sobrepostas duplicam processamento e contam `attempts` em dobro (trip prematuro de `MAX_ATTEMPTS`) | `cloudinary_retry` / `drive_cleanup` |
| M2 | Backoff **dorme após a última tentativa** (16s mortos) e **retenta erros não-HTTP** (status `None`) 5× antes de propagar bug determinístico | [`drive.py:49-61`](../backend/shared/drive.py#L49) |
| M3 | Backup: `FileNotFoundError` (sem `pg_dump`) **pula o fallback Docker**; detecção de mismatch por substring em inglês quebra com locale pt-BR; falha na retenção marca backup OK como `failed` | [`backup.py:97-103`](../backend/scripts/backup.py#L97) |
| M4 | `attempts` incrementa em falha **transitória** (outage externo) → itens vão para `failed_max_attempts` sem recuperação automática | `cloudinary_retry` / `drive_cleanup` |
| M5 | `ENVIRONMENT` default `"development"` → se não setado em prod, uvicorn serve estáticos (mitigado pelo compose, mas fail-open) | [`asgi.py:10`](../backend/config/asgi.py#L10) |
| M6 | `_ensure_upload_folder` não é atômico → uploads concorrentes em evento novo criam **estrutura de pastas duplicada** no Drive | [`media.py:74-100`](../backend/api/routers/media.py#L74) |
| M7 | `parent_task` usa `SET_NULL` → deleção de qualquer ancestral **quebra a cadeia** de iterações silenciosamente | [`models.py:161`](../backend/core/models.py#L161) |
| M8 | Cadeia `PROTECT` torna mídia `rejected_final` **indeletável**; rows acumulam sem limite; apagar City/Event é impossível | [`models.py:59,93,141,194`](../backend/core/models.py#L59) |
| M9 | `fraud_attempt` **nunca** vira `ActivityLog` — sobrescreve `task.feedback` (apagando feedback do curador), sem trilha auditável | [`media.py:502`](../backend/api/routers/media.py#L502) |
| M10 | Sem dedup de upload: mesmo arquivo (mesmo `sha256`) cria N Media + N uploads ao Drive | [`media.py:131-152`](../backend/api/routers/media.py#L131) |
| M11 | N+1 nas filas de curador/publicador (`media.versions.filter` + `edited_by.username` por item) | [`tasks.py:250,560`](../backend/api/routers/tasks.py#L250) |
| M12 | Editor escolhe "enviar para *esta* task" na UI, mas o backend ignora a task e identifica só por EXIF→nome→hash → pode anexar na mídia errada com falsa confiança | [`media.py:399`](../backend/api/routers/media.py#L399) |
| M13 | `PhotoDrawer` manda `Bearer null`, **não usa refresh**, e faz `.json()` sem checar `res.ok` → drawer em branco em vez de recarregar | [`PhotoDrawer.tsx:66`](../frontend/src/components/PhotoDrawer.tsx#L66) |
| M14 | Object URLs de preview **não são revogados** ao desmontar o uploader → vazamento de memória ao soltar centenas de fotos e sair | [`uploader page:67`](../frontend/src/app/dashboard/uploader/[cityId]/[eventId]/page.tsx#L67) |
| M15 | Tema persistido (`light`) é ignorado no login e pisca (FOUC) ao entrar no dashboard (`<html data-theme="dark">` fixo) | [`layout.tsx:28`](../frontend/src/app/layout.tsx#L28) |

### ⚪ Baixo — limpeza e bordas

- **B1** — Download em lote revoga o object URL imediatamente após `a.click()` (sem anexar ao DOM) → `edicao.zip` pode vir vazio em alguns navegadores; o projeto já tem o padrão certo em [`download.ts:11`](../frontend/src/lib/download.ts#L11).
- **B2** — Lista de arquivos do uploader usa `key={idx}` e remove por índice → preview pode mostrar arquivo errado após remoção.
- **B3** — Código morto: `proxyUrl()`/`getReviewSummary()` em [`api.ts`](../frontend/src/lib/api.ts#L278), `watermark.py` (não usado), construção de proxy URL reimplementada inline no curador.
- **B4** — `get_secret` retorna `""` em vez de levantar quando vazio → JWT/Cloudinary podem rodar com credencial em branco ([`secrets.py:31`](../backend/shared/secrets.py#L31)).
- **B5** — Tokens OAuth gravados com permissão default (0644) em `docs/` ([`authorize_drive.py:50`](../backend/scripts/authorize_drive.py#L50)) — aplicar `chmod 0600` (já estão no `.gitignore`).
- **B6** — `xfail(strict=False)` no teste de watermark nunca avisa se passar ([`test_services.py:66`](../backend/tests/test_services.py#L66)).

### ✅ Verificado e está CORRETO

Para construir confiança na lista, estes pontos foram checados e **não são bugs**:

- Claim atômico em approve/reject/publish com `select_for_update` + filtro de status → correto.
- Numeração de versão com `Max()` sob lock → correto (mas só em Postgres; ver A6).
- `transaction.on_commit` para limpar Cloudinary só após commit → ordem correta.
- `HttpError` dentro de `atomic` → faz rollback corretamente.
- Migrations batem 100% com os models (`makemigrations --check` limpo).
- Escape da query do Drive, hardening do settings, testes de IDOR e isolamento entre curadores.
- **Falsos-positivos descartados:** `cloudinary_backfill.exclude("original")` (correto),
  threshold do hash perceptual (correto), slices do EXIF sem length-check (seguros).

---

## 4. Fase 0 — Deixar o projeto redondo (antes da AWS)

> Princípio: **não levar bug para a nuvem.** Cada correção abaixo é independente e testável.

**Ordem recomendada:**

1. [ ] **C1, C2, C3** — bugs de fluxo que travam/perdem trabalho em uso normal *(rápidos, alto impacto)*
2. [ ] **C4 + A1** — corrigir o sync de calendário (unique + `update_or_create` + cursor por `syncToken`)
3. [ ] **A2** — adicionar os índices (uma migration, ganho enorme e barato)
4. [ ] **A4, A5** — auth do front (logout no refresh falho + dedup de refresh in-flight)
5. [ ] **A3** — decidir e fechar o escopo de autorização (precisa de definição de produto)
6. [ ] **A6** — testes de concorrência em Postgres (valida tudo que o resto assume)
7. [ ] **M1–M15** conforme fôlego
8. [ ] **B1–B6** na limpeza final

Ao concluir a Fase 0, o sistema está consistente sob uso normal e concorrência, e a migração
vira **só infraestrutura**.

---

## 5. Arquitetura alvo na AWS (uma VM + serviços gerenciados)

> ⚠️ **Verdade incômoda:** uma EC2 sozinha é apenas um VPS mais caro. Se você só jogar o
> `docker compose` numa instância, ganha exatamente o que tem hoje. **O valor está nos
> serviços gerenciados ao redor da VM** — é neles que você terceiriza as partes frágeis.

```
                       ┌─────────────────────────────────┐
   Internet  ─────►    │  EC2 (t3.medium / t3.large)     │
   (Elastic IP)        │  ┌───────────────────────────┐  │
        │              │  │ docker compose:           │  │
   Security Group      │  │   nginx + certbot (TLS)   │  │
   (80 / 443 / 22)     │  │   frontend (Next.js)      │  │
        │              │  │   backend  (uvicorn)      │  │
                       │  │   worker   (Celery, fase 2)│  │
                       │  │   redis    (fila, fase 2) │  │
                       │  └───────────────────────────┘  │
                       │  CloudWatch Agent               │
                       │  IAM Role (sem chaves no disco) │
                       └──────────────┬──────────────────┘
                                      │
        ┌─────────────────┬──────────┼───────────────┬──────────────────┐
        ▼                 ▼          ▼               ▼                  ▼
 ┌──────────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐
 │ RDS Postgres │  │ S3         │  │CloudWatch│  │ Secrets Mgr  │  │ EBS Snapshots│
 │ PITR +       │  │ backup +   │  │ + SNS    │  │ / SSM        │  │ (DLM, disco) │
 │ snap cross-  │  │ mídia      │  │ (alertas)│  │ (segredos)   │  │              │
 │ region       │  │ versionado │  │          │  │              │  │              │
 └──────────────┘  └────────────┘  └──────────┘  └──────────────┘  └──────────────┘
```

**Princípio de design:** a VM passa a ser **descartável**. O estado vive no RDS e no S3, não
na máquina. Se a VM morrer, sobe outra, aponta para os mesmos serviços e segue.

---

## 6. Roadmap de migração por fases

### Fase 1 — Fundação na AWS (resiliência) · *quase zero código*

| Ação | O que muda no projeto | Esforço |
|---|---|---|
| **RDS PostgreSQL** (single-AZ + PITR para começar) | Deletar o serviço `postgres` do `docker-compose.yml`; apontar `DB_HOST` para o endpoint RDS | P |
| **Bucket S3 p/ backup** + lifecycle (Glacier após 30d) + versionamento | Reescrever destino do `backup.py` para `aws s3 cp` (ou deixar o RDS cuidar do automático) | P |
| **CloudWatch Agent + alarmes + SNS** | Config na VM; sem tocar no app. Alertas: CPU, RAM, disco>85%, container down, falha de job | M |
| **Secrets Manager / SSM + IAM Role** | Adaptar [`secrets.py`](../backend/shared/secrets.py) (já tem o gancho de GSM); remover segredos do `.env` em disco | M |
| **EBS snapshots (DLM) + Security Group + Elastic IP** | Infra pura | P |
| **Banco de teste → Postgres** | Resolve A6 (concorrência testável) | P |

✅ **Pronto quando:** a VM pode ser destruída e recriada sem perda de dados; um alerta chega
no celular quando algo quebra; existe backup do banco em **outra região**.
🔁 **Teste de restore obrigatório nesta fase** — backup não testado não conta.

### Fase 2 — CI/CD (rede de segurança)

| Ação | O que muda |
|---|---|
| **GitHub Actions: rodar os ~53 testes** em cada PR | Novo `.github/workflows/ci.yml` |
| **Deploy automatizado** via SSH (`docker compose pull && up -d`) | Novo workflow de deploy |
| **Separar `migrate`/`collectstatic` do boot** | Tirar do `entrypoint.sh`; virar passo de deploy (importante se um dia houver >1 réplica) |
| **Limpar artefatos** | Remover `tests_run.log` do versionamento |

### Fase 3 — Quebrar o gargalo síncrono (o maior ganho de performance)

> Aqui mora o problema de fundo: trabalho pesado roda **dentro do request** com apenas 2
> workers. `download_batch` lê até 500 MB para a RAM e monta ZIP bloqueando o worker.

- **3.1 — Storage no S3 com presigned URLs.** Upload direto do navegador (o `f.read()` de
  100 MB some); download direto; `download_batch` escreve o ZIP **no S3** e devolve um link.
  Migrar [`shared/drive.py`](../backend/shared/drive.py) → `shared/storage.py` (boto3).
  Trocar `drive_file_id` → `s3_key`.
- **3.2 — Fila assíncrona (Celery + Redis na VM).** Mover para worker: thumbnail, hash
  perceptual, EXIF e o `download_batch`. As tabelas `Pending*` podem ser aposentadas em favor
  do retry nativo do Celery + dead-letter queue. Depois disso, subir o nº de workers do uvicorn.

✅ **Pronto quando:** dois usuários baixando lotes grandes ao mesmo tempo não derrubam o
sistema; o upload retorna instantâneo e processa em background.

### Fase 4 — Robustez de negócio e segurança *(paralelizável)*

- Atribuição balanceada (least-loaded) em vez de `_get_any_curator().first()`.
- JWT curto + rotação de refresh + revogação (blacklist em Redis → logout real).
- Rate-limit dedicado em `/api/auth/login` no nginx.
- Corrigir os N+1 com `prefetch_related` (M11).

### Fase 5 — Scheduler e limpeza final

- Trocar os 4 containers `while-sleep` por **cron do sistema** (ou systemd timers) com horário
  absoluto — mais simples, sem desperdício de 4 cópias do backend só para dormir.
- Remover código morto (B3).

```
Fase 1  ████████              resiliência — faça já, destrava tudo
Fase 2     ████               CI — rede de segurança p/ o resto
Fase 3        ████████████    refactor pesado — maior valor de performance
Fase 4                 ██████ segurança + negócio — paralelizável
Fase 5                     ██ limpeza
```

---

## 7. Mapa: problema → solução AWS

| Problema atual | Tipo | Resolve com | Fase |
|---|---|---|---|
| Banco dentro da VM (morre junto, RPO 24h, sem PITR) | Infra | **RDS** (PITR, snapshot cross-region) | 1 |
| Backup no mesmo Google, sem off-site, restore não testado | Infra | **S3** (lifecycle/Glacier) + teste de restore | 1 |
| Sem observabilidade / alerta | Infra | **CloudWatch + SNS** | 1 |
| Segredos em `.env`/JSON no disco | Infra | **Secrets Manager / SSM + IAM Role** | 1 |
| A6 — concorrência não testável (SQLite) | Código | Banco de teste **Postgres** | 1 |
| Sem CI/CD; testes na mão | Processo | **GitHub Actions** (CI + deploy) | 2 |
| `migrate`/`collectstatic` a cada boot | Processo | passo de deploy separado | 2 |
| Trabalho síncrono trava 2 workers (`download_batch`, upload) | Código | **S3 presigned + Celery/Redis (+SQS opcional)** | 3 |
| Storage no Drive (proxy lê tudo p/ RAM, acoplamento) | Código+Infra | **S3 + CloudFront** (CDN p/ thumbnails) | 3 |
| Atribuição "sempre o primeiro curador" | Código | least-loaded (código) | 4 |
| JWT 7 dias sem revogação | Código | JWT curto + blacklist Redis | 4 |
| `while-sleep` no lugar de scheduler | Infra | cron / systemd timers | 5 |

> **O que a AWS NÃO resolve (é código, vai junto na bagagem se não corrigir antes):** os bugs
> C1–C4, A1, a autorização ampla (A3), os N+1 e a lógica de atribuição. Por isso a **Fase 0**
> vem primeiro.

---

## 8. Considerações de custo

Estimativas de ordem de grandeza (região us-east-1, sujeitas a mudança):

- **EC2** `t3.medium` (~2 vCPU / 4 GB): adequada para começar; resize fácil (parar, trocar
  tipo, ligar) se a RAM apertar. `t3.large` se rodar Celery+Redis no mesmo host.
- **RDS** `db.t3.micro/small` single-AZ + PITR: barato. Multi-AZ ≈ 2× (ligar só quando o
  negócio justificar).
- **S3:** centavos por GB/mês; Glacier ainda mais barato para retenção de backup.
- **CloudFront / Secrets Manager / SNS / CloudWatch:** custos marginais no volume desta app.

**Regra de ouro:** comece enxuto (single-AZ, uma VM) e ligue redundância (Multi-AZ, réplicas)
de forma incremental, guiado pelos alarmes do CloudWatch — não por antecipação.

---

## 9. Definição de pronto

**Projeto redondo (Fase 0):**
- [ ] C1–C4 corrigidos e cobertos por teste
- [ ] A1–A6 corrigidos (A3 com decisão de produto registrada)
- [ ] Índices do A2 migrados
- [ ] Suíte de testes verde, rodando contra Postgres

**Pronto para produção na AWS (Fases 1–2):**
- [ ] Banco no RDS com PITR + snapshot cross-region; **restore testado**
- [ ] Backup e (idealmente) mídia no S3, fora do Google
- [ ] CloudWatch + SNS com alertas chegando no celular
- [ ] Segredos no Secrets Manager / SSM; nenhum segredo no disco da VM
- [ ] CI rodando os testes em cada PR; deploy automatizado
- [ ] VM comprovadamente descartável (recriada do zero e voltou a operar)

**Escala sustentável (Fases 3–5):**
- [ ] Upload/download/thumbnail fora do request (S3 presigned + fila)
- [ ] Atribuição balanceada e JWT com revogação
- [ ] Jobs em scheduler real; código morto removido

---

*Documento gerado a partir de auditoria do código em `backend/` e `frontend/src/`.
Os números de linha referem-se ao estado do repositório no momento da análise; reconfira
após cada refactor.*
