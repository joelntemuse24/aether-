# AGENTS.md

## Cursor Cloud specific instructions

### Product
This repo's primary product is **Aether** (repo root), a Next.js 15 (App Router) bring-your-own-key AI chat app. BYOK keys stay in the browser. Optional Auth.js sign-in plus `DATABASE_URL` (Neon) or `AETHER_PGLITE=1` enables cloud conversations, curated memory, projects, persisted artifacts, and harness run rows. Without a DB, chat history and local memory use `localStorage` (`aether:` prefix). The only required local process is the Next.js dev server. The `Match website layout/` subfolder is an unrelated standalone Figma/Vite export — ignore it unless specifically asked.

### Standard commands (root)
Defined in `package.json`: `npm run dev` (port 3000), `npm run build`, `npm run start`, `npm run lint`. Node >=20 required. Dependencies are installed by the startup update script (`npm install`).

### Non-obvious notes
- **BYOK, no required server secrets for chat.** The `/api/chat` route (`src/app/api/chat/route.ts`) reads the provider + key from request headers, which the browser populates from `localStorage` (Settings dialog). `.env.example` vars are optional/commented. Never store user API keys in the server DB.
- **Optional cloud DB.** When `DATABASE_URL` or `AETHER_PGLITE=1` is set and the user is signed in, conversations sync to Postgres and APIs under `/api/memory`, `/api/projects`, `/api/artifacts`, plus harness tables (`agent_runs`) become available. Unsigned or no-DB users keep using `localStorage`.
- **Agent harness.** Composer send classifies via `POST /api/harness/classify` (clarify cards + depth budgets 2/8/16). Chat body may include `harness` (`intent`, `depth`, `runId`, `clarifications`, `planSteps`), `memoryContext`, `projectId`, `conversationId`. Tools are built by `src/lib/harness/tool-registry.ts`.
- **Auth (email magic link) works without OAuth.** Email sign-in uses a signed JWT + Credentials provider. Locally, `/api/auth/email` returns a `devLink` when `AUTH_RESEND_KEY` is unset — open that link to finish sign-in. `AUTH_SECRET` is optional locally (shared fallback in `src/lib/auth-secret.ts`); set a real secret for production. OAuth (Google/GitHub/Apple) only appears when the matching env vars are set. Provider flags for the sign-in UI live at `/api/auth/configured` (do not use `/api/auth/providers` — that path belongs to Auth.js).
- **Drive connect callback.** After Drive OAuth (or when login is required first), the app returns to `/?connect=drive`, which opens Settings — there is no `/settings` route. Drive tools (`drive_search` / `drive_read`) require a connected Drive cookie; composer attach is separate.
- **`fetch_url` is SSRF-hardened** in `src/lib/connectors/url-safety.ts` (blocks private/link-local/metadata hosts, validates DNS, caps redirects). Do not weaken this without review.
- **Testing chat end-to-end without a real provider key.** The Settings dialog supports a "Custom" (OpenAI-compatible) provider. Point its Base URL at a local mock OpenAI-compatible server (implement `POST /chat/completions` with OpenAI SSE streaming) and set any API key + a custom model id. This exercises the full browser → `/api/chat` → provider streaming path with no external credentials. The mock server code is test-only infra (keep it outside the repo, e.g. `/tmp`).
- **Settings dialog auto-opens** on first visit when no key is saved; keys/history persist only in browser `localStorage` under the `aether:` prefix (clearing site data resets the app). Memory inspector lives in Settings; projects + saved artifacts appear in the sidebar when cloud is on.
- Lint currently emits one pre-existing `react-hooks/exhaustive-deps` warning in `src/components/model-picker.tsx` (0 errors) — not introduced by setup.
