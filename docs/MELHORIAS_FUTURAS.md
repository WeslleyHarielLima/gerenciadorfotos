# MELHORIAS_FUTURAS.md — Workflow Studio
> Ideias e esquemas de implementação para quando fizer sentido
> Não são pendências do escopo atual — são evoluções opcionais

---

## 1. Calendar verdadeiramente instantâneo (Webhooks / push do Google)

### Situação atual
O `calendar_sync` roda em loop a cada **60s** (worker no `docker-compose.yml`) e há o
botão **"Sincronizar Calendar agora"** no admin. Na prática um evento aparece em ≤1min.

### Quando vale a pena
Se 60s de latência ainda for demais e for preciso reagir **no segundo** em que o evento
muda no Google Calendar.

### Esquema (Google Calendar Push Notifications — `events.watch`)

**Como funciona:** o Google passa a fazer um `POST` no nosso servidor sempre que o
calendário muda, em vez de a gente ficar perguntando.

1. **Registrar o canal** — chamar `events.watch` no calendário, passando:
   - `id`: um UUID que a gente gera
   - `type`: `"web_hook"`
   - `address`: nossa URL pública HTTPS (ex.: `https://SEU_DOMINIO/api/calendar/webhook`)
   - `token`: um segredo nosso (validado nas requisições que chegam)
   - O Google responde com `resourceId` e `expiration`.

2. **Receber a notificação** — endpoint novo `POST /api/calendar/webhook` (sem auth de
   usuário). O Google manda headers, não o conteúdo do evento:
   - `X-Goog-Channel-Token` → validar contra o nosso segredo (rejeitar se diferente)
   - `X-Goog-Resource-State` → `sync` (handshake inicial, ignorar) | `exists` (algo mudou)
   - Em `exists`: chamar o `scripts.calendar_sync.run()` que já existe e retornar `200`
     rápido (idealmente enfileirar/rodar em background — o sync já é leve).

3. **Renovar o canal** — canais de push do Calendar **expiram** (poucos dias). Precisa de
   um job periódico (ex.: worker diário no `docker-compose`) que recria o `watch` antes de
   expirar e atualiza o registro.

4. **Parar o canal** — `channels.stop` quando trocar de canal ou desativar.

### O que mudaria no código
- **Endpoint:** `POST /api/calendar/webhook` (valida `X-Goog-Channel-Token`, dispara o sync).
- **`shared/calendar_client.py`:** adicionar `watch_events(calendar_id, address, token)` e
  `stop_channel(channel_id, resource_id)`.
- **Modelo novo** `CalendarWatchChannel` (channel_id, resource_id, expiration, token) para
  persistir o canal ativo.
- **Script/worker** `calendar_watch_renew.py` (renova diariamente) no `docker-compose.yml`.
- **Manter o polling de 60s como rede de segurança** caso um push se perca.

### Pré-requisitos (infra)
- Endpoint público **HTTPS com certificado válido** (já temos nginx + certs).
- **Verificação de domínio** no Google API Console (o domínio do webhook precisa ser
  verificado/registrado).
- Nenhum escopo OAuth novo além da leitura de Calendar.

### Trade-off
Instantâneo de verdade, mas adiciona o **ciclo de vida do canal** (registro + renovação +
endpoint público) para manter. Com o polling de 60s já no ar, é puramente opcional.

---

## 2. Boards em tempo real (SSE / WebSocket) em vez de polling de 20s

### Situação atual
Editor/curador/publicador usam o hook `useAutoRefresh` (refaz o fetch a cada **20s** e ao
focar a aba). Trabalho novo aparece em ≤20s sem recarregar.

### Evolução possível
Trocar o polling por **Server-Sent Events (SSE)** ou **WebSocket**, empurrando a atualização
no instante em que uma task muda de estado.

### Esquema
- Backend emite um evento quando uma task é criada/muda de status (no `upload-edited`,
  `approve`, `reject`, `publish`, etc.).
- Canal SSE simples por papel/evento (ex.: `GET /api/stream/editor/{event_id}`) que o
  frontend escuta e, ao receber, refaz o fetch (ou recebe o payload direto).
- Como o stack é Django + uvicorn (ASGI), SSE é viável sem infra extra; WebSocket exigiria
  Django Channels.

### Trade-off
Tempo real de verdade, porém mais complexidade (conexões persistentes, reconexão, escala).
O polling de 20s cobre bem o caso de uso atual de poucos usuários simultâneos.

---

## 3. Cloudinary — plano e capacidade

### Situação atual
Plano **grátis**. O retry (`cloudinary_retry`, 10min) e o backfill em lotes
(`cloudinary_backfill --limit`) foram desenhados para respeitar a cota.

### Quando revisitar
Se o volume de fotos crescer a ponto de o backfill/uploads esbarrarem na cota mensal do
plano grátis (transformações + armazenamento + banda). Aí avaliar upgrade de plano ou
reduzir transformações por imagem.

---

## 4. Dashboard admin — métricas de iteração (Mudança 2)

A coluna **"Iterações"** já existe por task no `TaskAdmin` (cadeia `parent_task`). Uma
evolução é uma **visão agregada por arquivo/editor** no dashboard admin (Fase 8): nº médio
de rejeições, editores com mais retrabalho, arquivos mais problemáticos — útil para gestão.

---

*Workflow Studio · MELHORIAS_FUTURAS.md · 21/06/2026*
