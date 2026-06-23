# Workflow Studio — Fluxo da Aplicação

> **Documento de apresentação** — visão funcional e técnica do sistema de gerenciamento de fluxo de edição de fotos e vídeos.
> Público-alvo: Product Owner e time. Atualizado em junho/2026.

---

## 1. O que é o sistema

O **Workflow Studio** é uma plataforma que organiza, de ponta a ponta, a **produção de fotos e vídeos de eventos**. Cada arquivo percorre uma **esteira de produção** com fases sequenciais e responsáveis distintos:

```
UPLOAD  →  EDIÇÃO  →  REVISÃO (curadoria)  →  PUBLICAÇÃO
```

O objetivo é garantir que **nenhum arquivo se perca**, que **cada etapa tenha um responsável claro**, que exista **controle de qualidade** (curadoria aprova ou devolve) e que todo o material aprovado seja **publicado de forma rastreável** no Google Drive.

### Problemas que resolve
- **Falta de controle:** hoje fotos circulam por WhatsApp/pastas soltas sem saber o que já foi editado, revisado ou publicado.
- **Retrabalho e perda:** sem rastreio, arquivos voltam para edição sem histórico do motivo.
- **Gargalos invisíveis:** ninguém sabe onde o fluxo está travado. O painel de administração mostra exatamente o que está parado e há quanto tempo.
- **Fraude/erro humano:** o sistema detecta quando um "editado" é, na verdade, o arquivo original sem alteração.

---

## 2. Tecnologias utilizadas

| Camada | Tecnologia | Para quê |
|---|---|---|
| **Backend (API)** | Django 5 + Django Ninja + uvicorn (ASGI) | Regras de negócio, API REST, autenticação |
| **Painel administrativo** | django-unfold | Gestão de dados e usuários (Django Admin estilizado) |
| **Frontend (interface)** | Next.js 14 + TypeScript + Tailwind CSS | Telas que cada papel usa no dia a dia |
| **Banco de dados** | PostgreSQL 16 | Persistência de eventos, mídias, tarefas, histórico |
| **Armazenamento de arquivos** | Google Drive API v3 | Guarda os arquivos originais e publicados |
| **Origem de eventos** | Google Calendar API v3 | Eventos são criados automaticamente a partir da agenda |
| **Miniaturas / previews** | Cloudinary | Gera as miniaturas exibidas nas telas |
| **Autenticação** | JWT (PyJWT) | Login com token de acesso + refresh |
| **Proxy / entrada web** | Nginx | Porta de entrada única em produção (HTTP/HTTPS) |
| **Empacotamento** | Docker + Docker Compose | Sobe todos os serviços de forma padronizada |

**Bibliotecas-chave do backend:** Pillow e piexif (manipulação de imagem/EXIF), google-api-python-client + google-auth-oauthlib (integração Google), cloudinary, psycopg (PostgreSQL).

---

## 3. Arquitetura — como as peças conversam

```
                            ┌──────────────────┐
                            │  Google Calendar │  (eventos da agenda)
                            └────────┬─────────┘
                                     │ sync a cada 60s
                                     ▼
  ┌───────────┐   HTTPS    ┌───────────────────┐    ┌──────────────┐
  │  Usuário  │ ─────────▶ │   Nginx (proxy)   │ ─▶ │  Frontend    │
  │ (navegador)│           └───────────────────┘    │  Next.js 14  │
  └───────────┘                     │               └──────┬───────┘
                                     │   chamadas API       │
                                     ▼                      ▼
                            ┌───────────────────────────────────┐
                            │  Backend  Django Ninja (uvicorn)  │
                            │  - autenticação JWT               │
                            │  - regras de fluxo / tarefas      │
                            └───┬───────────┬───────────┬───────┘
                                │           │           │
                     ┌──────────▼──┐  ┌─────▼──────┐  ┌─▼──────────┐
                     │ PostgreSQL  │  │ Google     │  │ Cloudinary │
                     │ (dados)     │  │ Drive      │  │ (thumbs)   │
                     └─────────────┘  │ (arquivos) │  └────────────┘
                                      └────────────┘

  Serviços automáticos (rodando em segundo plano):
  • calendar_sync   — importa eventos da agenda           (a cada 60s)
  • cloudinary_retry— reprocessa miniaturas que falharam  (a cada 10min)
  • drive_cleanup   — apaga versões intermediárias        (a cada 30min)
  • backup          — backup do banco PostgreSQL          (a cada 24h)
```

