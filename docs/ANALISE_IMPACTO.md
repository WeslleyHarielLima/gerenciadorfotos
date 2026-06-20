# ANALISE_IMPACTO.md — Workflow Studio
> Relatório de viabilidade das mudanças decididas na reunião de 19/06/2026
> Para ser lido pelo agente de código antes de qualquer implementação

---

## CONTEXTO

Na reunião de 19/06/2026, Jair Carvalho e Weslley Barnei tomaram decisões de produto
que impactam o sistema já implementado (todas as fases concluídas, banco com dados reais).

Este documento lista cada mudança, o impacto técnico real e a ordem recomendada de execução.

**Estado atual do projeto:**
- Todas as fases (0–9) implementadas e testadas
- Banco PostgreSQL com dados reais de produção/testes
- Google Drive integrado e em uso
- Fluxo completo uploader → editor → curador → publicador funcionando

---

## MUDANÇA 1 — Cloudinary para thumbnails e URLs públicas

### O que foi decidido
Usar Cloudinary junto com o Google Drive. O Drive continua como storage principal.
O Cloudinary serve para gerar URLs públicas de thumbnails para o dashboard e para
futuras postagens automáticas no Meta (Instagram/Facebook).
A URL pública gerada pelo Cloudinary deve ser armazenada no banco.

### Impacto no banco de dados
**ALTO — requer migration em tabela com dados reais**

- Adicionar campo `cloudinary_url` (TextField, nullable) em `Media` ou `MediaVersion`
- Adicionar campo `cloudinary_public_id` (CharField, nullable) para permitir deleção futura no Cloudinary
- Os registros existentes ficam com esses campos NULL até o backfill

**Migration necessária:**
```python
# Exemplo de migration
migrations.AddField(
    model_name='media',
    name='cloudinary_url',
    field=models.TextField(null=True, blank=True),
),
migrations.AddField(
    model_name='media',
    name='cloudinary_public_id',
    field=models.CharField(max_length=255, null=True, blank=True),
),
```

**Backfill necessário:** script que percorre todos os registros de `Media` existentes,
baixa o arquivo do Drive e sobe no Cloudinary para popular os campos.
Estimar o volume de registros antes de executar — pode ser lento.

### Impacto no código

**Novo módulo:**
- Criar `shared/cloudinary.py` com funções: `upload_image`, `delete_image`, `get_thumbnail_url`
- Incluir backoff exponencial igual ao padrão do `shared/drive.py`

**Endpoints afetados:**
- `POST /api/media/upload` (Fase 3) — após upload no Drive, chamar Cloudinary e salvar URL
- `POST /api/media/upload-edited` (Fase 4) — idem para versão editada
- Se o Cloudinary falhar, o upload não pode ser bloqueado — registrar falha e enfileirar retry

**Frontend afetado:**
- Dashboard (Fase 2) — trocar `generate_signed_url` do Drive por `cloudinary_url` do banco para exibir thumbnails
- Eliminar chamadas ao Drive apenas para renderizar miniaturas

### Risco principal
**Atomicidade:** se o arquivo sobe no Drive mas falha no Cloudinary, o registro fica sem URL.
Opções:
1. Try/catch silencioso com flag `cloudinary_pending=True` e job de retry
2. Usar `PendingDriveDeletion` como modelo para criar `PendingCloudinaryUpload`

### Ação antes de implementar
1. Verificar credenciais e plano do Cloudinary (limite de uploads/transformações)
2. Contar registros existentes em `Media` para estimar tempo de backfill
3. Decidir se o backfill roda em background ou em janela de manutenção

---

## MUDANÇA 2 — Jobs com relação pai/filho

### O que foi decidido
Implementar rastreamento explícito da cadeia de versões de um arquivo.
Cada rejeição que gera uma nova task deve referenciar a task anterior (pai).
Isso permite rastrear: task original → rejeição V1 → nova tentativa V2 → aprovação.

