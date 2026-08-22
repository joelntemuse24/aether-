# Hermes Remote Backend — Design Spec

**Date:** 2026-08-12  
**Status:** Approved architecture (product plan from operator); Phase 1 in implementation  
**Product constraint:** Users never install Hermes. They only use the Aether site. Auth stays Auth.js / magic link / OAuth. The browser never talks to Hermes.

---

## 1. Problem

Aether’s agent loop today lives inside Vercel serverless (`streamText` + `prepareStep` + progressive tool unlock in `/api/chat`). That loop is hard to maintain and does not fit a long-lived multi-tool agent (terminal, skills, long sessions). Hermes Agent already provides that loop behind an OpenAI-compatible API server. Vercel remains the public face; Hermes runs as an always-on remote process we operate.

## 2. Goals

- Users open Aether, sign in (or use BYOK), and chat. No local install / Docker for users.
- Hermes owns the tool loop on a host we control (VPS / Fly / Railway / Render / box).
- Aether Next.js authenticates, builds context, proxies to Hermes with a server-side key, streams results back in the existing assistant-ui / AI SDK UIMessage shape.
- UX continuity: model picker, cream canvas, artifacts, sidebar, settings, confirm cards stay.
- Hosted vs BYOK resolution stays on the Vercel side (pass model / keys into Hermes where supported).

## 3. Non-goals (this program)

- Forking / rebranding Hermes in this same PR (separate ops repo or later milestone).
- Moving Drive/GitHub/memory *storage* off Neon / Aether cookies.
- Giving Hermes unrestricted host shell in production.
- Browser → Hermes direct calls (CORS open to the world).

## 4. Architecture

```
Browser (assistant-ui)
  → POST /api/chat  (Aether on Vercel)
       · Auth.js session (optional for BYOK)
       · Build system/context (memory, project, skills, harness notes)
       · Resolve hosted model OR BYOK headers
       · Server-side HTTPS to Hermes
  → Remote Hermes gateway
       · /v1/chat/completions (stream)  [Phase 1]
       · /v1/runs + /events + /stop     [Phase 2]
       · Sandboxed tools + optional MCP for Aether side-effects
  ← OpenAI SSE (+ hermes.tool.progress)
  ← Aether stream bridge → AI SDK UIMessage SSE
  ← Browser thread UI
```

**Tenancy:** Hermes API key is server-only. Scope sessions with:

- `X-Hermes-Session-Id` = Aether `conversationId` (or generated turn id)
- `X-Hermes-Session-Key` = `aether:user:{userId}` or `aether:anon:{conversationId}` (≤256 chars)

## 5. Approaches considered

| Approach | Pros | Cons |
|----------|------|------|
| **A. Chat Completions proxy** (recommended Phase 1) | Simple; matches Hermes default; works with any OpenAI client pattern; abort cancels HTTP stream | Tool UI is progress-only unless we map `hermes.tool.progress`; no first-class run stop API |
| **B. Runs API + events** | Cancel via `/stop`; richer progress; detach/reconnect | More state; need run_id correlation; slightly more adapter code |
| **C. Point `@ai-sdk/openai` at Hermes and keep `streamText` tools** | Reuses AI SDK | Wrong ownership: tools would try to run on Vercel again; Hermes already runs tools server-side |

**Recommendation:** Phase 1 = **A** behind `HERMES_BASE_URL` + `HERMES_API_KEY`. Phase 2 = **B** for Stop + approvals. Phase 3 = MCP / custom tools for Aether-specific side effects; gut old harness loop.

## 6. Request / response mapping

### 6.1 Browser → Aether (unchanged)

Headers (existing):

- `x-access-mode`: `hosted` | `byok`
- `x-model`, `x-tools`
- BYOK only: `x-api-key`, `x-provider`, `x-base-url`

Body (existing):

