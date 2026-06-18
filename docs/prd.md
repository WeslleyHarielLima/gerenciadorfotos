# PRD — Workflow Studio

> Versão 1.2 · MVP · Junho 2026  
> Atualizado com decisões do grilling session e customização do admin

---

## 1. Visão Geral

Sistema web colaborativo de gerenciamento de fluxo de edição de fotos e vídeos para times de produção. Cada arquivo percorre fases sequenciais controladas por status, e cada usuário enxerga apenas o que é relevante para sua fase de trabalho.

---

## 2. Problema que Resolve

Times de produção fotográfica e audiovisual perdem tempo e cometem erros por falta de controle sobre qual arquivo está em qual fase, quem está editando o quê, e se a versão entregue é de fato uma edição real do original. Arquivos se perdem, versões se sobrescrevem, e não há rastreabilidade de quem fez o quê.

---

## 3. Objetivos do MVP

- Controlar o fluxo de arquivos do upload até a publicação via status
- Garantir integridade das edições via comparação de hash SHA-256
- Usar Google Drive como storage e Google Calendar como fonte dos eventos
- Manter o Postgres apenas com metadados, hashes e controle de fluxo — nenhum binário é salvo no banco
- Cada usuário vê apenas onde tem trabalho a fazer, sem configuração manual

---

## 4. Usuários e Roles

| Role | Responsabilidade |
|---|---|
| **Uploader** | Faz upload em lote das fotos e vídeos brutos do evento |
| **Editor** | Seleciona arquivos, edita no próprio PC e devolve a versão editada |
| **Curador** | Revisa edições comparando original e editado, aprova ou rejeita com feedback |
| **Publicador** | Recebe edições aprovadas e executa a publicação |
| **Admin** | Visão completa de todos os eventos e fases, sem executar tarefas de produção |

---

## 5. Stack Técnica

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | Next.js (TypeScript) + Tailwind CSS | Interface web, kanban, modais |
| Backend | Django (Python) + Django Ninja, servido por uvicorn (ASGI) | Admin, ORM, migrations, auth, API REST (upload, fluxo, hash, Drive) |
| Painel Admin | django-unfold | Tema moderno sobre o Django Admin |
| Banco | PostgreSQL em container Docker (porta 5432) | Metadados, hashes, controle de fluxo |
| Storage | Google Drive via API | Armazenamento de binários |
| Eventos | Google Calendar via API | Fonte dos eventos e metadados |
| Segredos | Google Secret Manager (GSM) | Senha do Postgres e secrets sensíveis |
| Proxy | Nginx (VPS) | Roteamento para o backend Django |
| Infraestrutura | VPS com firewall | Deploy do backend com acesso seguro via internet |

### Por que Django + Django Ninja + uvicorn (backend único)

Um **único** processo Django, rodando em modo ASGI sob **uvicorn**, concentra admin e API. Não há serviço separado para a API.

**Django** cuida de:
- Painel admin com Unfold — visual moderno, configurável, sem construir do zero
- ORM completo com migrations gerenciadas
- Sistema de autenticação e permissões já pronto
- Models como fonte única — a API consome os mesmos models, sem ponte entre serviços

**Django Ninja** cuida de:
- Endpoints REST com schemas Pydantic e validação automática
- Views assíncronas (`async def`) para upload e processamento, servidas por uvicorn
- Pipe de ingestão: recebe binário → calcula hash → envia ao Drive → salva metadados
- Endpoints do kanban com respostas rápidas para o Next.js
- Documentação OpenAPI/Swagger automática em `/api/docs`

Os scripts de sync com Google Calendar e Drive rodam como management commands / processos à parte, usando os mesmos models e o ORM do Django.

> **Nota sobre async e o Drive:** as SDKs `google-api-python-client` são síncronas; chamadas ao Drive/Calendar rodam em threadpool (`sync_to_async`) tanto aqui quanto em qualquer outra stack. O ganho de async está no I/O concorrente da app, não na SDK do Drive.

### Roteamento via Nginx

```
Nginx (VPS)
  /admin/   → Django (uvicorn, porta 8000)
  /api/     → Django Ninja (mesmo processo Django, porta 8000)

Frontend Next.js → Vercel
```