**Resumo:** o usuário acessa pelo navegador → Nginx encaminha para o **Frontend** → o Frontend conversa com o **Backend** via API → o Backend grava os dados no **PostgreSQL**, guarda os arquivos no **Google Drive** e as miniaturas no **Cloudinary**. Eventos nascem automaticamente do **Google Calendar**.

---

## 4. Papéis (perfis de usuário)

Cada usuário tem **um papel**, que define o que ele vê e pode fazer. Os papéis representam as etapas da esteira:

| Papel | Responsabilidade | O que faz na prática |
|---|---|---|
| **Uploader** | Entrada de material | Envia as fotos/vídeos brutos do evento para o sistema. |
| **Editor** | Edição | Baixa o material bruto, edita por fora (Photoshop/Canva/etc.) e devolve a versão editada. |
| **Curador** | Controle de qualidade | Compara original × editada e **aprova**, **devolve para correção** ou **rejeita definitivamente**. |
| **Publicador** | Publicação | Publica o material aprovado (move para a pasta de publicados no Drive). |
| **Admin** | Supervisão | Acompanha gargalos, saúde dos serviços e o andamento geral. |

> O papel é definido no cadastro do usuário (painel admin). O login redireciona cada pessoa para o painel correto do seu papel.

---

## 5. O ciclo de vida de um arquivo

Todo arquivo (mídia) caminha por **estados**. O diagrama abaixo mostra o caminho feliz e os desvios (devolução e rejeição):

```
                   ┌─────────────┐
   Uploader ──────▶│  ENVIADO    │ (uploaded)
   envia           └──────┬──────┘
                          │ Editor baixa para editar
                          ▼
                   ┌─────────────┐
                   │ EM EDIÇÃO   │ (selected_for_edit)
                   └──────┬──────┘
                          │ Editor envia a versão editada
                          ▼
                   ┌─────────────┐         devolve p/ correção
                   │ AGUARDANDO  │◀───────────────────────┐
                   │  REVISÃO    │ (pending_review)        │
                   └──────┬──────┘                         │
              ┌───────────┼───────────────┐               │
       aprova │           │ rejeita        │ devolve       │
              ▼           ▼ definitivo     └──────────────▶│ (volta para EM EDIÇÃO,
       ┌─────────────┐  ┌──────────────┐                     com o motivo anexado)
       │  APROVADO   │  │  REJEITADO   │ (rejected_final)
       └──────┬──────┘  └──────────────┘
              │ Publicador publica
              ▼
       ┌─────────────┐
       │  PUBLICADO  │ (published)
       └─────────────┘
```

| Estado (técnico) | Significado | Quem age em seguida |
|---|---|---|
| `uploaded` | Material bruto recém-enviado | Editor |
| `selected_for_edit` | Reservado e baixado por um editor | Editor (envia editada) |
| `pending_review` | Versão editada aguardando curadoria | Curador |
| `approved` | Aprovado pela curadoria | Publicador |
| `published` | Publicado no Drive | — (fim do fluxo) |
| `rejected_final` | Rejeitado definitivamente | — (será descartado) |

**Cada movimento gera uma "Tarefa"** atribuída ao próximo responsável, e cada decisão fica registrada no histórico (quem fez, quando, e o motivo).

---

## 6. Passo a passo por papel

### 6.1 Uploader — enviar material
1. Acessa **Início → escolhe a Cidade → escolhe o Evento**.
2. Clica em **"Enviar fotos/vídeos"**.
3. **Arrasta os arquivos** (ou clica para selecionar). Formatos aceitos: JPEG, PNG, WEBP, HEIC, MP4, MOV, AVI, MKV.
4. Clica em **"Enviar N arquivos"** — o envio ocorre em lotes, com barra de progresso.
5. Abaixo, a **galeria** mostra tudo que já foi enviado; é possível **excluir** um arquivo enquanto ele ainda não entrou em edição.
6. Um **contador** mostra quantos arquivos já foram enviados e quantos aguardam edição.