```ts
{
  messages: UIMessage[];
  model: string;
  system?: string;           // voice
  harness?: {
    intent, depth, runId?, clarifications?, planSteps?,
    timeBudgetMinutes?, surface?
  };
  memoryContext?: string;
  projectId?: string;
  conversationId?: string;
  continueSegment?: boolean;
  attachments?: { name, mime, dataUrl }[];
  textPrefix?: string;
}
```

### 6.2 Aether → Hermes `POST {HERMES_BASE_URL}/v1/chat/completions`

Headers:

```http
Authorization: Bearer {HERMES_API_KEY}
Content-Type: application/json
X-Hermes-Session-Id: {conversationId}
X-Hermes-Session-Key: aether:user:{userId} | aether:anon:{conversationId}
Idempotency-Key: {optional harness.runId or generated}
```

Body:

```json
{
  "model": "<requestedModel or hermes-agent>",
  "provider": "<optional; hosted openrouter slug when configured>",
  "stream": true,
  "messages": [
    { "role": "system", "content": "<assembled Aether context>" },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Message conversion rules:**

1. Assemble Aether `system` string exactly as today (tools prompt when `x-tools`≠0, harness/time/verify/skills, voice, memory, project). Hermes layers this on top of its core prompt.
2. Map `UIMessage[]` → OpenAI chat messages:
   - `role` preserved for `user` / `assistant` / `system`
   - Text parts → string `content`
   - Image file/data URL parts → `{ type: "text"|"image_url", ... }` multimodal array
   - Prior tool UI parts are **not** re-sent as OpenAI `tool` messages in Phase 1 (Hermes already executed tools; assistant text is the durable transcript). Optional later: include summarized tool notes in system.
3. Attachments: enrich last user message (existing `enrichMessagesWithAttachments`) before conversion.
4. Hosted: pass picker model id; Hermes must have `direct_model_requests: true` **or** an explicit `provider` (OpenRouter). Keys for hosted models live on Hermes (OpenRouter / operator keys), not in the browser.
5. BYOK Phase 1: **keep the existing in-process `streamText` path**. Hermes does not receive user API keys. Phase 2 may add a Hermes custom-provider passthrough if the upstream supports per-request credentials.

### 6.3 Hermes → Aether stream bridge

Hermes SSE (Chat Completions):

- Standard `data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"…"}}]}`
- Custom `event: hermes.tool.progress` with tool name / status payload
- Terminal `data: [DONE]`

Bridge emits AI SDK UIMessage chunks via `createUIMessageStream` → `createUIMessageStreamResponse`:

| Hermes event | UIMessage chunk(s) |
|--------------|--------------------|
| first content delta | `start`, `start-step`, `text-start`, then `text-delta` |
| content delta | `text-delta` |
| `hermes.tool.progress` (start) | `tool-input-start` + `tool-input-available` (`providerExecuted: true`) |
| `hermes.tool.progress` (done / with result) | `tool-output-available` (`providerExecuted: true`) |
| stream end | `text-end`, `finish-step`, `finish` |
| HTTP/parse error | `error` with `friendlyChatError` |
| `req.signal` abort | abort upstream fetch; emit `abort` if needed |

**Important:** Do **not** leave pending client-executable tool calls for Hermes-executed tools. Mark `providerExecuted: true` so assistant-ui does not wait for `addToolResult`.

`execute_python` (Pyodide) stays client-side in the legacy path. On the Hermes path, Python runs in Hermes’s sandbox instead — acceptable product change; document in UX notes.

### 6.4 Cancel

- Browser Stop → `AbortSignal` on `/api/chat` → abort Hermes fetch.
- If a Hermes `run_id` appears (`X-Hermes-Run-Id` / SSE `run_id`), also `POST /v1/runs/{run_id}/stop`.
- Phase 2: map Hermes approval events to existing `/api/harness/confirm` cards.

### 6.5 Tool ownership matrix

| Capability | Phase 1 | Target |
|------------|---------|--------|
| Web search, fetch, terminal/code, browser (Hermes) | Hermes native | Hermes (+ safe sandbox) |
| `fetch_url` SSRF policy | Prefer Hermes sandbox egress; keep `url-safety.ts` for any Aether-side fetch | Keep Aether hardening for Aether-side fetches |
| Memory search/write (Aether DB) | Prompt injection of relevant memory only | MCP or Hermes custom tool → Aether `/api/memory` with signed service JWT |
| Drive / GitHub | Prompt / skills notes only | MCP → Aether connector routes with user session |
| `create_artifact` | Assistant markdown; user may still save from panel | Custom tool → Aether artifacts store |
| `request_confirmation` | Hermes approval API (Phase 2) | Map to existing confirm UI |
| Progressive unlock / `prepareStep` | **Bypassed** on Hermes path | **Delete** after Hermes is default |

## 7. Feature flag & rollout

Env:

```bash
HERMES_BASE_URL=https://hermes.example.com   # no trailing /v1 required; adapter normalizes
HERMES_API_KEY=...                           # server only
HERMES_MODEL_NAME=hermes-agent               # optional default model field
HERMES_PROVIDER=openrouter                   # sent with picker model (hosted default)
HERMES_ENABLED=1                             # optional explicit enable; else enabled when URL+key set
```

Routing in `/api/chat`:

1. If Hermes configured **and** `accessMode === "hosted"` → Hermes proxy (`src/lib/hermes`). Always send `provider` (default `openrouter`).
2. Else → isolated `streamLegacyLocalChat` (BYOK + hosted fallback when Hermes env is missing).
3. If hosted and neither Hermes nor local hosted keys → 503. `/api/hosted/status.available` is true when either path can serve chat.

The in-process `prepareStep` / progressive unlock loop is isolated under `src/lib/harness/legacy-local-stream.ts`. New work targets the Hermes adapter.

## 8. Hardening

- Hermes reachable only from Vercel (private network / firewall) + strong API key.
- No `API_SERVER_CORS_ORIGINS` for production Aether (server-to-server only).
- Log correlation: `conversationId`, Hermes response `id` / `X-Hermes-Session-Id`, optional `harness.runId`.
- Timeouts: honor `maxDuration` / abort; do not weaken `url-safety` for remaining Aether fetches.
- Sandbox: Docker / Modal / Daytona / Vercel Sandbox — never unrestricted host shell for multi-tenant.

## 9. Docs & ops (out of band from Aether UI)

Operator runs a stripped Hermes fork (or stock Hermes with Aether branding off) as Docker with:

- `API_SERVER_ENABLED=true`, bind `0.0.0.0` behind TLS reverse proxy
- `API_SERVER_KEY` matching `HERMES_API_KEY`
- OpenRouter (and optional BUZZ) keys on Hermes
- Persistent volume for sessions/memory/skills
- Sandboxed terminal backend

Aether repo ships adapter code + env docs + optional `deploy/hermes/` compose example — not the Hermes source tree.

## 10. Testing

- Unit: OpenAI message conversion; SSE → UIMessage chunk mapping (incl. tool progress).
- Integration: mock Hermes HTTP server returning canned SSE; `/api/chat` with Hermes env returns UIMessage stream.
- Manual: hosted chat with real Hermes URL; Stop cancels; session key isolation smoke test.
- Regression: BYOK path unchanged when Hermes configured.

## 11. Migration checklist (from product plan)

1. Fork/strip Hermes (ops) — branding, OpenRouter default.
2. Deploy remote gateway + sandbox + volume.
3. Thin Aether adapter (this repo, Phase 1).
4. Port Aether-specific tools via MCP / custom tools (Phase 3).
5. Auth/tenancy headers (Phase 1).
6. Delete old harness loop path once Hermes is default.
7. Hardening (network, cancel, logging).
8. UX continuity (no frontend redesign).

---

## Spec self-review

- No TBDs for Phase 1 contract.
- BYOK explicitly stays on legacy path until Phase 2.
- Stream protocol choice is UIMessage (not raw OpenAI to the browser).
- Scope is Aether adapter + docs; Hermes fork is operator-side.
