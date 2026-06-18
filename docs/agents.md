# AGENTS.md — Workflow Studio

> Guia de padrões para qualquer agente de código (Claude Code, Codex, etc.) trabalhando neste repositório.
> Baseado em [`prd.md`](./prd.md) e [`planejamento.md`](./planejamento.md). Em caso de dúvida ou conflito, o PRD é a fonte da verdade sobre comportamento; o planejamento é a fonte da verdade sobre ordem de execução.

---

## 1. Visão do Sistema

Workflow Studio é um sistema web colaborativo de gerenciamento de fluxo de edição de fotos e vídeos para times de produção. Arquivos percorrem fases sequenciais controladas por status (`uploaded → selected_for_edit → pending_review → approved → published`), e cada usuário só vê o que é relevante para sua fase de trabalho.

## 2. Princípios Invioláveis

Estes princípios não podem ser violados por nenhuma implementação, independentemente da tarefa:

1. **Binários ficam no Google Drive** — o Postgres só guarda metadados, hashes e controle de fluxo. Nenhum binário é persistido no banco ou em disco no servidor.
2. **O Drive é invisível para o usuário** — toda interação acontece na aplicação web, nunca expondo a estrutura do Drive diretamente.
3. **Versões editadas nunca sobrescrevem o original** — sempre criam uma nova linha em `media_versions`.
4. **Anti-fraude por hash** — o hash SHA-256 da versão editada deve diferir do original; hash igual é rejeitado e registrado como `fraud_attempt`.
5. **Soft delete** — desistências e remoções marcam (`deleted_at`/`deleted_by`), nunca apagam linhas.
6. **Frontend nunca acessa o banco direto** — toda leitura/escrita passa pela API (Django Admin ou FastAPI).
7. **Segredos nunca em texto plano no repositório** — senha do Postgres e secrets sensíveis vêm do Google Secret Manager; o `.env` do repo só guarda o *nome* do segredo no GSM.

## 3. Stack Técnica

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | Next.js 14 (TypeScript) + Tailwind CSS | Interface web, kanban, modais |
| Backend API | FastAPI 0.111.0 (Python) | Upload, fluxo, hash, integração Drive/Calendar |
| Backend Admin | Django 5.0.4 + django-unfold 0.35.0 | Painel admin, ORM, autenticação, migrations |
| Banco | PostgreSQL 16 em Docker (porta 5432) | Metadados, hashes, controle de fluxo |
| Storage | Google Drive API v3 | Armazenamento de binários |
| Eventos | Google Calendar API v3 | Fonte dos eventos e metadados |
| Segredos | Google Secret Manager (GSM) | Senha do Postgres e secrets sensíveis |
| Proxy | Nginx (VPS) | Roteamento `/admin` → Django, `/api` → FastAPI |

**Divisão Django/FastAPI:** Django cuida do painel admin (Unfold), ORM/migrations e auth/permissions. FastAPI cuida de endpoints assíncronos de upload/processamento, pipe de ingestão, endpoints do kanban e scripts de sync com Calendar/Drive. Ambos compartilham o mesmo banco via os mesmos models.

## 4. Estrutura de Pastas

```
workflow-studio/
├── backend/
│   ├── django_admin/
│   ├── fastapi_app/
│   ├── scripts/        # calendar_sync.py, drive_cleanup.py, backup.py
│   └── shared/          # secrets.py, drive.py — código compartilhado entre Django e FastAPI
├── frontend/
├── nginx/
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## 5. Roles e Visibilidade

| Role | Responsabilidade |
|---|---|
| `uploader` | Upload em lote das fotos/vídeos brutos do evento |
| `editor` | Seleciona, baixa, edita externamente e devolve a versão editada |
| `curator` | Compara original x editado, aprova ou rejeita com feedback |
| `publisher` | Publica edições aprovadas |
| `admin` | Visão completa de eventos/fases, sem executar tarefas de produção |

Cada usuário só deve ver dados (eventos, cards, endpoints) relevantes à sua fase — nunca implementar telas ou endpoints que exponham dados de outra fase sem checagem de role.

## 6. Modelo de Dados — Regras de Implementação

Tabelas principais: `cities`, `events`, `users`, `media`, `media_versions`, `tasks`, `task_history`, `pending_drive_deletions`, `script_execution_log`, `activity_log`. Esquema completo na seção 8 do [`prd.md`](./prd.md).

- `media` representa sempre o arquivo original; `media_versions` guarda cada versão (`original`, `v1_edited`, `v2_edited`, ...) com seu próprio hash.
- Toda mudança de status relevante registra `last_status_change` em `media` e uma linha em `activity_log`.
- Decisões do curador (aprovação/rejeição) sempre geram uma linha em `task_history`, nunca sobrescrevem a anterior.
- Versões intermediárias aprovadas/rejeitadas vão para `pending_drive_deletions` antes de serem removidas do Drive — nunca deletar direto do Drive de forma síncrona dentro do endpoint que aprova/rejeita.

## 7. Segurança

- O frontend nunca tem credencial de banco; apenas Django e FastAPI acessam o Postgres.
- A senha do Postgres vem do GSM com TTL curto; nunca logar o valor do segredo (verificar isso em toda função que manipula secrets).
- Em desenvolvimento local, segredos ficam em `.env` local **fora do repositório** — o `.env.example` versionado só tem nomes de variáveis e placeholders.
- VPS protegida por firewall, apenas portas necessárias expostas.
- Imagens/vídeos para o curador são servidos via signed URL temporária (expiração 15 min), nunca via link público permanente.
- Toda rota sensível exige checagem de role (`require_role`) — retorna 403 para role incorreta, nunca falha silenciosamente.

## 8. Pipe de Ingestão (regra de implementação)

```
Browser → Next.js → FastAPI (recebe em memória, nunca toca disco)
  → calcula SHA-256 → upload para 01_uploaded no Drive
  → salva metadados + hash no Postgres → descarta binário da memória