### Impacto no banco de dados
**BAIXO — migration simples, sem risco para dados existentes**

- Adicionar coluna `parent_task_id` (FK para `Task`, nullable, on_delete SET_NULL) na model `Task`
- Registros existentes ficam com `parent_task_id = NULL` — sem impacto retroativo
- O histórico anterior continua em `TaskHistory` sem alteração

**Migration necessária:**
```python
migrations.AddField(
    model_name='task',
    name='parent_task',
    field=models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='child_tasks'
    ),
),
```

### Impacto no código

**Endpoints afetados:**
- `POST /api/tasks/{id}/reject-with-return` (Fase 5) — ao criar nova task do editor,
  setar `parent_task = task_rejeitada`
- Nenhum outro endpoint precisa mudar

**Admin:**
- Adicionar `parent_task` e `child_tasks` no `TaskAdmin` para visualização da cadeia

**Dashboard admin (Fase 8):**
- Pode usar a cadeia para mostrar "número de iterações" por arquivo — útil para identificar
  arquivos problemáticos ou editores com muitas rejeições

### Risco principal
Baixo. A única atenção é garantir que `reject-with-return` popule o campo corretamente.
Testar que a cadeia pai→filho→neto resolve sem loop.

### Ação antes de implementar
Nenhuma pré-condição. Pode ser implementado imediatamente.

---

## MUDANÇA 3 — Upload parcial (sem encerrar tarefa)

### O que foi decidido
O uploader deve poder enviar fotos de um evento ao longo do dia, em múltiplos uploads,
sem precisar "encerrar" ou "finalizar" a tarefa. Cada envio é incremental.

### Impacto no banco de dados
**MÉDIO — depende de como a task de upload está modelada hoje**

**Verificar antes de qualquer coisa:**
```sql
-- Checar se existe task de role 'uploader' com status 'completed' ou similar
SELECT status, COUNT(*) FROM core_task WHERE role_type = 'uploader' GROUP BY status;
```

Se existir status de "conclusão" para tasks de uploader:
- O campo `status` precisa perder o estado final para uploaders, ou esse estado
  deve ser renomeado para refletir "enviado parcialmente" vs "pronto para edição"

Se não existir task de uploader (só media com status `uploaded`):
- Provavelmente não há mudança de banco necessária

### Impacto no código

**Backend:**
- Remover qualquer lógica que "fecha" ou "finaliza" a task após o uploader enviar arquivos
- O status de `Media` já é `uploaded` — isso não muda

**Frontend (dashboard do uploader):**
- Remover indicador de "tarefa concluída" por evento (se existir)
- Substituir por contador: "12 fotos enviadas — continuar enviando?"
- O botão de upload deve sempre estar disponível para o evento ativo

### Decisão crítica pendente (humano deve resolver antes da implementação)
**O editor pode pegar fotos para editar enquanto o uploader ainda está enviando do mesmo evento?**

- Se **SIM** (concorrente): nenhuma mudança adicional necessária, já funciona assim
- Se **NÃO** (sequencial): precisa de um mecanismo para o uploader sinalizar "pronto",
  e o editor só vê as fotos após esse sinal

Esta decisão deve ser tomada pelo Jair antes de qualquer código ser escrito.

### Ação antes de implementar
1. Rodar a query SQL acima para entender o estado atual das tasks de uploader
2. Jair decide: upload e edição são concorrentes ou sequenciais?

---

## MUDANÇA 4 — Múltiplos eventos no mesmo dia geram tasks individuais

### O que foi decidido
Cada evento do Google Calendar, independente da data, deve gerar uma task separada.
Se houver 3 eventos no mesmo dia, são 3 tasks distintas, com pastas separadas no Drive.

### Impacto no banco de dados
**ALTO (condicional) — depende da implementação atual do calendar_sync**

**Verificar imediatamente:**
```python
# Rodar no shell Django para entender o modelo atual
from core.models import Event
# Ver se há events duplicados na mesma data/cidade
from django.db.models import Count
Event.objects.values('event_date', 'city').annotate(total=Count('id')).filter(total__gt=1)
```

