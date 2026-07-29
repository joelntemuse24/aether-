# Technical Design Document — Aether (Current State)

*Source of truth: repository `src/`, `package.json`, `.env.example`, `next.config.ts`. Excludes the unrelated `Match website layout/` tree. Documents only what exists in code.*

---

## System Overview

**Aether** is a Next.js 15 (App Router) bring-your-own-key (BYOK) AI chat application: the browser holds provider API keys; the Next.js server proxies chat to LLM providers and runs tools. Optional Auth.js sign-in plus Postgres (`DATABASE_URL` Neon or `AETHER_PGLITE=1`) enables cloud conversation sync, curated memory, projects, persisted artifacts, and harness run records. BYOK keys are never stored in the application database. Unsigned / no-DB users keep history and local memory in `localStorage` (`aether:` prefix).

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
| Settings / BYOK headers | `src/lib/settings.ts`, `src/providers/settings-provider.tsx` |
| Web search | `src/lib/web-search.ts` |
| URL fetch safety | `src/lib/connectors/url-safety.ts` |
| Drive | `src/lib/drive-session.ts`, `src/lib/connectors/web-and-drive.ts`, `api/drive/*` |
| Cloud conversations | `src/lib/db/*`, `src/lib/conversations/*`, `api/conversations/*` |
| Voices | `src/lib/voice.ts` |
| Models list (OpenRouter public) | `src/lib/models.ts` |

### Data flow — chat turn

1. User configures provider + API key in Settings → `localStorage` key `aether:settings:v1`.
2. Composer send classifies via `POST /api/harness/classify` (unless skipped after clarify). May show clarify cards; then arms `HarnessChatContext` (`intent`, `depth`, `runId`, `clarifications`, `planSteps`).
3. Attachments resolve from an in-memory `Map`; text stubs → `textPrefix`; images/files with data URLs → message `file` parts.
4. Client `AssistantChatTransport` `POST`s `/api/chat` with headers `x-api-key`, `x-provider`, `x-base-url`, `x-model`, `x-tools`.
5. Body includes `messages`, optional `model`, `system` (voice, ≤ 8000), `attachments[]`, `textPrefix`, `harness`, `memoryContext`, `projectId`, `conversationId`.
6. Server validates API key (**401** if missing), injects harness addendum (including `planSteps`), memory (server cloud or client local when no cloud), and project instructions; builds tools via `buildToolRegistry`; `stopWhen: stepCountIs(budget.maxSteps)` where budgets are shallow=2 / standard=8 / deep=16; streams (`maxOutputTokens: 8192`, `maxDuration: 60`). Marks harness run `done` on finish when applicable.
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
| OpenRouter / OpenAI-compatible / Anthropic | Chat completions streaming via user-supplied key |
| OpenRouter `GET /api/v1/models` | Client model picker; cache `aether:models-cache:v2` |
| Resend | Optional magic-link email |
| Google OAuth + Drive API | Sign-in + readonly browse/download + Drive tools |
| GitHub / Apple OAuth | Sign-in only (when env set) |
| Wikipedia / DuckDuckGo Instant Answer / optional Brave | `web_search` |
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

Persisted at `aether:settings:v1`: provider keys, `baseURL`, `model`, `enableTools`, `voice` (`default` \| `literary` \| `socratic` \| `concise`), etc. Defaults: provider `openrouter`, `enableTools: true`, `voice: "literary"`.

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
- **Search order:** Brave if `BRAVE_SEARCH_API_KEY` → Wikipedia → DuckDuckGo Instant Answer.

### Behavior matrix (summary)

| Surface | Unsigned | Signed, no DB | Signed + DB |
|---------|----------|---------------|-------------|
| Memory Settings | localStorage | localStorage | `/api/memory` |
| memory_* tools | Off | Off | On |
| Prompt memory | Client `memoryContext` | Client | Server cloud (no local fallback) |
| Projects / artifacts APIs | 503 | 503 | On |
| Drive tools | Off | On if Drive cookie | Same |
| fetch_url | On if tools on | On | On |
| Harness classify/budgets | Yes | Yes | Yes + `agent_runs` |

---

## Identified Technical Debt

*Only issues still visible after audit hardening.*

1. **`/api/chat` is unauthenticated and unbounded** — No session check, no rate limit, no explicit body size limit at the route.
2. **BYOK keys in plaintext `localStorage`**.
3. **Shared dev auth secret fallback** when `AUTH_SECRET` unset.
4. **`allowDangerousEmailAccountLinking: true`** on OAuth providers.
5. **Conversation message `PUT` lacks size/count caps**.
6. **Local memory does not auto-migrate** into cloud on sign-in.
7. **Projects are not bound to conversations** — active project is a client selection (`aether:active-project`); `pinned_file_ids` unused.
8. **Classify-every-send latency/cost** — no shallow skip / heuristics-first path in the composer.
9. **Prompt injection via memory / project instructions** — user/model text enters the system prompt by design; framing only.
10. **New tools mostly use generic tool UI** (memory/drive/fetch).
11. **Keyless `web_search` quality ceiling** without Brave.
12. **No Next.js middleware** — per-handler auth.
13. **Pre-existing lint** — `react-hooks/exhaustive-deps` in `model-picker.tsx`.
14. **Example-only env vars** in `.env.example` for provider keys — not read by `src/` for chat.

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
