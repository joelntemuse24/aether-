# Technical Design Document — Aether (Current State)

*Source of truth: repository `src/`, `package.json`, `.env.example`, `next.config.ts`. Excludes the unrelated `Match website layout/` tree. Documents only what exists in code.*

---

## System Overview

**Aether** is a Next.js 15 (App Router) AI chat application with two access modes: **Aether Cloud** (default — server-side hosted keys; curated Claude / GPT / long-tail catalog) and **Bring your own key** (BYOK — browser-held provider keys). The Next.js server proxies chat to LLM providers and runs tools. Optional Auth.js sign-in plus Postgres (`DATABASE_URL` Neon or `AETHER_PGLITE=1`) enables cloud conversation sync, curated memory, projects, persisted artifacts, and harness run records. BYOK keys are never stored in the application database. Unsigned / no-DB users keep history and local memory in `localStorage` (`aether:` prefix).

---

## Current Architecture

### Runtime & stack

| Layer | Choice (as coded) |
|--------|-------------------|
| Framework | Next.js `15.5.21`, React `19`, App Router |
| Chat UI | `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` |
| LLM I/O | Vercel AI SDK `ai` + `@ai-sdk/openai` / `@ai-sdk/anthropic` |
| Auth | `next-auth` v5 beta (`src/auth.ts`) |
| ORM / DB | Drizzle + Neon HTTP **or** `@electric-sql/pglite` |
| Styling | Tailwind CSS 4 |
| Node | `engines.node >= 20` |

No `middleware.ts`. Chat UI for `/` and `/c/[threadId]` is rendered by `AppShell` inside shared providers; route pages themselves return `null`.

### Component breakdown

```
src/app/layout.tsx
  SessionProvider → ThemeProvider
    └─ (chat)/layout.tsx → ChatProviders
         SettingsProvider
           AttachmentsProvider
             DriveProvider
               ProjectsProvider
                 HarnessProvider
                   RuntimeProvider          ← useChat → POST /api/chat
                     ThreadUrlSync
                     ArtifactProvider
                       KeyboardShortcuts
                       AppShell             ← Sidebar + Thread + Settings + Drive modal
```

| Concern | Primary modules |
|---------|-----------------|
| Chat transport & thread runtime | `src/providers/runtime-provider.tsx` |
| Harness classify / clarify / budgets | `src/lib/harness/*`, `src/providers/harness-provider.tsx` |
| Tool registry | `src/lib/harness/tool-registry.ts`, `src/lib/tools.ts` |
| Memory | `src/lib/memory/*`, `api/memory/*`, Settings panel |
| Projects | `src/lib/projects/*`, `api/projects/*`, sidebar |
| Artifacts | `src/lib/artifacts/*`, `api/artifacts/*`, artifact panel + sidebar list |
| Thread list / history adapter | `src/lib/local-thread-adapter.tsx` |
| URL ↔ active thread | `src/components/thread-url-sync.tsx`, `src/lib/thread-url.ts` |
| Settings / access mode / headers | `src/lib/settings.ts`, `src/providers/settings-provider.tsx` |
| Hosted routing (Aether Cloud) | `src/lib/hosted/*`, `GET /api/hosted/status` |
| Web search | `src/lib/web-search.ts` |
| URL fetch safety | `src/lib/connectors/url-safety.ts` |
| Drive | `src/lib/drive-session.ts`, `src/lib/connectors/web-and-drive.ts`, `api/drive/*` |
| Cloud conversations | `src/lib/db/*`, `src/lib/conversations/*`, `api/conversations/*` |
| Voices | `src/lib/voice.ts` |
| Models list (BYOK OpenRouter public) | `src/lib/models.ts` |

### Data flow — chat turn