> `/admin` e `/api` são o **mesmo** processo Django sob uvicorn — o Nginx só separa os caminhos por conveniência (cache, rate limit, body size), não por upstream.

---

## 6. Painel Admin — Django + Unfold

O Django Admin usa **django-unfold** para substituir a interface padrão por um tema moderno baseado em Tailwind CSS.

```python
# settings.py
INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    ...
]
```

O painel admin expõe:
- Gestão de usuários e roles
- Lista de eventos com status e indicadores de gargalo
- Fila de pendências de eventos não processados pelo script
- Indicador de saúde do script de sync com Calendar
- Log de execuções do script com traceback em caso de falha
- Alertas de cidades novas criadas automaticamente para confirmação
- Indicador de backup diário do banco
- Tabela `pending_drive_deletions` com itens aguardando retry
- Activity log completo

---

## 7. Arquitetura de Segurança

- O frontend nunca acessa o banco diretamente
- Apenas o backend Django (admin + API Ninja) tem credencial do Postgres
- A senha do Postgres fica no Google Secret Manager
- O backend busca o segredo no GSM com TTL curto, conecta, e o segredo expira do cache
- O `.env` do repositório contém apenas o nome do segredo no GSM, nunca a senha em si
- Em desenvolvimento local a senha fica em `.env` local fora do repositório
- VPS protegida com firewall — apenas portas necessárias expostas

### .env do repositório

```env
# ─── Banco de Dados ───────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=workflow_studio
DB_VOLUME=workflow_postgres_data
GSM_SECRET_NAME=workflow-postgres-password

# ─── Google APIs ──────────────────────────────────
GOOGLE_CALENDAR_ID=seu-calendar-id
GOOGLE_DRIVE_ROOT_FOLDER_ID=id-da-pasta-raiz

# ─── Múltiplas agendas por cidade ─────────────────
GOOGLE_SERVICE_KEY_PORTO_VELHO=nome-do-segredo-gsm
GOOGLE_SERVICE_KEY_JI_PARANA=nome-do-segredo-gsm
GOOGLE_SERVICE_KEY_ARIQUEMES=nome-do-segredo-gsm

# ─── JWT ──────────────────────────────────────────
JWT_SECRET_NAME=workflow-jwt-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=168

# ─── Serviços ─────────────────────────────────────
DJANGO_PORT=8000          # admin + API Ninja, mesmo processo (uvicorn ASGI)
FRONTEND_URL=https://seu-dominio.vercel.app
ENVIRONMENT=development
```

> JWT configurado para 168 horas (7 dias) para suportar trabalho em campo com conexão instável.

---

## 8. Modelo de Dados

> O Postgres armazena exclusivamente metadados, hashes e controle de fluxo. Nenhum binário é persistido.

### cities
```
id
name                      ex: Porto Velho
state                     ex: RO
drive_folder_id           ID da pasta da cidade no Drive
created_at
```

### events
```
id
city_id                   FK cities
google_calendar_event_id  ID do evento no Calendar
google_calendar_key       qual chave de serviço usou (por cidade)
google_drive_folder_id    ID da pasta do evento no Drive
name                      título vindo do Calendar
description               descrição vinda do Calendar
location                  campo local vindo do Calendar
event_date
event_end_date
status                    active / completed / archived / pending_validation
created_at
synced_at
```

### users
```
id
username
email
password_hash
role                      uploader / editor / curator / publisher / admin
created_at
```

### media
```
id
event_id                  FK events
drive_file_id             ID do arquivo no Drive
drive_web_view_link       link de visualização
drive_web_content_link    link de download
drive_parent_folder_id    pasta atual no Drive
original_filename
mime_type
file_size
hash_sha256               calculado pela API antes do upload pro Drive
uploaded_by               FK users
status                    uploaded / selected_for_edit / pending_review /
                          approved / published / rejected_final
created_at
last_status_change        timestamp da última mudança de status
```

