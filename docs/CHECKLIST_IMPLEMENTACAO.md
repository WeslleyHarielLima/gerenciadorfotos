# CHECKLIST_IMPLEMENTACAO.md — Workflow Studio
> Status real de cada mudança decidida em 19/06/2026
> Gerado em 21/06/2026 com base na inspeção do código-fonte

---

## Legenda
- ✅ Implementado e correto
- ⚠️ Implementado parcialmente ou com diferença da especificação
- ❌ Não implementado
- 🔴 Ação humana obrigatória antes de prosseguir

---

## ✅ BUG PRÉ-EXISTENTE CORRIGIDO (21/06/2026) — fora do escopo das 4 mudanças

A migration `0010_remove_task_perceptual_hash` (não commitada / só aplicada no dev) havia **removido**
o campo `perceptual_hash` do `Task`, mas `api/routers/media.py` ainda o usava:
- `download_batch` — `media.py:200` cria `Task(..., perceptual_hash=...)` → **TypeError**
- `upload-edited` (fallback visual) — `media.py:295–313` filtra/lê `perceptual_hash` → **FieldError**

**Correção aplicada (Opção A — restaurar o campo):**
- Campo `perceptual_hash` (BigIntegerField, nullable) restaurado em `models.py`
- Dev DB revertido até `0009` (re-adicionou a coluna) e a migration de remoção foi **apagada do histórico**
  — como nunca foi commitada, produção nunca a aplicou; evita um drop+readd que apagaria hashes em prod
- Minha `0011` foi descartada e regenerada como `0010_task_parent_task` limpa (só `parent_task`)
- Validado: `check` ok, sem migrations pendentes, `download_batch`/`upload-edited` voltam a aceitar o campo

**Histórico final de migrations:** `…0009` → `0010_task_parent_task` (sem o ciclo remove/re-add).

---

## MUDANÇA 1 — Cloudinary para thumbnails e URLs públicas

### Banco de dados
- ✅ Campo `cloudinary_url` (URLField, blank) em `Media` — `models.py:71`
- ✅ Campo `cloudinary_public_id` (CharField, blank) em `Media` — `models.py:72`
- ✅ Campo `cloudinary_url` em `MediaVersion` — `models.py:107`
- ✅ Campo `cloudinary_public_id` em `MediaVersion` — `models.py:108`
- ✅ Migrations criadas: `0008_media_cloudinary_fields`, `0009_mediaversion_cloudinary_fields`

### Código — módulo Cloudinary
- ⚠️ Módulo criado em `api/services/cloudinary_service.py` (especificação previa `shared/cloudinary.py`)
- ⚠️ Funções implementadas como `upload_thumbnail`, `upload_version_thumbnail`, `delete_asset`
  (especificação previa `upload_image`, `delete_image`, `get_thumbnail_url` — funcionalidade equivalente)
- ❌ Backoff exponencial ausente — o módulo atual usa apenas `try/except` simples, sem retry progressivo como `shared/drive.py`

### Código — endpoints
- ✅ `POST /api/media/upload` chama `upload_thumbnail` após upload no Drive — `media.py:134–138`
- ✅ Falha no Cloudinary não bloqueia o upload (try/catch silencioso com retorno `None`)
- ✅ `POST /api/media/upload-edited` chama `upload_version_thumbnail` para versão editada — `media.py:378–382`

### Código — tratamento de falha
- ❌ Sem flag `cloudinary_pending` nos modelos
- ❌ Sem modelo `PendingCloudinaryUpload` para enfileirar retry
- ⚠️ Falha silenciosa sem mecanismo de recuperação — registros ficam com `cloudinary_url` vazio sem notificação

### Frontend
- ✅ Dashboard do curador (`tasks.py`) usa `cloudinary_url` via `edited_cloudinary_url` — `tasks.py:229`
- ✅ Editor board usa `cloudinary_url` da Media — `tasks.py:59, 79, 96`
- ✅ Publisher queue usa `cloudinary_url` — `tasks.py:411`

### Ações humanas pendentes
- 🔴 Verificar credenciais e limite do plano Cloudinary (uploads/transformações)
- 🔴 Contar registros existentes antes de decidir sobre backfill:
  ```bash
  cd backend && python manage.py shell -c "
  from core.models import Media, MediaVersion
  print('Media total:', Media.objects.count())
  print('Media sem cloudinary_url:', Media.objects.filter(cloudinary_url='').count())
  print('MediaVersion total:', MediaVersion.objects.count())
  print('MediaVersion sem cloudinary_url:', MediaVersion.objects.filter(cloudinary_url='').count())
  "
  ```
- 🔴 Decidir: backfill em background ou janela de manutenção?
- ❌ Script de backfill ainda não existe — deve ser criado após decisão acima

---

## MUDANÇA 2 — Jobs com relação pai/filho — ✅ IMPLEMENTADO (21/06/2026)

### Banco de dados
- ✅ Campo `parent_task` (FK `self`, nullable, `on_delete=SET_NULL`, `related_name="child_tasks"`) em `models.py`
- ✅ Migration `0010_task_parent_task` criada e aplicada no banco dev (após limpeza do histórico — ver topo)

