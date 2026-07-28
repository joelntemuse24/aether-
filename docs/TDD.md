# Technical Design Document — Aether (Current State)

*Source of truth: repository `src/`, `package.json`, `.env.example`, `next.config.ts`. Excludes the unrelated `Match website layout/` tree. Documents only what exists in code.*

---

## System Overview

**Aether** is a Next.js 15 (App Router) bring-your-own-key (BYOK) AI chat application: the browser holds provider API keys and (when unsigned-in or without a DB) conversation history; the Next.js server proxies chat to LLM providers, optionally runs tools (`web_search`, artifact ack), and—when configured—persists signed-in users’ conversations in Postgres (Neon or PGlite). Optional Auth.js sign-in enables Google Drive readonly attach and cloud conversation sync; there is no application database for API keys or general app state beyond auth cookies, Drive token cookies, and optional conversation tables.

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
               RuntimeProvider          ← useChat → POST /api/chat
                 ThreadUrlSync
                 ArtifactProvider
                   KeyboardShortcuts
                   AppShell             ← Sidebar + Thread + Settings dialog + Drive modal
```

| Concern | Primary modules |
|---------|-----------------|
| Chat transport & thread runtime | `src/providers/runtime-provider.tsx` |
| Thread list / history persistence adapter | `src/lib/local-thread-adapter.tsx` |
| URL ↔ active thread | `src/components/thread-url-sync.tsx`, `src/lib/thread-url.ts` |
| Settings / BYOK headers | `src/lib/settings.ts`, `src/providers/settings-provider.tsx` |
| Tools (schemas + prompts) | `src/lib/tools.ts` |
| Web search implementation | `src/lib/web-search.ts` (used by `/api/chat`) |
| Attachments | `src/lib/attachments.ts`, `src/lib/attachment-payloads.ts`, `attachments-provider.tsx` |
| Drive | `src/lib/drive-session.ts`, `src/lib/google-drive.ts`, `api/drive/*` |
| Cloud conversations | `src/lib/db/*`, `src/lib/conversations/*`, `api/conversations/*` |
| Voices | `src/lib/voice.ts` |
| Models list (OpenRouter public) | `src/lib/models.ts` |

### Data flow — chat turn

1. User configures provider + API key in Settings → stored in `localStorage` key `aether:settings:v1`.
2. Composer send builds messages; attachments resolve payloads from an in-memory `Map` (`attachment-payloads`); text stubs become `textPrefix`; images/files with data URLs become message `file` parts.
3. Client `AssistantChatTransport` `POST`s `/api/chat` with headers:
   - `x-api-key`, `x-provider`, `x-base-url`, `x-model`, `x-tools` (`"1"`|`"0"`)
4. Body includes `messages`, optional `model`, optional `system` (voice prompt, ≤ 8000 chars), `attachments[]`, `textPrefix`.
5. Server validates API key presence (**401** if missing), enriches last user message with attachments, builds Anthropic or OpenAI-compatible model client, optionally attaches tools with `stopWhen: stepCountIs(5)`, streams via `streamText` → `toUIMessageStreamResponse` (`maxOutputTokens: 8192`, `maxDuration: 60`).
6. Client tools: `execute_python` runs in-browser via Pyodide (`onToolCall`); server tools: `web_search`, `create_artifact` (ack only).
7. History adapter writes the format repo either to `localStorage` (`aether:messages:<id>`) or to `PUT /api/conversations/[id]/messages` when cloud mode is active.

### Data flow — auth & Drive

1. Sign-in: OAuth (Google/GitHub/Apple when env set) or email magic link (`POST /api/auth/email` → JWT → `/auth/verify` → Credentials provider `email-magic`).
2. Session: JWT strategy, 30-day `maxAge`; `user.id` derived from id or email.
3. Drive connect: authenticated `GET /api/drive/connect` → Google OAuth (readonly Drive scope) → `GET /api/drive/callback` stores tokens in httpOnly cookie `aether.drive` → redirect `/?drive_connected=1` or `/?connect=drive` for Settings.
4. Download: `POST /api/drive/download` with `{ fileId, name?, mimeType? }` returns an attachment-shaped payload under size caps.

### Data flow — conversation URLs & cloud

- `/` = new chat; `/c/<threadId>` = that conversation (`ThreadUrlSync` keeps URL and active thread aligned).
- Cloud enabled when `isCloudDbConfigured()` **and** signed in (`GET /api/conversations/status` → `{ configured, signedIn, cloud }`).
- On sign-in with local chats: `SyncLocalChatsBanner` can `POST /api/conversations/migrate` then clear local threads.

### Integration points

| External system | How used |
|-----------------|----------|
| OpenRouter / OpenAI-compatible / Anthropic | Chat completions streaming via user-supplied key |
| OpenRouter `GET /api/v1/models` | Client model picker (no key); cache `aether:models-cache:v2` |
| Resend | Optional magic-link email (`AUTH_RESEND_KEY` / `RESEND_API_KEY`) |
| Google OAuth + Drive API | Sign-in + readonly file browse/download |
| GitHub / Apple OAuth | Sign-in only (when env set) |
| Wikipedia / DuckDuckGo Instant Answer / optional Brave Search | `web_search` tool |
| Neon Postgres or local PGlite | Optional conversation store |

### App routes (as implemented)

| URL / path | File |
|------------|------|
| `/` | `src/app/(chat)/page.tsx` |
| `/c/[threadId]` | `src/app/(chat)/c/[threadId]/page.tsx` |
| `/auth/signin` | `src/app/auth/signin/page.tsx` |
| `/auth/verify` | `src/app/auth/verify/page.tsx` |
| `GET/POST /api/auth/[...nextauth]` | `src/app/api/auth/[...nextauth]/route.ts` |
| `POST /api/auth/email` | `src/app/api/auth/email/route.ts` |
| `GET /api/auth/configured` | `src/app/api/auth/configured/route.ts` |
| `POST /api/chat` | `src/app/api/chat/route.ts` |
| `GET /api/conversations/status` | `src/app/api/conversations/status/route.ts` |
| `GET/POST /api/conversations` | `src/app/api/conversations/route.ts` |
| `GET/PATCH/DELETE /api/conversations/[id]` | `src/app/api/conversations/[id]/route.ts` |
| `GET/PUT /api/conversations/[id]/messages` | `src/app/api/conversations/[id]/messages/route.ts` |
| `POST /api/conversations/migrate` | `src/app/api/conversations/migrate/route.ts` |
| Drive routes (`connect`, `callback`, `status`, `files`, `download`, `disconnect`) | `src/app/api/drive/*/route.ts` |

There is no `/settings` route — Settings is a dialog. Drive connect deep-link uses `/?connect=drive`.

---

## Data & Interface Models

### Client settings (`AppSettings`)

Persisted at `aether:settings:v1`:

`provider`, `apiKey`, `openrouterKey`, `openaiKey`, `anthropicKey`, `customKey`, `baseURL`, `model`, `customModel`, `useCustomModel`, `googleClientId` (deprecated), `enableTools`, `voice` (`default` \| `literary` \| `socratic` \| `concise`).

Defaults in code: provider `openrouter`, baseURL `https://openrouter.ai/api/v1`, `enableTools: true`, `voice: "literary"`.