Se o sync atual **já cria um Event por google_calendar_event_id**: impacto zero.
Se o sync atual **agrupa eventos do mesmo dia**: impacto alto — dados existentes podem
estar incorretos, e a estrutura de pastas no Drive pode precisar ser reorganizada.

### Impacto no código

**`scripts/calendar_sync.py`:**
- Verificar a lógica de busca/criação de eventos
- A chave de idempotência deve ser `google_calendar_event_id`, não `(city, event_date)`
- Se hoje usa `get_or_create` com `(city, event_date)` como chave, isso está errado e
  precisa ser corrigido

**Pastas no Drive:**
- Se existem pastas criadas com nome baseado em data (ex: `2026-06-19`) em vez de
  nome do evento, pode haver conflito ao criar eventos distintos no mesmo dia

### Ação antes de implementar
1. Inspecionar `scripts/calendar_sync.py` — identificar a chave usada no `get_or_create`
2. Rodar a query acima para verificar se há eventos duplicados ou agrupados no banco atual
3. Só refatorar se a lógica atual estiver incorreta

---

## RESUMO DE IMPACTO CRUZADO

| Mudança | Risco | Banco (dados reais) | Código | Pré-condição |
|---------|-------|---------------------|--------|--------------|
| Cloudinary | 🔴 Alto | Migration + backfill | Módulo novo + 2 endpoints | Verificar credenciais e volume |
| Jobs pai/filho | 🟡 Médio | 1 coluna nullable | Endpoint de rejeição | Nenhuma |
| Upload parcial | 🟡 Médio | Depende do modelo atual | Dashboard + endpoint | Decisão humana sobre concorrência |
| Events por ID | 🔴 Alto (condicional) | Possível dados incorretos | calendar_sync | Inspecionar código e banco |

---

## ORDEM RECOMENDADA DE IMPLEMENTAÇÃO

### Passo 1 — Inspeções (zero risco, fazer antes de qualquer código)
```bash
# 1. Verificar lógica de criação de eventos no calendar_sync
cat scripts/calendar_sync.py | grep -A 10 "get_or_create"

# 2. Verificar tasks de uploader no banco
python manage.py shell -c "
from core.models import Task
print(Task.objects.values('role_type', 'status').distinct())
"

# 3. Contar registros de Media para estimar backfill do Cloudinary
python manage.py shell -c "
from core.models import Media
print('Total de Medias:', Media.objects.count())
print('Com cloudinary_url:', Media.objects.filter(cloudinary_url__isnull=False).count())
"
```

### Passo 2 — Jobs pai/filho
Menor risco, maior valor semântico, não depende de decisão externa.
Migration segura + ajuste no endpoint de rejeição.

### Passo 3 — Correção do calendar_sync (se necessário)
Só executar se a inspeção do Passo 1 revelar que a lógica está incorreta.

### Passo 4 — Upload parcial
Executar após decisão do Jair sobre concorrência uploader/editor.

### Passo 5 — Cloudinary
Último, pois envolve backfill de dados reais e dependência externa.
Implementar em janela de baixo tráfego. Testar com subset antes do backfill completo.

---

## REGRAS PARA O AGENTE DURANTE A IMPLEMENTAÇÃO

1. **Não implementar nada antes de rodar as inspeções do Passo 1.**
2. **Não executar backfill do Cloudinary sem confirmação humana do volume.**
3. **Não modificar o calendar_sync sem confirmar que a lógica atual está errada.**
4. **A decisão sobre concorrência uploader/editor é do Jair — não assumir.**
5. **Toda migration deve ser testada em banco de desenvolvimento antes de aplicar em produção.**
6. **Fazer commit separado para cada mudança — não agrupar num único PR.**

---

*Workflow Studio · ANALISE_IMPACTO.md · Gerado em 20/06/2026*