1. User picks **Aether Cloud** (default) or **Bring your own key** in Settings → `localStorage` key `aether:settings:v1` (`accessMode`).
2. Composer send classifies via `POST /api/harness/classify` (unless skipped after clarify). May show clarify cards; then arms `HarnessChatContext` (`intent`, `depth`, `runId`, `clarifications`, `planSteps`).
3. Attachments resolve from an in-memory `Map`; text stubs → `textPrefix`; images/files with data URLs → message `file` parts.
4. Client `AssistantChatTransport` `POST`s `/api/chat` with `x-access-mode`, `x-model`, `x-tools`. BYOK also sends `x-api-key`, `x-provider`, `x-base-url`.
5. Body includes `messages`, optional `model`, `system` (voice, ≤ 8000), `attachments[]`, `textPrefix`, `harness`, `memoryContext`, `projectId`, `conversationId`.
6. Server: hosted mode resolves upstream via `src/lib/hosted/router.ts` (**503** if cloud unconfigured); BYOK validates API key (**401** if missing). Injects harness addendum (including `planSteps`), memory (server cloud or client local when no cloud), and project instructions; builds tools via `buildToolRegistry`; `stopWhen: stepCountIs(budget.maxSteps)` where budgets are shallow=2 / standard=8 / deep=16; streams (`maxOutputTokens: 8192`, `maxDuration: 60`). Marks harness run `done` on finish when applicable.
7. Client tool: `execute_python` (Pyodide). Server tools (gated): `web_search`, `fetch_url` (SSRF-hardened), `create_artifact` (acks + may persist), `memory_search` / `memory_write` (signed-in + DB), `drive_search` / `drive_read` (Drive connected).
8. History adapter writes format repo to `localStorage` or `PUT /api/conversations/[id]/messages` when cloud mode is active.

### Data flow — auth & Drive

1. Sign-in: OAuth (Google/GitHub/Apple when env set) or email magic link (`POST /api/auth/email` → JWT → `/auth/verify` → Credentials `email-magic`).
2. Session: JWT strategy, 30-day `maxAge`; `user.id` from id or email.
3. Drive connect: authenticated `GET /api/drive/connect` → Google OAuth (readonly) → callback stores httpOnly cookie `aether.drive` → `/?drive_connected=1` or `/?connect=drive`.
4. Download: `POST /api/drive/download` returns attachment-shaped payload under size caps. Tools `drive_search` / `drive_read` use the same token.

### Data flow — conversation URLs & cloud

- `/` = new chat; `/c/<threadId>` = that conversation (`ThreadUrlSync`).
- Cloud when `isCloudDbConfigured()` **and** signed in (`GET /api/conversations/status` → `{ configured, signedIn, cloud }`).
- On sign-in with local chats: `SyncLocalChatsBanner` can migrate then clear local threads.

### Integration points

| External system | How used |
|-----------------|----------|
| Aether Cloud (hosted) | Server keys: Claude/GPT specialty gateways + OpenRouter long-tail/failover |
| OpenRouter / OpenAI-compatible / Anthropic | BYOK chat completions streaming via user-supplied key |
| `GET /api/hosted/status` | Hosted availability + curated catalog (no vendor/key leakage) |
| OpenRouter `GET /api/v1/models` | BYOK model picker; cache `aether:models-cache:v2` |
| Resend | Optional magic-link email |
| Google OAuth + Drive API | Sign-in + readonly browse/download + Drive tools |
| GitHub / Apple OAuth | Sign-in only (when env set) |
| Wikipedia / DuckDuckGo HTML / Instant Answer / optional Brave (+ IR enrichment) | `web_search` |
| Neon Postgres or local PGlite | Optional cloud store |

### App routes (as implemented)

| URL / path | File |
|------------|------|
| `/` | `src/app/(chat)/page.tsx` |
| `/c/[threadId]` | `src/app/(chat)/c/[threadId]/page.tsx` |
| `/auth/signin` | `src/app/auth/signin/page.tsx` |
| `/auth/verify` | `src/app/auth/verify/page.tsx` |
| Auth APIs | `src/app/api/auth/*` |
| `POST /api/chat` | `src/app/api/chat/route.ts` |
| `POST /api/harness/classify` | `src/app/api/harness/classify/route.ts` |
| Conversations APIs | `src/app/api/conversations/*` |
| `GET/POST /api/memory`, `DELETE /api/memory/[id]` | memory routes |
| `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/[id]` | projects routes |
| `GET/POST/DELETE /api/artifacts` | artifacts route |
| Drive routes | `src/app/api/drive/*/route.ts` |