Chat header builder maps settings → `x-api-key` / `x-provider` / `x-base-url` / `x-model` / `x-tools`.

### Local thread / message blobs

- `aether:threads`: array of `{ remoteId, status, title?, externalId?, custom? }`
- `aether:messages:<remoteId>`: `{ headId?, entries: [{ id, parent_id, format, content }] }` with `format` typically `"ai-sdk/v6"`
- `aether:active-thread`: last active id

### Database schema (Drizzle + runtime `CREATE TABLE IF NOT EXISTS`)

**`conversations`**

| Column | Notes |
|--------|--------|
| `id` TEXT PK | Conversation id (same as client `remoteId`) |
| `user_id` TEXT NOT NULL | Session user id or email |
| `title` TEXT | |
| `status` TEXT NOT NULL DEFAULT `'regular'` | `'regular'` \| `'archived'` |
| `custom` JSONB | |
| `created_at` / `updated_at` TIMESTAMPTZ | |
| Index | `(user_id, updated_at)` |

**`conversation_messages`**

| Column | Notes |
|--------|--------|
| `conversation_id` TEXT PK FK → `conversations(id)` ON DELETE CASCADE | |
| `repo` JSONB NOT NULL | Same shape as local format repo |
| `updated_at` TIMESTAMPTZ | |

Configured via `DATABASE_URL` (postgres URL) or `AETHER_PGLITE=1` (dir `./.data/aether-pglite`). `@electric-sql/pglite` is listed in `serverExternalPackages`.

### Conversation DTO / API contracts

Auth gate (`requireCloudUser`): DB configured + session `user.id` \| `user.email`; else **503** / **401**.

| Method | Path | Contract (as implemented) |
|--------|------|---------------------------|
| GET | `/api/conversations/status` | `{ configured, signedIn, cloud }` — ungated |
| GET | `/api/conversations` | `{ threads: ConversationDTO[] }` |
| POST | `/api/conversations` | body `{ id, title?, status?, custom? }` → `{ thread }` |
| GET/PATCH/DELETE | `/api/conversations/[id]` | PATCH `{ title?, status?, custom? }` |
| GET/PUT | `/api/conversations/[id]/messages` | PUT requires `{ repo }` with `entries` array |
| POST | `/api/conversations/migrate` | `{ items: [...] }` sliced to **100** → `{ imported, skipped }` |