### media_versions
```
id
media_id                  FK media (sempre aponta pro original)
version                   original / v1_edited / v2_edited ...
drive_file_id             ID desta versão no Drive
hash_sha256               hash desta versão específica
edited_by                 FK users
edited_at
status                    uploaded / pending_review / approved /
                          rejected / rejected_final
file_size
```

### tasks
```
id
media_version_id          FK media_versions
assigned_to               FK users
role_type                 editor / curator / publisher
status                    pending / in_progress / completed
feedback                  texto do curador ao rejeitar
deletion_reason_type      motivo padronizado de desistência
deletion_reason_custom    texto livre quando "Outro motivo"
deleted_at                soft delete
deleted_by                FK users
created_at
completed_at
```

### task_history
```
id
media_id                  FK media
version                   versão revisada
reviewed_by               FK users (curador)
decision                  approved / rejected_with_return / rejected_final
feedback                  texto do feedback
created_at
```

### pending_drive_deletions
```
id
drive_file_id             ID do arquivo a deletar no Drive
media_version_id          FK media_versions
attempts                  número de tentativas realizadas
last_attempt_at           timestamp da última tentativa
error_message             último erro retornado pelo Drive
status                    pending / failed_max_attempts
created_at
```

### script_execution_log
```
id
script_name               calendar_sync / drive_cleanup / backup
status                    success / partial / failed
events_processed          quantidade processada
events_failed             quantidade com falha
error_traceback           traceback completo em caso de falha
executed_at
```

### activity_log
```
id
user_id                   FK users
action                    uploaded / selected / submitted / approved /
                          rejected / published / abandoned / fraud_attempt
media_id                  FK media
details                   texto livre
created_at
```

---

## 9. Estrutura de Pastas no Drive

```
📁 Workflow Studio/
  📁 _backups/                        ← dumps diários do Postgres
  📁 Rondônia/
    📁 Porto Velho/
      📁 Casamento Silva — 15 Jun 2026/
        📁 01_uploaded/
        📁 02_editing/
        📁 03_pending_review/
        📁 04_approved/
        📁 05_published/
        📁 07_rejected_final/
        📁 _originals/
        📁 _versions_temp/
    📁 Ji-Paraná/
    📁 Ariquemes/
```

> Cidade só existe porque o Calendar trouxe um evento com aquele local. Nunca criada manualmente.

---

## 10. Fluxo de Status dos Arquivos

```
uploaded
  ↓
selected_for_edit         editor selecionou
  ↓
pending_review            editor enviou versão editada
  ↓
selected_for_edit         curador rejeitou com retorno para ajuste
  ↓
pending_review            editor enviou nova versão
  ↓
approved                  curador aprovou
  ↓
published                 publicador publicou

Saída do fluxo:
pending_review → rejected_final    curador rejeitou definitivamente
```

### Visibilidade por status

| Status | Uploader | Editor | Curador | Publicador |
|---|:---:|:---:|:---:|:---:|
| `uploaded` | ✅ | ✅ | ❌ | ❌ |
| `selected_for_edit` | ❌ | ✅ | ❌ | ❌ |
| `pending_review` | ❌ | ✅ | ✅ | ❌ |
| `approved` | ❌ | ❌ | ✅ | ✅ |
| `published` | ✅ | ✅ | ✅ | ✅ |
| `rejected_final` | ✅ | ✅ | ✅ | ❌ |

---

## 11. Pipe de Ingestão

```
Usuário seleciona arquivos no browser
        ↓
Frontend verifica se evento existe no banco
  → Não existe → bloqueia com mensagem "Evento ainda não disponível"
  → Existe → libera dropzone
        ↓
Next.js envia binário para a API (Django Ninja)
        ↓
A API recebe em memória (nunca toca o disco)
        ↓
A API calcula SHA-256
        ↓
A API faz upload para pasta 01_uploaded do evento no Drive
        ↓
Drive retorna file_id, links, mimeType, size, createdTime
        ↓
A API salva metadados + hash no Postgres
        ↓
A API descarta binário da memória
        ↓
Retorna sucesso para o frontend
```

> O binário nunca é persistido no servidor. Entra em memória, vai pro Drive, metadados vão pro Postgres, encerra o pipe.

---