### Código — endpoint
- ✅ `POST /{task_id}/reject-with-return` agora **cria nova task** do editor (não reabre mais a existente)
- ✅ A nova task recebe `parent_task = previous_editor_task` (cadeia editor→editor de tentativas)
- ✅ Mantém `assigned_to` do editor anterior e propaga o feedback do curador

### Admin
- ✅ `parent_task` adicionado ao `list_display` do `TaskAdmin` + `raw_id_fields`
- ✅ `child_tasks` acessível via related_name (cadeia visível)
- ✅ Coluna **"Iterações"** no admin: profundidade da cadeia pai/filho por task (com proteção anti-loop)

### Validação
- ✅ `manage.py check` sem issues · `makemigrations --check` sem pendências
- ✅ Metadados do campo verificados (SET_NULL, null=True, related_name)

### Status geral: ✅ Implementado — falta aplicar a migration em PRODUÇÃO (regra #5) e commit isolado (regra #6)

---

## MUDANÇA 3 — Upload parcial (sem encerrar tarefa)

### Situação atual do modelo
- ✅ `Task.ROLE_TYPE_CHOICES` contém apenas `editor`, `curator`, `publisher` — **uploader não tem task**
- ✅ `POST /api/media/upload` cria `Media` com status `uploaded` sem abrir nem fechar nenhuma task
- ✅ Portanto: o backend **já suporta upload incremental** por natureza — cada arquivo é independente

### O que ainda precisa ser avaliado
- 🔴 **Decisão humana obrigatória (Jair):** Editor pode pegar fotos enquanto uploader ainda envia?
  - Se SIM (concorrente): nenhuma mudança de backend necessária
  - Se NÃO (sequencial): precisa de mecanismo "pronto para edição" (sinalização explícita do uploader)
- ❌ Frontend do uploader não inspecionado neste levantamento — verificar se existe indicador de "tarefa concluída" por evento que deve ser removido

### Status geral: ⚠️ Backend ok, decisão de produto pendente, frontend a verificar

---

## MUDANÇA 4 — Múltiplos eventos no mesmo dia geram tasks individuais

### calendar_sync.py
- ✅ Chave de idempotência é `google_calendar_event_id` — `calendar_sync.py:130, 173`
- ✅ `Event.objects.filter(google_calendar_event_id=cal_id)` é a busca de existência — correto
- ✅ Criação usa `Event.objects.create()` com `google_calendar_event_id` único — sem agrupamento por data
- ✅ Portanto: a lógica atual já cria um `Event` por evento do Calendar, não por `(city, event_date)`

### Verificação de dados existentes (recomendada, não obrigatória)
- ⚠️ Ainda não foi rodada a query para confirmar que dados existentes não têm agrupamento indevido:
  ```bash
  cd backend && python manage.py shell -c "
  from core.models import Event
  from django.db.models import Count
  duplicates = Event.objects.values('event_date', 'city').annotate(total=Count('id')).filter(total__gt=1)
  print(list(duplicates))
  "
  ```

### Status geral: ✅ Código correto — rodar query de verificação para confirmar dados

---

## RESUMO EXECUTIVO

| Mudança | Status | Próxima ação |
|---------|--------|--------------|
| Cloudinary (banco + endpoints) | ✅ Implementado | Backfill + retry mechanism |
| Cloudinary (retry/pending) | ❌ Faltando | Implementar `PendingCloudinaryUpload` |
| Cloudinary (backfill) | 🔴 Bloqueado | Contar registros → decisão humana → script |
| Jobs pai/filho (migration) | ✅ Feito (0011) | Aplicar em produção |
| Jobs pai/filho (endpoint) | ✅ Feito | — |
| Jobs pai/filho (admin) | ✅ Feito | — |
| Upload parcial (backend) | ✅ Já funciona | Nenhuma |
| Upload parcial (decisão) | 🔴 Bloqueado | Jair decide concorrência uploader/editor |
| Upload parcial (frontend) | ⚠️ A verificar | Inspecionar dashboard do uploader |
| Eventos por Calendar ID | ✅ Correto | Rodar query de verificação nos dados |

---

## ORDEM DE EXECUÇÃO RECOMENDADA

### Imediato (sem pré-condição)
1. **Jobs pai/filho** — migration + ajuste em `reject-with-return` + admin
   - Menor risco, maior valor, nenhuma dependência externa

### Após decisão humana
2. **Upload parcial** — verificar frontend após Jair decidir sobre concorrência

### Após contagem de registros + credenciais confirmadas
3. **Cloudinary retry** — implementar `PendingCloudinaryUpload` ou flag `cloudinary_pending`
4. **Script de backfill** — criar e testar em subconjunto antes de aplicar completo

### Verificação (não é mudança de código)
5. **Events query** — rodar a query SQL/Django para confirmar dados existentes

---

*Workflow Studio · CHECKLIST_IMPLEMENTACAO.md · 21/06/2026*