### 6.2 Editor — editar (quadro Kanban com 3 colunas)
O editor trabalha em um **quadro Kanban** dividido em **Disponíveis → Editando → Enviadas**.

**Coluna "Disponíveis"** (material bruto à espera):
- Lista as mídias com miniatura, nome e tamanho.
- Permite **marcar várias** (caixinhas) e **"Baixar"** todas de uma vez em um arquivo `.zip`.
- Ao baixar, cada foto **vira uma tarefa individual** e some das "Disponíveis", indo para "Editando".

**Coluna "Editando"** (tarefas do editor):
- Cada foto reservada é um **card independente**.
- O editor edita o arquivo **por fora** (Photoshop, Lightroom, Canva...) e volta ao sistema.
- Cada card tem o botão **"Enviar"**: o editor escolhe **uma** foto editada por vez, confere no **preview comparativo (original × editada)** e confirma. **O envio é individual, por tarefa.**
- Se a curadoria devolveu a foto, o card aparece com **borda vermelha** e o **motivo da devolução** em destaque.
- Botão **"Desistir"**: devolve a foto ao pool, registrando o motivo (problema técnico, arquivo errado, duplicado, pedido do cliente, outro).

**Coluna "Enviadas"** (acompanhamento):
- Mostra o que já foi enviado, com o status atual (aguardando revisão / aprovada / publicada). Somente leitura.

### 6.3 Curador — controle de qualidade
1. Abre a **fila de revisão** (grade de cards a revisar).
2. Clica em um card → abre o painel com **comparação lado a lado**: original × editada (ambas ampliáveis em tela cheia).
3. Vê o **histórico de versões** (quem editou, quando, tamanho).
4. Toma **uma das três decisões**:
   - **Aprovar** → a foto vai para o Publicador.
   - **Devolver para correção** → volta ao editor com um **comentário obrigatório** explicando o que ajustar.
   - **Rejeitar definitivamente** → descarta a foto (ação irreversível, exige confirmação e motivo).

### 6.4 Publicador — publicar
1. Aba **"Para publicar"**: grade com as fotos aprovadas.
2. Clica em **"Publicar"** → confirma no modal (a ação **move o arquivo** para a pasta de publicados no Drive e é **irreversível**).
3. Aba **"Histórico"**: lista o que já foi publicado, **agrupado por data**.

### 6.5 Admin — supervisão
- **Saúde dos serviços:** cartões de Calendar Sync, Backup e Drive Cleanup com a última execução e status (OK/erro).
- **Gargalos:** lista de arquivos **parados além do tempo limite** em cada fase, com responsável e há quantas horas estão travados.
- **Eventos:** contadores por fase (enviado, em edição, em revisão, aprovado, publicado, rejeitado), com filtro por cidade.

---

## 7. Recursos de segurança e anti-fraude

Um diferencial do sistema é **garantir que o arquivo editado é realmente uma edição** do original certo — mesmo quando o editor usa ferramentas externas que removem metadados.

| Mecanismo | O que faz |
|---|---|
| **Identificação por EXIF** | Ao baixar, o sistema grava o "código da mídia" nos metadados do arquivo. Na volta, identifica automaticamente a qual foto pertence. |
| **Marca d'água invisível** | Um identificador é embutido **nos próprios pixels** (técnica LSB, com redundância). Sobrevive a recompressão e a ferramentas que apagam metadados. |
| **Hash perceptual (dHash)** | "Impressão digital visual" da imagem. Mesmo sem EXIF e com nome trocado, o sistema reencontra a foto de origem por semelhança visual. |
| **Detecção de fraude (SHA-256)** | Se o "editado" tiver **conteúdo idêntico ao original**, é barrado como tentativa de fraude (ninguém editou de fato). |
| **Validação de tamanho** | Arquivos suspeitos (menos de 10% do tamanho original) são recusados. |
| **Autenticação JWT por papel** | Cada rota da API exige login válido e o **papel correto** (um editor não acessa funções de curador, etc.). |

A identificação na volta segue a ordem: **EXIF → nome do arquivo → semelhança visual (hash perceptual)**, tornando o reconhecimento bastante robusto.

---

## 8. Automações (rodando sozinhas em segundo plano)