There is no `/settings` route — Settings is a dialog. Drive connect deep-link uses `/?connect=drive`.

---

## Data & Interface Models

### Client settings (`AppSettings`)

Persisted at `aether:settings:v1`: `accessMode` (`hosted` \| `byok`), provider keys, `baseURL`, `model`, `enableTools`, `voice` (`default` \| `literary` \| `socratic` \| `concise`), etc. Defaults: `accessMode: "hosted"`, model `claude-sonnet-4`, provider `openrouter` (BYOK), `enableTools: true`, `voice: "literary"`. Legacy installs with a saved key and no `accessMode` migrate to `byok`.

### Hosted routing

- Env: `OPENROUTER_API_KEY`; optional `AETHER_HOSTED_CLAUDE_BASE_URL` / `AETHER_HOSTED_CLAUDE_API_KEY` (default base `https://buzzai.cc/v1`); optional `AETHER_HOSTED_GPT_BASE_URL` / `AETHER_HOSTED_GPT_API_KEY` (default base `https://api.icodeeasy.cc/v1`).
- Family routing: `claude-*` → Claude gateway then OpenRouter; `gpt-*` / `o*` → GPT gateway then OpenRouter; other catalog ids → OpenRouter only.
- Product UI brands models as Aether Cloud — does not surface OpenRouter or gateway vendor names to end users.

### Local blobs

- `aether:threads`, `aether:messages:<remoteId>`, `aether:active-thread`
- `aether:memory:v1` — local curated memory when cloud off
- `aether:active-project` — selected project id
- Theme/accent/sidebar/models-cache keys as before

### Database schema (Drizzle + runtime `CREATE TABLE IF NOT EXISTS`)

Cloud tables (when DB configured):

| Table | Purpose |
|-------|---------|
| `conversations` / `conversation_messages` | Chat list + message repos |
| `agent_runs` / `agent_run_events` | Harness classify/run lifecycle |
| `memory_records` | Curated long-term memory |
| `projects` | Project title + instructions (+ unused `pinned_file_ids`) |
| `artifacts` | Persisted artifact content |

Configured via `DATABASE_URL` or `AETHER_PGLITE=1` (dir `./.data/aether-pglite`).

### Chat API (`POST /api/chat`)