`ConversationDTO`: `remoteId`, `title?`, `status`, `externalId?`, `custom?`, `updatedAt?`.

### Chat API (`POST /api/chat`)

- **Auth:** none (API key header only).
- **Headers:** `x-api-key` (required), `x-provider`, `x-base-url`, `x-model`, `x-tools`.
- **Body:** `messages` (required), `model?`, `system?` (truncated to 8000), `attachments?: { name, mime, dataUrl }[]`, `textPrefix?`.
- **Tools (when `x-tools` ≠ `"0"`):** `execute_python` (client), `web_search` (server), `create_artifact` (server ack `{ ok, kind, title }`).
- **Search order (`runWebSearch`):** Brave if `BRAVE_SEARCH_API_KEY` → Wikipedia → DuckDuckGo Instant Answer; empty/invalid JSON bodies skip a source rather than aborting the whole search.

### Auth APIs

| Endpoint | Behavior |
|----------|----------|
| `/api/auth/[...nextauth]` | Auth.js handlers |
| `POST /api/auth/email` | `{ email, callbackUrl? }` → Resend or `devLink` / **503** |
| `GET /api/auth/configured` | `{ google, github, apple, email: true }` |

Magic-link JWT: purpose `aether-email-magic`, **15 minutes**, HS256 with auth secret.

### Drive APIs

| Endpoint | Notes |
|----------|--------|
| `GET /api/drive/connect` | Requires session; else redirect sign-in with `callbackUrl=/?connect=drive` |
| `GET /api/drive/callback` | Sets `aether.drive` cookie |
| `GET /api/drive/status` | Soft status flags |
| `GET /api/drive/files` | `folderId`, `q`, `type`, `pageToken` |
| `POST /api/drive/download` | `{ fileId, name?, mimeType? }` |
| `POST /api/drive/disconnect` | Revoke + clear cookie |

Drive cookie: httpOnly JWT purpose `aether-drive-tokens`, fields include `userId`, `refreshToken`, `accessToken`, `expiresAt`, `email?`; must match session user.

### Attachment caps (code constants)

Max **6** attachments; file **25 MB**; embed image/file **4 MB**; total embed budget **12 MB**; text truncate **120_000** chars. Local PDFs are name-only (not byte-embedded); Drive PDFs embed under caps.

### Other localStorage

`aether:theme`, `aether:accent`, `aether:sidebar-collapsed`, `aether:models-cache:v2`, `aether:migrate-dismissed`.

Artifacts: React state only (not persisted).

### Env vars referenced in `src/`

| Variable | Where used |
|----------|------------|
| `AUTH_SECRET` | `auth-secret.ts` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (+ `AUTH_GOOGLE_*`) | auth, drive, configured |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (+ `AUTH_GITHUB_*`) | auth, configured |
| `APPLE_ID` / `APPLE_SECRET` (+ `AUTH_APPLE_*`) | auth, configured |
| `AUTH_RESEND_KEY` / `RESEND_API_KEY` | email route |
| `AUTH_EMAIL_FROM` / `EMAIL_FROM` | email route |
| `AUTH_ALLOW_DEV_MAGIC_LINK` | email route |
| `NODE_ENV` | email dev-link policy; cookie `secure` |
| `DATABASE_URL` | `db/index.ts` |
| `AETHER_PGLITE` | `db/index.ts` |
| `BRAVE_SEARCH_API_KEY` | `web-search.ts` (when present) |

---

## Identified Technical Debt

*Only issues visible in current source.*

1. **`/api/chat` is unauthenticated and unbounded** — No session check, no rate limit, no explicit body/attachment size limit at the route (client caps exist; server trusts the request). Anyone who can hit the deployment can proxy with a key supplied in headers.

2. **BYOK keys in plaintext `localStorage`** — `aether:settings:v1` stores provider secrets in the browser with no encryption.

3. **Shared dev auth secret fallback** — `DEV_AUTH_SECRET = "aether-dev-secret-change-me"` used when `AUTH_SECRET` unset (`auth-secret.ts`), affecting Auth.js, magic links, and Drive cookie encryption.

4. **`allowDangerousEmailAccountLinking: true`** on Google/GitHub/Apple providers — accounts with the same email can be linked across IdPs without additional verification.

5. **Conversation message `PUT` lacks size/count caps** — Validates `repo.entries` is an array only; migrate caps **items** at 100, not message payload size. Large repos can stress DB/JSON paths.