| Serviço | Frequência | Função |
|---|---|---|
| **calendar_sync** | a cada 60s | Importa eventos do Google Calendar, cria a Cidade/Evento e a estrutura de pastas no Drive. |
| **cloudinary_retry** | a cada 10 min | Reenvia ao Cloudinary as miniaturas que falharam no envio imediato. |
| **drive_cleanup** | a cada 30 min | Remove do Drive as versões intermediárias e arquivos rejeitados (libera espaço). |
| **backup** | a cada 24h | Faz backup do banco PostgreSQL, compacta e envia ao Drive (retenção de 30 dias). |

Há ainda os scripts de configuração inicial (executados uma vez): `authorize_drive.py` e `authorize_calendar.py`, que autorizam o acesso do sistema ao Google Drive e ao Google Calendar.

---

## 9. Manual de utilização básico

### Acessos (ambiente local de desenvolvimento)
| O quê | Endereço | Credenciais |
|---|---|---|
| **Aplicação (login)** | http://localhost:3000 | usuário do seu papel |
| **Painel administrativo** | http://localhost:8000/admin | `admin` / `admin123` |
| **Documentação da API** | http://localhost:8000/api/docs | — |

### Primeiro acesso
1. Abra **http://localhost:3000** e faça login com usuário e senha.
2. O sistema leva você ao **painel do seu papel**.
3. Na home, você vê **suas tarefas pendentes** e as **cidades/eventos** disponíveis.

### Como criar usuários e definir papéis (Admin)
1. Acesse **http://localhost:8000/admin** com a conta de administrador.
2. Vá em **Usuários → Adicionar**.
3. Defina **usuário, senha** e o **papel** (uploader, editor, curador, publicador ou admin).
4. Salve. A pessoa já pode logar na aplicação com o painel do papel escolhido.

### Roteiro de demonstração (ponta a ponta)
1. **Uploader** envia 3 fotos de um evento.
2. **Editor** abre o Kanban, baixa as 3 (viram 3 tarefas), edita por fora e **envia uma de cada vez**.
3. **Curador** compara original × editada e **aprova** 2 e **devolve 1** para correção.
4. **Editor** vê a devolvida (com o motivo), corrige e reenvia.
5. **Curador** aprova a corrigida.
6. **Publicador** publica as aprovadas → elas vão para a pasta de publicados no Drive.
7. **Admin** abre o painel e vê os contadores atualizados e nenhum gargalo.

---

## 10. Como subir a aplicação

A inicialização detalhada (variáveis de ambiente, credenciais Google, Cloudinary) está em **[inicializacao.md](inicializacao.md)**. Resumo:

**Desenvolvimento (tudo de uma vez):**
```bash
./dev.sh
```
Esse script sobe o PostgreSQL (Docker), o backend (uvicorn na porta 8000), o frontend (Next.js na porta 3000) e o sincronizador de calendário.

**Produção (Docker Compose):**
```bash
docker compose up -d
```
Sobe todos os serviços: banco, backend, frontend, Nginx e as automações (calendar_sync, cloudinary_retry, drive_cleanup, backup).

**Checklist mínimo antes de rodar:** `.env` na raiz preenchido (banco, Django, Google, Cloudinary), `frontend/.env.local` com a URL da API, tokens do Google em `docs/`, Postgres saudável, migrações aplicadas e superusuário criado. Detalhes em [inicializacao.md](inicializacao.md).

---

## 11. Glossário rápido

| Termo | Significado |
|---|---|
| **Mídia** | Um arquivo (foto ou vídeo) dentro de um evento. |
| **Versão** | Cada estado de uma mídia: original, editada, aprovada, rejeitada. |
| **Tarefa** | Uma unidade de trabalho atribuída a um papel (editar, revisar, publicar). |
| **Pool / Disponíveis** | Conjunto de mídias brutas ainda não reservadas por nenhum editor. |
| **Devolução (com retorno)** | Curador reprova mas pede correção; volta ao editor com motivo. |
| **Rejeição final** | Curador descarta a mídia em definitivo (irreversível). |
| **Hash perceptual** | "Impressão digital visual" usada para reconhecer a foto de origem. |
| **Gargalo** | Arquivo parado em uma fase além do tempo limite configurado. |

---

*Documento gerado para apresentação ao Product Owner — Workflow Studio.*