```

Nenhuma etapa deste pipe pode persistir o binário em disco no servidor. Se uma implementação precisar gravar em disco temporário, isso é um sinal de que está violando o princípio 1.

## 9. Anti-Fraude (regra de implementação)

Ao receber uma versão editada: calcular SHA-256 → comparar com o hash do original no banco → hash igual = rejeitar com 400 e registrar `fraud_attempt` em `activity_log`; hash diferente = seguir fluxo normal. Validações adicionais: mesmo tipo de arquivo, tamanho ≥ 10% do original, resolução não pode cair drasticamente (imagens).

## 10. Vínculo de Versões — EXIF

- Ao gerar o ZIP de download para o editor, injetar `media_id` no EXIF (`UserComment`, formato `workflow_media_id:{id}`) antes de compactar. Para vídeos, usar metadados de container.
- Ao receber upload de volta, extrair o `media_id` do EXIF para vincular à task correta — funciona independente de renome do arquivo.
- Se o EXIF não estiver presente (software de edição removeu), o arquivo cai na fila de vínculo manual — nunca falhar silenciosamente nem descartar o arquivo.

## 11. Convenções de Workflow do Agente

> Fonte: [`planejamento.md`](./planejamento.md) — regra de ouro para qualquer agente trabalhando neste repo.

**Nunca avance para a próxima tarefa sem que a atual esteja 100% testada e funcionando.** Ciclo obrigatório por tarefa:

```
1. LER o contexto e os requisitos da tarefa (PRD + planejamento)
2. CRIAR o código (backend CRUD + frontend tela quando aplicável)
3. ESCREVER os testes
4. RODAR os testes
5. CORRIGIR até todos passarem
6. VALIDAR manualmente o comportamento na tela
7. Só então MARCAR como concluída e seguir
```

### Princípios de implementação
- **Vertical slice**: cada feature vai do banco até a tela antes da próxima começar.
- Teste primeiro o backend (CRUD), depois conecte a tela, depois teste a integração.
- Commits pequenos e frequentes, um por tarefa concluída, com mensagem clara.
- Nunca deixe código comentado ou `TODO` sem resolver entre tarefas.
- Se uma tarefa revelar problema numa anterior, corrija a anterior antes de continuar.
- Uma tarefa por vez — não pule, não antecipe fases futuras.
- Checkpoints de fase (ver planejamento.md) são obrigatórios: valide o slice inteiro antes de mudar de fase.
- Se algo estiver ambíguo, consulte o PRD antes de assumir comportamento.

### Definição de "concluído"
Uma tarefa só está concluída quando, **todos** os itens abaixo são verdadeiros:
- [ ] Backend implementado e endpoints respondendo
- [ ] Testes automatizados escritos e passando
- [ ] Tela implementada e renderizando (quando aplicável)
- [ ] Integração tela ↔ backend testada manualmente
- [ ] Sem erros no console do navegador
- [ ] Sem erros nos logs do backend
- [ ] Nenhum secret exposto em código ou log

## 12. Ordem de Dependências entre Fases

```
FASE 0 (ambiente)
  └→ FASE 1 (user + login)
       └→ FASE 2 (city/event + dashboard)
            └→ FASE 3 (media + upload) ── precisa Drive
                 └→ FASE 4 (task + editor) ── precisa EXIF
                      └→ FASE 5 (curador)
                           └→ FASE 6 (publicador)
                                └→ FASE 7 (calendar sync) ── precisa Calendar
                                     └→ FASE 8 (admin/indicadores)
                                          └→ FASE 9 (nginx/deploy)
```

Não implemente uma fase posterior antes que os checkpoints das fases anteriores estejam validados — ver detalhes de cada fase/tarefa em [`planejamento.md`](./planejamento.md).

## 13. Quando consultar qual documento

- **Comportamento esperado de uma feature, modelo de dados, regras de negócio:** [`prd.md`](./prd.md).
- **O que implementar agora, em que ordem, e como testar cada tarefa:** [`planejamento.md`](./planejamento.md).
- **Padrões transversais de como trabalhar neste repo (este arquivo):** `agents.md`.