- **Auth:** none (API key header only).
- **Headers:** `x-api-key` (required), `x-provider`, `x-base-url`, `x-model`, `x-tools`.
- **Body:** `messages`, `model?`, `system?`, `attachments?`, `textPrefix?`, `harness?`, `memoryContext?`, `projectId?`, `conversationId?`.
- **Tools (when tools on):** see tool registry; `fetch_url` rejects private/link-local/metadata hosts and validates DNS + redirects (`url-safety.ts`).
- **Agent-loop efficiency** (`src/lib/harness/loop-efficiency.ts`, inspired by [ChatGPT harness practice](https://blog.bytebytego.com/p/how-chatgpt-optimizes-its-agent-loop)):
  - **Stable prefixes:** system prompt order is tools contract → harness → voice → memory/project; tools sent with a fixed `toolOrder`.
  - **Deferred discovery:** core tools (`execute_python`, `web_search`, `fetch_url`, `create_artifact`) are always active; memory/Drive stay out of the prompt until `tool_search` unlocks them via `prepareStep` / `activeTools`.
  - **Search quotas:** hard per-turn `web_search` caps by depth (Quick 1 / Standard 2 / Deep 3) plus near-duplicate query rejection.
  - **Not in Aether (provider/infra):** persistent WebSockets + `previous_response_id`, delta-only tokenization, speculative decoding, prefill/decode split. **Deferred product work:** Code Mode (scripted multi-tool fan-out in a sandbox).
- **Search order:** Brave if `BRAVE_SEARCH_API_KEY` → DuckDuckGo HTML → Wikipedia (with IR/primary-source enrichment for current-facts queries) → DuckDuckGo Instant Answer.

### Behavior matrix (summary)

| Surface | Unsigned | Signed, no DB | Signed + DB |
|---------|----------|---------------|-------------|
| Memory Settings | localStorage | localStorage | `/api/memory` |
| memory_* tools | Off | Off | On |
| Prompt memory | Client `memoryContext` | Client | Server cloud (no local fallback) |
| Memory migrate | — | — | `/api/memory/migrate` + `SyncLocalMemory` (clear only if `skipped===0`) |
| Projects / artifacts APIs | 503 | 503 | On |
| Project ↔ chat | Session picker | Session picker | `custom.projectId` bind/restore/inherit |
| Artifacts | Session panel | Session | Persist + sidebar reopen; panel edits debounce-save when `persisted` |
| Drive tools | Off | On if Drive cookie | Same |
| fetch_url | On if tools; SSRF gate | Same | Same |
| Classify | Heuristic shallow skip; else model | Same | Same; model path creates `agent_runs` |
| Harness runs | No DB rows | No rows | Classify → acting/verifying → `done` |

---

## Identified Technical Debt

*Only issues still visible after audit hardening + polish.*

1. **`/api/chat` is unauthenticated and unbounded** — No session check, no rate limit, no explicit body size limit at the route.
2. **BYOK keys in plaintext `localStorage`**.
3. **Shared dev auth secret fallback** when `AUTH_SECRET` unset.
4. **`allowDangerousEmailAccountLinking: true`** on OAuth providers.
5. **Conversation message `PUT` lacks size/count caps**.
6. **`pinned_file_ids` unused** on projects; conversation list does not badge the bound project.
7. **Prompt injection via memory / project instructions** — user/model text enters the system prompt by design; framing only.
8. **`fetch_url` DNS TOCTOU / rebinding** — hostname resolved then fetched by name (no IP pinning).
9. **Shallow classify skip** creates a client `runId` without an `agent_runs` row.
10. **Keyless `web_search` quality** — DDG HTML is often captcha’d from cloud IPs; Wikipedia+IR enrichment covers many company FY queries but is not a general web index. Brave remains the upgrade path.
11. **No Next.js middleware** — per-handler auth.
12. **Pre-existing lint** — `react-hooks/exhaustive-deps` in `model-picker.tsx`.
13. **Example-only env vars** in `.env.example` for provider keys — not read by `src/` for chat.
14. **No Code Mode yet** — multi-tool fan-out still costs one model round-trip per step; scripted tool programs would shrink context and latency for gather-heavy turns.
15. **Stateless BYOK HTTP** — each provider call resends full history; no harness WebSocket / incremental `previous_response_id` (provider-dependent).

---

## Security & Scaling Posture

### Authentication & authorization

| Surface | Control |
|---------|---------|
| Chat | `x-api-key` required; **no** login |
| Conversations / memory / projects / artifacts | Session + DB configured |
| Drive | Session; Drive token `userId` must match |
| Memory/artifact upserts | Owned-row update; foreign id → **403** |
| `fetch_url` | Public http(s) only; DNS + IP blocklist; max 3 redirects |

### What is / is not stored server-side

| Stored on server | Not stored on server |
|------------------|----------------------|
| Auth session JWT | BYOK API keys |
| Drive OAuth tokens (httpOnly cookie) | Unsigned / no-DB chat history |
| Conversations, memory, projects, artifacts, harness runs (if DB + signed in) | In-memory attachment payload `Map` |

### Production configuration dependencies

Real `AUTH_SECRET`; for cloud `DATABASE_URL`; Resend for email without `devLink`; OAuth/Drive client ids/secrets; optional `BRAVE_SEARCH_API_KEY`. Chat still requires the **user’s** provider key in the browser.

---

*End of TDD — current implementation only.*
