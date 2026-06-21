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

### 🟢 Código (sem bloqueio)
- [ ] Adicionar **backoff exponencial** em `api/services/cloudinary_service.py`
      (hoje é `try/except` simples — seguir o padrão de retry do `shared/drive.py`)
- [ ] Criar modelo **`PendingCloudinaryUpload`** (espelhando `PendingDriveDeletion`)
      para reenfileirar uploads que falharam, em vez de só logar e seguir
- [ ] Migration do novo modelo `PendingCloudinaryUpload`
- [ ] Ao falhar o upload no Cloudinary nos endpoints `upload` e `upload-edited`,
      registrar pendência na fila em vez de descartar
- [ ] Criar **script de retry** que processa a fila de pendências

### 🔴 Backfill (bloqueado)
- [ ] Confirmar **credenciais e plano** do Cloudinary (limites de upload/transformação)
- [ ] Contar registros **em produção** e decidir: backfill em background ou janela de manutenção
      ```bash
      cd backend && python manage.py shell -c "
      from core.models import Media, MediaVersion
      print('Media total:', Media.objects.count())
      print('Media sem cloudinary_url:', Media.objects.filter(cloudinary_url='').count())
      print('MediaVersion sem cloudinary_url:', MediaVersion.objects.filter(cloudinary_url='').count())
      "
      ```
- [ ] Criar e rodar **script de backfill** (testar em subconjunto antes do volume completo)

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

## OPERACIONAL / GERAL
- [ ] Mergear/deployar o commit `b96619d` (Mudança 2 + fix do `perceptual_hash`)
      — até lá, ambientes no HEAD anterior seguem com o bug do `perceptual_hash`
- [ ] Toda migration deve ser testada em dev antes de aplicar em produção (regra fixa)
- [ ] Commit separado por mudança (não agrupar tudo num PR)

---

## ORDEM SUGERIDA
1. ~~**Upload parcial**~~ ✅ resolvido (concorrente + contador)
2. **Cloudinary — retry + backoff** (🟢 sem bloqueio, alto valor)
3. **Cloudinary — backfill** (🔴 após credenciais + contagem em prod)
4. **Verificações em prod** (Mudança 4 + migration da Mudança 2)

---

*Workflow Studio · CHECKLIST_IMPLEMENTACAO.md · 21/06/2026*