6. **`createConversation` conflict handling** — `onConflictDoNothing` then re-read; cross-user id collision surfaces as a generic create failure, not an explicit **409**.

7. **Cloud message GET soft-fails** — Client `cloudGetMessageRepo` returns empty repo on non-OK responses, masking 401/404.

8. **Chat client errors under-surfaced** — `runtime-provider` logs chat `onError` to console; Drive/attachment paths emit `aether:notice` / `aether:drive-error`, but chat failures lack the same user-visible pattern.

9. **Keyless `web_search` quality ceiling** — Without `BRAVE_SEARCH_API_KEY`, results are Wikipedia-centric (entity-ranked) plus sparse DDG Instant Answer; not a general web index.

10. **No Next.js middleware** — Route protection is per-handler; easy to add a new API without a gate.

11. **Drive query string construction** — Search `q` is embedded into the Drive query with limited escaping (single-quote handling only).

12. **Artifacts & agent state not durable** — Artifact panel is memory-only; no cross-session agent memory beyond chat message repos.

13. **Tool loop hard-capped** — `stepCountIs(5)` is fixed; no mode-specific orchestration beyond voice system prompts.

14. **Pre-existing lint debt** — `react-hooks/exhaustive-deps` warning in `src/components/model-picker.tsx` (documented in `AGENTS.md`).

15. **Example-only env vars** — `.env.example` lists `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `NEXT_PUBLIC_DEFAULT_MODEL` / `AUTH_URL`, but they are **not** read by `src/` (chat keys come from request headers / localStorage).

---

## Security & Scaling Posture

### Authentication & authorization

| Surface | Control present in code |
|---------|-------------------------|
| Chat | `x-api-key` required; **no** login |
| Conversations APIs (except status) | Session + DB configured |
| Drive mutate/list/download/connect | Session; Drive token `userId` must match |
| Email magic link | Public endpoint; token purpose + expiry checked |
| OAuth callbacks | State cookie for Drive; Auth.js for IdP |

Session is JWT (30 days). Sign-out clears Drive cookie. Callback URLs for email/verify are restricted to same-origin relative paths in the email/verify flows.

Cookies used: Auth.js session cookies; `aether.drive` (httpOnly, `sameSite: "lax"`, `secure` in production); short-lived `aether.drive.oauth_state`.

### Data validation

- Tool inputs: Zod schemas in `tools.ts` (`executePythonInput`, `webSearchInput`, `createArtifactInput`).
- Chat `system` truncated to 8000 characters.
- Conversation POST requires non-empty `id`; messages PUT requires `repo.entries` array.
- Magic-link email validated before send.
- Attachment size/type rules enforced primarily on the **client** (`attachments.ts`); Drive download applies server-side embed caps.
- Web search rejects empty query; JSON bodies are read as text first where `web-search.ts` is present, so empty bodies skip that source.

### What is / is not stored server-side

| Stored on server | Not stored on server |
|------------------|----------------------|
| Auth session JWT (cookie) | BYOK API keys (browser only; present in chat request memory while proxied) |
| Drive OAuth tokens (httpOnly cookie) | Artifacts |
| Conversations + message repos (if DB + signed in) | Unsigned-in / no-DB chat history (`localStorage`) |
| | In-memory attachment payload `Map` |

### Load & scaling characteristics (from structure)

- **Stateless chat path:** Each `/api/chat` is an independent streaming proxy (`maxDuration: 60`). Horizontal scale is that of the Next.js deployment + upstream provider limits; no server-side chat queue or shared session store for messages.
- **No rate limiting** in application code on chat, search, email, or Drive.
- **Cloud DB:** Neon HTTP driver suits serverless; PGlite is local/dev. Schema is per-user rows with an index on `(user_id, updated_at)`; message history is one JSONB blob per conversation (simple, but updates rewrite the whole repo).
- **Client fan-in:** Model may issue multiple `web_search` calls per turn (bounded by `stepCountIs(5)` total steps); each search does sequential source attempts (Brave → Wikipedia variants → DDG).
- **Heavy local work:** Pyodide runs in the browser; large Drive embeds are capped to protect main-thread/UI (payload side-store), but large message histories still live in React/localStorage or JSONB.
- **Caching:** OpenRouter model list cached 1 hour in localStorage; conversation cloud status is client-cached in `cloud-client.ts` until invalidated.

### Production configuration dependencies (explicit in code/env example)

For a locked-down deploy, code expects at least: real `AUTH_SECRET`; for cloud history `DATABASE_URL`; for email without `devLink` a Resend key; for OAuth/Drive the matching client ids/secrets; optionally `BRAVE_SEARCH_API_KEY` for stronger search. Chat itself still requires the **user’s** provider key in the browser.

---

*End of TDD — current implementation only.*