## 12. Anti-Fraude por Hash

Quando o editor faz upload da versão editada:

```
A API calcula SHA-256 da versão nova
        ↓
Busca hash do original no banco
        ↓
Se iguais    → rejeita com erro 400
               "Arquivo idêntico ao original"
               registra fraud_attempt no activity_log
        ↓
Se diferentes → salva versão no Drive
                salva metadados + hash no Postgres
                move card para pending_review
```

### Validações adicionais
- Mesmo tipo de arquivo que o original
- Tamanho não inferior a 10% do original
- Para imagens: resolução não pode cair drasticamente

---

## 13. Vínculo de Versões Editadas — Matching por EXIF + Fallback Manual

### Primário — Embed de media_id no EXIF

Quando o editor baixa o ZIP com os originais, a API injeta o `media_id` do banco nos metadados EXIF de cada arquivo antes de compactar.

```
Download: DSC_0042.jpg
  → API injeta EXIF: media_id=847
  → Editor salva como "final_casamento.jpg"
  → Upload: API lê EXIF → media_id=847 → vínculo feito
```

Funciona independente de como o editor renomeia o arquivo. Para vídeos usa metadados de container (MP4).

### Fallback — Interface de Vínculo Manual

Se o software de edição remover os metadados EXIF, o sistema detecta a ausência do `media_id` e envia o arquivo para a fila de vínculo manual.

```
ARQUIVOS ENVIADOS          CARDS EM ABERTO
┌──────────────────┐       ┌──────────────────┐
│ 🖼️ foto_final.jpg │  →→→  │ 🖼️ DSC_0042.jpg  │
│ 2.4 MB           │       │ card #847        │
└──────────────────┘       └──────────────────┘
```

O editor vê miniatura do original à direita e arrasta o arquivo enviado para o card correspondente. Após confirmar, o fluxo normal de hash e processamento continua.

---

## 14. Download e Upload em Lote pelo Editor

### Download
- Editor marca arquivos com checkbox na coluna Disponíveis
- Clica em "Baixar selecionados"
- Sistema gera ZIP com os originais selecionados
- A API injeta EXIF com `media_id` em cada arquivo antes de compactar
- Cards criados automaticamente na coluna Editando

### Upload
- Editor seleciona todos os arquivos editados de uma vez
- Sistema lê EXIF de cada arquivo e vincula ao card correspondente
- Arquivos sem EXIF vão para fila de vínculo manual
- Hash calculado e comparado para cada arquivo
- Cards movem para "Enviadas para revisão" após processamento

---

## 15. Limpeza de Versões

Quando o curador aprova, dentro da mesma transação:

```
1. Commita aprovação no banco
2. Registra versões intermediárias em pending_drive_deletions
3. Job horário tenta deletar do Drive
4. Remove linhas intermediárias da media_versions após deleção confirmada
5. Atualiza status da media para approved
```

**O que sobra:**
```
media_versions
  version: original     → nunca deletado
  version: vN_edited    → a versão aprovada
```

Na rejeição total: deleta todas as versões editadas, mantém só o original.

> Banco commita primeiro. Drive deleta depois via job com retry. Falhas ficam em `pending_drive_deletions` com alerta no painel admin após atingir limite de tentativas.

---

## 16. Kanban do Editor

**Colunas:**
```
[ Disponíveis ] → [ Editando ] → [ Enviadas para revisão ]
```

### Ações disponíveis

**Coluna Disponíveis**
- Checkbox para seleção múltipla
- Botão "Baixar selecionados" gera ZIP com EXIF injetado

**Coluna Editando**
- Card bloqueado até receber versão editada
- Botão "Upload em lote" para enviar múltiplos de uma vez
- Botão "Desistir" abre modal de desistência

### Modal de desistência

```
Motivo da desistência  [ dropdown ▼ ]

  Arquivo corrompido ou ilegível
  Foto fora de foco — sem recuperação
  Exposição comprometida — sem recuperação
  Conteúdo inapropriado ou inadequado
  Arquivo duplicado de outro que já estou editando
  Problema técnico no meu software de edição
  Prazo insuficiente para esta entrega
  ──────────────────────────────────────────────
  Outro motivo...          ← abre campo de texto livre
```

