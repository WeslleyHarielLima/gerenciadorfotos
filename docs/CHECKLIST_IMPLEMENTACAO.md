# CHECKLIST_IMPLEMENTACAO.md — Workflow Studio
> O que ainda precisa ser feito (mudanças da reunião de 19/06/2026)
> Atualizado em 21/06/2026

---

## Legenda
- 🟢 Pode ser feito agora (sem bloqueio)
- 🔴 Bloqueado por decisão humana
- 🔍 Verificação / operacional

---

## MUDANÇA 1 — Cloudinary (thumbnails e URLs públicas)

### 🟢 Código (sem bloqueio) — ✅ FEITO (21/06/2026)
- [x] **Backoff exponencial** em `cloudinary_service.py` (`_with_backoff`, delays `[1,2,4,8,16]`
      igual ao `shared/drive.py`) + `upload_with_backoff` usado pelo retry offline
- [x] Modelo **`PendingCloudinaryUpload`** (FK media/media_version, attempts, status) — migration `0011`
- [x] Endpoints `upload` e `upload-edited`: ao falhar o Cloudinary (só p/ imagens),
      **enfileiram** `PendingCloudinaryUpload` em vez de descartar — sem bloquear o upload
- [x] **Script de retry** `scripts/cloudinary_retry.py`: baixa do Drive → sobe ao Cloudinary
      com backoff, grava URL na Media/MediaVersion, MAX_ATTEMPTS=5, loga em `ScriptExecutionLog`
- [x] Admin: `PendingCloudinaryUploadAdmin` com alerta de 3+ tentativas
- [x] **Agendado:** serviço `cloudinary_retry` no `docker-compose.yml` (container worker, ciclo 600s/10min)

### 🔴 Backfill (plano GRÁTIS — rodar em lotes pequenos, conferindo a cota)
- [x] Script **pronto**: `scripts/cloudinary_backfill.py` (com `--count`, `--limit N`, `--dry-run`) — **não executado**
- [ ] **Você:** confirmar que as credenciais do Cloudinary estão no `.env` de produção
- [ ] **Você:** contar o que falta em produção:
      ```bash
      cd backend && python -m scripts.cloudinary_backfill --count
      ```
- [ ] **Você:** rodar em lotes, conferindo a cota no painel do Cloudinary entre cada um:
      ```bash
      cd backend && python -m scripts.cloudinary_backfill --limit 200 --dry-run   # confere alvos
      cd backend && python -m scripts.cloudinary_backfill --limit 200             # sobe o lote
      # repetir até --count chegar a 0
      ```

---

## MUDANÇA 2 — Jobs com relação pai/filho

### 🔍 Operacional
- [ ] Aplicar a migration `0010_task_parent_task` em **produção** (já aplicada só no dev)

### 🟢 Opcional
- [ ] Contador de "número de iterações por arquivo" no **dashboard admin (Fase 8)**
      (a coluna por task já existe no `TaskAdmin`; falta a visão agregada)

---

## MUDANÇA 3 — Upload parcial (sem encerrar tarefa) — ✅ RESOLVIDA (21/06/2026)

### Decisão (Jair): CONCORRENTE
Uploader e editor trabalham em paralelo — cada foto fica disponível para o editor
assim que sobe. Nenhuma trava sequencial; sem etapa de "finalizar".

### Implementado
- [x] Confirmado: backend já é concorrente (upload cria `Media status=uploaded`, sem task;
      o board do editor já lista cada mídia `uploaded` imediatamente)
- [x] Confirmado: a página do uploader **não tinha** indicador de "tarefa concluída" a remover
- [x] Confirmado: botão de upload sempre disponível para o evento ativo (envio incremental)
- [x] **Contador cumulativo persistente** ("X fotos já enviadas neste evento · Y aguardando edição")
  - Backend: `GET /api/media/event/{id}/upload-stats` (`event_upload_stats`)
  - Frontend: `ApiClient.getEventUploadStats` + badge na página do uploader, atualizado a cada envio

---

## MUDANÇA 4 — Múltiplos eventos no mesmo dia geram tasks individuais

### 🔍 Verificação (código já está correto)
- [ ] Rodar a query de duplicatas em **produção** (dev só tem 2 events, sem duplicatas)
      ```bash
      cd backend && python manage.py shell -c "
      from core.models import Event
      from django.db.models import Count
      print(list(Event.objects.values('event_date','city').annotate(t=Count('id')).filter(t__gt=1)))
      "
      ```
- [ ] Decidir o que fazer com a alteração local não commitada em `scripts/calendar_sync.py`
      (refinamento do parser de cidade — não relacionado à idempotência, é WIP de alguém)

---

## OPERACIONAL / GERAL — comandos de produção (executar no deploy)

### 1. Deploy
- [ ] Mergear/deployar a branch `reuniao2` — até lá, ambientes no HEAD anterior
      seguem com o bug do `perceptual_hash`
- [ ] Subir o novo worker de retry junto com os demais:
      ```bash
      docker compose up -d cloudinary_retry
      ```

### 2. Migrations (Mudanças 2 e 1) — já testadas em dev
- [ ] Aplicar em produção:
      ```bash
      cd backend && python manage.py migrate
      # aplica 0010_task_parent_task (Mudança 2) e 0011_pendingcloudinaryupload (Mudança 1)
      ```

### 3. Verificação de dados (read-only)
- [ ] **Mudança 4** — confirmar que não há eventos agrupados por (data, cidade):
      ```bash
      cd backend && python manage.py shell -c "
      from core.models import Event
      from django.db.models import Count
      print(list(Event.objects.values('event_date','city').annotate(t=Count('id')).filter(t__gt=1)))
      "
      # lista vazia [] = ok (idempotência por google_calendar_event_id está correta)
      ```

### 4. Pendências de produto
- [ ] Decidir o que fazer com o WIP local em `scripts/calendar_sync.py` (parser de cidade)
- [ ] (Opcional) Contador de iterações agregado no dashboard admin (Mudança 2)

### Regras fixas
- [ ] Toda migration testada em dev antes de produção · commit separado por mudança

---

## ORDEM SUGERIDA
1. ~~**Upload parcial**~~ ✅ resolvido (concorrente + contador)
2. ~~**Cloudinary — retry + backoff**~~ ✅ feito (worker agendado no docker-compose)
3. ~~**Backfill — script**~~ ✅ pronto · **execução em lotes é sua** (plano grátis)
4. **Deploy:** migrate em prod + verificações (Mudanças 4 e 2)

---

*Workflow Studio · CHECKLIST_IMPLEMENTACAO.md · 21/06/2026*