**Ao desistir:**
- Task recebe soft delete com motivo, timestamp e user_id
- Arquivo volta para status `uploaded`
- Volta para coluna Disponíveis para outro editor
- Registrado no activity_log como `abandoned`

---

## 17. Modal do Curador

```
Original                      Versão editada (vN)
[ imagem / vídeo ]            [ imagem / vídeo ]

Histórico completo de versões:
  v1 · 12 Jun · João Silva · rejeitada com retorno
     "exposição ainda estourada"
  v2 · 13 Jun · João Silva · em revisão agora

Justificativa (obrigatória para rejeição)
[ campo de texto ]

[ Fechar ]  [ Rejeitar com retorno ]  [ Rejeição total ]  [ Aprovar ]
```

- Imagens carregadas via signed URL temporária gerada pela API (expiração 15 min)
- Histórico completo sempre visível independente de qual curador está revisando
- Justificativa obrigatória para rejeição com retorno e rejeição total
- Histórico salvo na tabela `task_history`

---

## 18. Script de Sincronização com Google Calendar

Roda a cada 5 minutos. Registra cada execução em `script_execution_log`. Alerta vermelho no painel admin se não executar com sucesso por mais de 15 minutos.

### Validação de campos obrigatórios
```
Campo local ausente ou não reconhecido após normalização
  → Evento não é criado no banco nem no Drive
  → Registra em fila de pendências no painel admin
  → Motivo: "campo local ausente" ou "cidade não reconhecida"
  → Retry automático na próxima rodada do script
```

### Normalização do campo local
```
"Porto Velho - RO" → "porto velho"
"porto velho"      → "porto velho"
"Pv"               → não reconhecido → fila de pendências
```

### Eventos novos (válidos)
```
Extrai: nome, data, local normalizado, descrição
Verifica cidade no banco
  → Não existe: cria cidade + pasta no Drive + alerta admin para confirmar
  → Existe: usa city_id e drive_folder_id existentes
Cria evento no banco
Cria pasta do evento no Drive dentro da pasta da cidade
Cria subpastas do fluxo
Registra sucesso no script_execution_log
```

### Eventos atualizados
```
Atualiza nome, data, local, descrição no banco
Renomeia pasta no Drive se o nome mudou
Atualiza synced_at
```

### Eventos cancelados
```
Muda status para archived no banco
Não deleta pasta do Drive
```

---

## 19. Navegação em Cascata

```
Dashboard
  ↓  seção "Em andamento" — cards ativos do usuário (todas as cidades)
  ↓  cidades onde há trabalho na fase do usuário
Cidade
  ↓  eventos com trabalho pendente + indicador de tempo parado
Evento
  ↓  kanban da fase do usuário
Card
  ↓  ação (upload, revisão, publicação)
```

### Query base de visibilidade

```sql
SELECT DISTINCT c.name, c.id
FROM cities c
JOIN events e ON e.city_id = c.id
JOIN media m ON m.event_id = e.id
WHERE m.status = :status_da_fase_do_role
ORDER BY c.name
```

---

## 20. Indicadores de Tempo e Gargalos

- Campo `last_status_change` em `media` registra quando o arquivo mudou de fase
- Threshold configurável por fase (ex: 48h em edição, 24h em revisão)
- Arquivos parados além do threshold ficam marcados com alerta visual no painel admin
- Admin identifica gargalos por editor, por evento e por cidade sem abrir card por card

---

## 21. Backup do Banco

- Dump diário do Postgres às 3h da manhã
- Upload compactado para pasta `_backups` no Drive
- Retenção de 30 dias
- Resultado registrado em `script_execution_log`
- Alerta vermelho no painel admin se o backup falhar
- Processo de restauração documentado no repositório

---

## 22. Publicação no MVP

- Publicador clica em "Publicar" no card aprovado
- A API move arquivo para pasta `05_published` no Drive
- Card some da fila ativa e vai para aba "Histórico" do evento
- Status atualizado para `published` no banco
- Integração com Meta e TikTok no roadmap pós-MVP

---

## 23. Telas do MVP

| Tela | Role | Descrição |
|---|---|---|
| Login | Todos | Única tela pública |
| Dashboard | Todos | Seção "Em andamento" + cidades com trabalho pendente |
| Cidade | Todos | Eventos com contador de pendências e tempo parado |
| Kanban Uploader | Uploader | Dropzone de upload em lote para o evento |
| Kanban Editor | Editor | Disponíveis (com checkbox) / Editando / Enviadas |
| Vínculo Manual | Editor | Interface de arrastar para vincular arquivos sem EXIF |
| Kanban Curador | Curador | Cards com modal comparativo + histórico completo |
| Kanban Publicador | Publicador | Lista de aprovados + aba Histórico |
| Painel Admin | Admin | Unfold — visão geral, gargalos, saúde dos scripts, pendências |

---

## 24. Cota do Google Drive API

- Limite de requisições: 2.400 req/min por usuário (suficiente para o MVP)
- Limite de transferência: 750 GB/dia — monitorar em eventos com vídeos em alta resolução
- Limite de itens: 500k por Shared Drive — usar Shared Drive dedicado para o projeto
- Estratégia: backoff exponencial nas chamadas ao Drive. Fila de concorrência limitada no pós-MVP

---

## 25. Roadmap Pós-MVP

- Publicação automática via API da Meta e TikTok a partir da pasta `05_published`
- Fila de concorrência limitada para chamadas ao Drive em alto volume
- Notificações em tempo real via WebSockets
- Login com OAuth Google
- App mobile
- Relatórios e analytics por evento e por editor
- Múltiplos estados além de Rondônia

---

## 26. Fora do Escopo do MVP

- Integração com Meta e TikTok
- Notificações em tempo real
- Login com OAuth Google
- App mobile
- Relatórios e analytics

---

## 27. Cronograma

| Dia | Entrega |
|---|---|
| Dia 1–2 | Planejamento, PRD aprovado, schema do banco |
| Dia 3 | Backend: Docker, migrations, autenticação, GSM, sync Calendar/Drive |
| Dia 4 | Backend: pipe de ingestão, endpoints do fluxo, anti-fraude, EXIF |
| Dia 5 | Frontend: login, dashboard cascata, kanbans, painel admin Unfold |
| Apresentação | Terça-feira — sistema funcional ponta a ponta |

---

## 28. Ordem de Implementação

```
 1.  Docker Compose com Postgres
 2.  Migrations do banco — Django (todas as tabelas)
 3.  Django + Unfold: autenticação, painel admin, models
 4.  Backend: integração com GSM para senha do banco
 5.  Script: sync com Google Calendar + validação de campos + log de execução
 6.  Script: criação de pastas no Google Drive
 7.  Script: backup diário do Postgres para o Drive
 8.  API (Ninja): pipe de ingestão (upload → Drive → Postgres)
 9.  API (Ninja): geração de signed URLs para visualização no modal
10.  API (Ninja): download em lote com ZIP + injeção de EXIF
11.  API (Ninja): upload em lote com matching por EXIF + fallback manual
12.  API (Ninja): endpoints do fluxo por fase
13.  API (Ninja): anti-fraude por hash
14.  API (Ninja): limpeza de versões com pending_drive_deletions
15.  API (Ninja): backoff exponencial nas chamadas ao Drive
16.  Nginx: roteamento /admin e /api → backend Django (uvicorn)
17.  Next.js: login + proteção de rotas por role + refresh token silencioso
18.  Next.js: dashboard com seção "Em andamento" + cascata cidade → evento
19.  Next.js: kanban do uploader com verificação de evento no banco
20.  Next.js: kanban do editor com download/upload em lote e modal de desistência
21.  Next.js: interface de vínculo manual (fallback EXIF)
22.  Next.js: kanban do curador com modal comparativo + histórico completo
23.  Next.js: kanban do publicador com aba Histórico
24.  Next.js: indicadores de tempo e gargalo por fase
25.  Testes de fluxo ponta a ponta
26.  Deploy na VPS
```

---

*Workflow Studio · PRD v1.2 · MVP · Junho 2026*
