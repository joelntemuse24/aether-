# Aether — Technical Design Document

**Audience:** A reader who is comfortable reading TypeScript/React but sits somewhere between beginner and intermediate in software engineering. This document explains not just what the code does, but *why* it’s written the way it is — naming, trade-offs, and the product ideas that shape every layer.

**Source of truth:** `src/`, `package.json`, `.env.example`. Ignores the unrelated `Match website layout/` folder.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Domain Primer: Consumer AI Chat](#2-domain-primer-consumer-ai-chat)
3. [Architecture at a Glance](#3-architecture-at-a-glance)
4. [File Inventory](#4-file-inventory)
5. [Dependency Stack & Why Each Was Chosen](#5-dependency-stack--why-each-was-chosen)
6. [Configuration & Environment](#6-configuration--environment)
7. [Authentication & Sessions](#7-authentication--sessions)
8. [Settings, Theme & Access Modes](#8-settings-theme--access-modes)
9. [The Chat Turn — End to End](#9-the-chat-turn--end-to-end)
10. [Hosted Model Routing (Aether Cloud)](#10-hosted-model-routing-aether-cloud)
11. [The Harness — Classify, Clarify, Budgets](#11-the-harness--classify-clarify-budgets)
12. [Tools & Artifacts](#12-tools--artifacts)
13. [Storage Model — Browser vs Account](#13-storage-model--browser-vs-account)
14. [Connectors — Drive & GitHub](#14-connectors--drive--github)
15. [UI Shell — Sidebar, Composer, Vault](#15-ui-shell--sidebar-composer-vault)
16. [Error Handling & Notices](#16-error-handling--notices)
17. [Known Limitations](#17-known-limitations)
18. [Glossary](#18-glossary)

---

## 1. Project Overview

**Aether** is a consumer AI chat app — think Claude.ai or ChatGPT class. People talk to models, write, research, and make things. They should not feel like they’re configuring developer infrastructure.

The app is a **Next.js 15** (App Router) web client. There is no separate backend service: API routes on the same Next.js process proxy chat to LLM providers, run tools, and (optionally) sync account data to Postgres.

### The Core Thesis

Chat should **just work**. Default mode is **Aether Cloud**: the server holds hosted provider keys and exposes a friendly model picker. Power users can still **bring their own key (BYOK)** under Preferences → Advanced — keys stay in the browser and are never written to the app database.

Optional **sign-in** unlocks sync: conversations, memory, projects, artifacts, and Vault notes follow the account across devices. Unsigned users still get a full chat experience with history in `localStorage`.

### What Aether Does

- Stream chat with models (hosted catalog or BYOK).
- Attach files; optionally pull from Google Drive; connect GitHub for account linking.
- Run tools when useful: web search, fetch URL, Python (in-browser), create artifacts, memory, Drive read.
- Keep a calm consumer shell: sidebar, composer (mic / Stop / model), soft artifact panel, Vault notes, Preferences.

### What Aether Does NOT Do

- **No required signup for chat.** Login is for sync and connectors, not a gate for typing.
- **No server-side storage of BYOK API keys.** Those live only in the browser.
- **No Google Drive as the product database.** Drive is a file connector. Projects, Artifacts, Vault, and chats sync to Aether’s own Postgres when you’re signed in — same idea as Grok/Claude “in the product,” not “in your Drive.”
- **No separate microservice fleet.** One Next.js app; polling/event complexity stays low.
- **Ignore `Match website layout/`.** Unrelated Figma/Vite export; not part of Aether.

This narrow product surface is intentional: fewer failure modes, clearer UX, and a codebase you can follow without a map of fifteen services.

---

## 2. Domain Primer: Consumer AI Chat

Before the folders, the concepts the code is built around.

### 2.1 Bring-your-own-key vs hosted

| Mode | Who pays for the model API | Where the key lives |
|------|----------------------------|---------------------|
| **Aether Cloud** (`accessMode: "hosted"`) | Operator / Aether (server env) | Server only |
| **BYOK** (`accessMode: "byok"`) | The user | Browser `localStorage` |

The browser always sends *which mode and which model* on each chat request. In BYOK it also sends the user’s key in a header so the Next.js route can call the provider. The key is not persisted server-side.

### 2.2 Streaming

Models answer token by token. The client uses the Vercel AI SDK + assistant-ui so the thread updates live. **Stop** cancels the in-flight stream. There is no “wait for the whole essay then paint.”

### 2.3 Threads & URLs

- `/` — new chat
- `/c/<threadId>` — that conversation

`ThreadUrlSync` keeps the address bar and the active thread aligned (shareable links when cloud history is on).

### 2.4 Harness (depth, not a second product)

Before a hard turn, Aether may **classify** the message: intent (chat / research / write / …) and depth (shallow / standard / deep). Deep turns can ask a quick clarifying question, then run with a higher tool-step budget. Shallow turns often skip the model classify call via heuristics — faster, cheaper.

### 2.5 Artifacts vs Vault vs Projects

| Concept | What it is |
|---------|------------|
| **Artifact** | A living document the *model* created (code, markdown) — opens in a soft inspector panel; can persist to the account |
| **Vault** | *Your* notes scratchpad (links, drafts, thoughts) — sidebar workspace; account-synced when signed in |
| **Project** | A named workspace with optional instructions injected into chats bound to it |

---

## 3. Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│                                                                  │
│  ThemeProvider + SessionProvider                                 │
│       └─ ChatProviders                                           │
│            Settings · Attachments · Drive · GitHub               │
│            Projects · Vault · Harness                            │
│                 └─ RuntimeProvider  (useChat → /api/chat)        │
│                      └─ AppShell                                 │
│                           Sidebar │ Thread │ Artifact panel      │
│                           Preferences dialog · Drive modal       │
└───────────────────────────────┬─────────────────────────────────┘
                                │  headers: access mode, model,
                                │  (BYOK: key) · body: messages,
                                │  harness, attachments, …
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js API routes                                              │
│                                                                  │
│  POST /api/chat ──► hosted router (BUZZ → OpenRouter)            │
│                 └──► or BYOK provider                            │
│                 └──► tools + streamText                          │
│                                                                  │
│  /api/harness/classify · /api/hosted/status                      │
│  /api/conversations/* · /api/memory/* · /api/projects/*          │
│  /api/artifacts · /api/vault/*                                   │
│  /api/drive/* · /api/github/* · /api/auth/*                      │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  LLM gateways            Neon / PGlite            Google / GitHub
  (BUZZ, OpenRouter,      (optional account        OAuth (optional)
   OpenAI, Anthropic…)     sync)
```

**Why this shape**

- **One composition in the UI** — shell + thread + optional inspector, not a dashboard of widgets.
- **Server proxies chat** — keys for hosted mode never ship to the client; BYOK keys only transit the request the user initiated.
- **Optional DB** — local-first works without Postgres; cloud sync is additive when `DATABASE_URL` (or PGlite) + sign-in are present.
- **No middleware.ts** — each sensitive route calls `requireCloudUser()` (or Drive/GitHub session checks) itself. Slightly more repetition, easier to audit per endpoint.

---

## 4. File Inventory

| Path | Purpose |
|------|---------|
| `src/app/layout.tsx` | Root layout: fonts, Session + Theme |
| `src/app/(chat)/` | Chat routes (`/` and `/c/[threadId]`); pages return `null`, UI from shell |
| `src/app/auth/` | Sign-in and magic-link verify pages |
| `src/app/api/chat/route.ts` | Streaming chat proxy + tools |
| `src/app/api/hosted/status/route.ts` | Hosted availability + ranked model catalog |
| `src/app/api/harness/classify/route.ts` | Intent/depth classification |
| `src/app/api/conversations/*` | Cloud thread list + message repos |
| `src/app/api/memory/*` | Curated memory CRUD + migrate |
| `src/app/api/projects/*` | Projects CRUD |
| `src/app/api/artifacts/route.ts` | Artifact list / upsert / delete |
| `src/app/api/vault/*` | Vault notes CRUD + migrate |
| `src/app/api/drive/*` | Drive OAuth + download |
| `src/app/api/github/*` | GitHub connect OAuth + status |
| `src/app/api/auth/*` | Auth.js + email magic link + configured flags |
| `src/components/chat-providers.tsx` | Provider tree for chat pages |
| `src/components/layout/` | App shell, sidebar, artifact panel, vault UI |
| `src/components/assistant-ui/` | Thread, composer, tools UI, markdown |
| `src/components/settings/` | Preferences dialog |
| `src/providers/` | React context: settings, runtime, harness, drive, github, vault, … |
| `src/lib/hosted/` | Hosted config, router, catalog, ranking |
| `src/lib/harness/` | Classify, budgets, tool registry, run store |
| `src/lib/db/` | Drizzle schema + Neon/PGlite bootstrap |
| `src/lib/vault.ts` + `src/lib/vault/` | Local fallback + cloud store |
| `src/auth.ts` | NextAuth configuration |
| `src/app/globals.css` | Design tokens (parchment light / candlelight dark) |
| `.env.example` | Documented optional env vars |
| `docs/TDD.md` | This document |
| `AGENTS.md` | Notes for Cursor Cloud agents |
| `Match website layout/` | **Not Aether** — ignore |

---

## 5. Dependency Stack & Why Each Was Chosen

| Package | What it does | Why we use it |
|---------|--------------|---------------|
| **Next.js 15** | React framework, App Router, API routes | One deployable app for UI + chat proxy + auth |
| **React 19** | UI | Matches Next 15; assistant-ui expects modern React |
| **@assistant-ui/react** (+ ai-sdk bridge, markdown) | Chat primitives (thread, composer, actions) | Battle-tested streaming chat UX without reinventing message state |
| **ai** + **@ai-sdk/openai** / **anthropic** | Provider SDKs + `streamText` | Unified streaming + tool calling across OpenAI-compatible and Anthropic APIs |
| **next-auth** (Auth.js v5) | Sessions, OAuth, Credentials | Standard auth for Next; JWT sessions without a custom user DB |
| **drizzle-orm** + **@neondatabase/serverless** | Typed SQL over Neon | Lightweight serverless Postgres on Vercel |
| **@electric-sql/pglite** | Embedded Postgres | Local cloud-sync testing without Neon (`AETHER_PGLITE=1`) |
| **jose** | JWT sign/verify | Magic-link tokens for email sign-in |
| **Tailwind CSS 4** | Styling | Token-driven UI via CSS variables in `globals.css` |
| **lucide-react** | Icons | Consistent, light icon set |
| **highlight.js** / **marked** | Code / markdown in artifacts | Lazy-loaded with the artifact panel |
| **zod** | Schema validation | Harness classification shapes, safer parsing |

We deliberately avoid a second backend language, Redis, or a message queue. Chat is request/stream scoped; sync is REST + Postgres.

---

## 6. Configuration & Environment

Almost everything is **optional**. BYOK chat works with zero server secrets. Hosted chat and sync need env vars.

### 6.1 Hosted models (Aether Cloud)

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Long-tail models + failover for Claude/ChatGPT |
| `AETHER_HOSTED_BUZZ_API_KEY` | Preferred gateway for Claude + ChatGPT families |
| `AETHER_HOSTED_BUZZ_BASE_URL` | Default `https://api.buzzai.cc/v1` (bare host gets `/v1` appended) |
| `AETHER_HOSTED_CHATGPT_*` | Optional separate ChatGPT upstream |

Legacy aliases `AETHER_HOSTED_CLAUDE_*` still work. Without BUZZ, Claude/ChatGPT can still route through OpenRouter when that key is set.

### 6.2 Account sync (Postgres)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon (or any Postgres) connection string |
| `AETHER_PGLITE=1` | Local embedded DB under `.data/aether-pglite` |

Cloud features activate only when DB is configured **and** the user is signed in (`GET /api/conversations/status` → `{ cloud: true }`).

### 6.3 Auth & connectors

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | JWT signing (local fallback exists for harness; set a real secret in production) |
| `AUTH_URL` | Canonical app URL |
| `GOOGLE_CLIENT_ID` / `SECRET` | Google sign-in + Drive connect |
| `GITHUB_CLIENT_ID` / `SECRET` | GitHub sign-in + Connect GitHub |
| `APPLE_ID` / `APPLE_SECRET` | Optional Apple sign-in |
| `AUTH_RESEND_KEY` / `AUTH_EMAIL_FROM` | Magic-link email; without Resend, `/api/auth/email` returns a `devLink` |

### 6.4 Tools

| Variable | Purpose |
|----------|---------|
| `BRAVE_SEARCH_API_KEY` | Higher-quality `web_search` (else Wikipedia / DuckDuckGo fallbacks) |

Full comments live in `.env.example`.

---

## 7. Authentication & Sessions

**Strategy:** JWT sessions (Auth.js), ~30-day `maxAge`. `user.id` is the provider id or email.

**Email magic link:** `POST /api/auth/email` mints a signed JWT. With Resend, an email is sent; without it, the JSON includes `devLink` for local finish. Verify page → Credentials provider `email-magic`.

**OAuth:** Google / GitHub / Apple buttons only appear when the matching env vars are set. UI flags come from `GET /api/auth/configured` (do **not** use Auth.js’s `/api/auth/providers` for that — different purpose).

**Why JWT, not a sessions table:** keeps the “no DB required” story intact for chat-only deploys.

---

## 8. Settings, Theme & Access Modes

**Preferences** is a dialog (not a `/settings` route). Drive deep-links use `/?connect=drive`.

Persisted client settings (`aether:settings:v1`) include:

- `accessMode`: `"hosted"` (default) or `"byok"`
- Provider keys / base URL / model (BYOK)
- `enableTools`, `voice` (`default` | `literary` | `socratic` | `concise`)

**Theme:** `dark` (default in code) or `light`, plus accent (`default` | `mono` | `sky` | `burgundy`). Applied as `data-theme` / `data-accent` on `<html>`. Tokens: parchment light `#f7f4ec`, candlelight dark `#17150f`.

**Why Advanced hides BYOK:** consumer default should not lead with API keys. Hosted works → Preferences is appearance, voice, connected apps; keys live under Advanced.

---

## 9. The Chat Turn — End to End

1. User types (or uses **mic** → Web Speech API → text in the composer).
2. Optional **classify** (`POST /api/harness/classify`) unless heuristics say the turn is shallow.
3. If classify asks for clarify → inline choices in the composer stack (not a heavy card).
4. Client arms harness context and sends via assistant-ui transport → `POST /api/chat` with headers from `buildChatHeaders()` (`src/lib/settings.ts`).
5. Server resolves the model (hosted router or BYOK), injects voice + memory + project instructions + harness addendum, builds tools, streams with a depth-based step budget.
6. UI shows quiet status phrases while `thread.isRunning`; **Stop** cancels the stream.
7. History adapter persists the turn to `localStorage` or cloud `PUT /api/conversations/[id]/messages`.

Primary modules:

- Client runtime: `src/providers/runtime-provider.tsx`
- Chat route: `src/app/api/chat/route.ts`
- Thread UI: `src/components/assistant-ui/thread.tsx`

---

## 10. Hosted Model Routing (Aether Cloud)

**Goal:** friendly names in the picker; no “OpenRouter” / gateway jargon in the product UI.

```
Model family
   ├─ Claude / ChatGPT  →  BUZZ (primary)  →  OpenRouter (failover)
   └─ Everything else   →  OpenRouter only
```

- Live catalog: OpenRouter models API, ranked **ChatGPT → Claude → More**, served by `GET /api/hosted/status`.
- Config: `src/lib/hosted/config.ts`, routing: `src/lib/hosted/router.ts`, ranking: `src/lib/hosted/rank-models.ts`.

If hosted is unconfigured, chat returns **503** in hosted mode; the user can switch to BYOK under Advanced.

---

## 11. The Harness — Classify, Clarify, Budgets

| Depth | Max tool steps (approx.) | Typical use |
|-------|--------------------------|-------------|
| shallow | 2 | Quick chat |
| standard | 8 | Default work |
| deep | 16 | Research / multi-step |

**Why classify at all?** Blindly giving every message a 16-step tool budget is slow and expensive. Heuristics skip the classify model call for obvious shallow turns.

**Thinking phrases** in the UI (“Cooking…”, “Gathering threads…”) are **not** a fake backend. They rotate while the thread is *actually* generating — the same role as Claude’s quiet status text. Tool-specific labels replace them when a tool is running.

Runs can be recorded in `agent_runs` / `agent_run_events` when DB + sign-in are available.

---

## 12. Tools & Artifacts

Tools are registered in `src/lib/harness/tool-registry.ts` and gated by Preferences → Tools.

| Tool | Where it runs | Notes |
|------|---------------|-------|
| `execute_python` | Browser (Pyodide) | No server sandbox |
| `web_search` | Server | Brave if keyed; else Wikipedia / DDG fallbacks; per-turn quotas by depth |
| `fetch_url` | Server | SSRF-hardened (`url-safety.ts`) |
| `create_artifact` | Server ack + UI | May persist when signed in + DB |
| `memory_search` / `memory_write` | Server | Signed-in + DB |
| `drive_search` / `drive_read` | Server | Drive cookie present |

**Deferred discovery:** core tools stay in the prompt; memory/Drive unlock via `tool_search` so shallow turns don’t pay for unused tool schemas every time.

Artifacts open in a soft side inspector (`artifact-panel.tsx`). Cloud users see them under Sidebar → Artifacts.

---

## 13. Storage Model — Browser vs Account

Think of Aether like Grok/Claude: **product storage**, not Drive storage.

| Data | Signed out / no DB | Signed in + DB |
|------|--------------------|----------------|
| Conversations | `aether:threads`, `aether:messages:*` | `conversations` / `conversation_messages` |
| Memory | `aether:memory:v1` | `memory_records` |
| Projects | Active id only in localStorage | `projects` table |
| Artifacts | Session panel (lost on refresh) | `artifacts` table |
| Vault notes | `aether:vault-notes` | `vault_notes` table |
| Settings, theme, BYOK keys | Always localStorage | Never in DB |

**Gate:** `isCloudDbConfigured()` in `src/lib/db/index.ts` + session via `requireCloudUser()`.

**Migrate on sign-in:** banners/helpers can upload local chats, memory, and Vault notes into the account, then clear local copies when safe.

Schema is declared in `src/lib/db/schema.ts` and ensured at runtime with `CREATE TABLE IF NOT EXISTS` (no separate migration CLI required for current tables).

---

## 14. Connectors — Drive & GitHub

### Google Drive

- Connect after sign-in → OAuth → httpOnly cookie `aether.drive`.
- Browse/attach from the composer attach menu; tools can search/read when connected.
- **Does not** store chats, Vault, or Projects.

### GitHub

- Separate connect flow (`/api/github/connect` → callback → cookie `aether.github`).
- Scopes: `repo`, `read:user`.
- Today: connect/status/disconnect in Preferences. **Agent repo tools are not wired yet** — connecting accounts for the product, not a full coding agent.

Callback URLs must be registered on the OAuth apps (see `.env.example`).

---

## 15. UI Shell — Sidebar, Composer, Vault

**Sidebar:** New conversation, Projects, Artifacts, Vault, search, recent threads, Preferences, theme toggle. Canvas background, continuous nav (not stacked mini-panels).

**Composer:** attachments menu, model picker, mic (speech-to-text), send / labeled **Stop**. Message actions: copy, edit & resend, retry, restore-to-here.

**Vault:** docked sidebar editor or floating window; Save / Delete; shows **Synced** vs **This device**. Implementation: `VaultProvider` + `/api/vault*`.

**Empty state:** logo + time-of-day greeting only (no suggestion tile grid).

Primary files: `app-shell.tsx`, `sidebar.tsx`, `thread.tsx`, `vault-sidebar.tsx`, `settings-dialog.tsx`.

---

## 16. Error Handling & Notices

User-visible errors use a light toast/notice strip (`aether:notice`, drive/github error events) — not stacked error cards.

Chat failures surface in the message error primitive. Hosted misconfig → clear Preferences path under Advanced. Drive/GitHub failures name the connector without dumping OAuth internals.

**Philosophy:** fail visibly, recover to a usable composer, never trap the user in setup theater when hosted chat works.

---

## 17. Known Limitations

Honest constraints still visible in the code:

1. **`/api/chat` is not session-gated** — hosted abuse resistance depends on deployment/network controls; BYOK uses the caller’s key.
2. **BYOK keys are plaintext in `localStorage`** — convenient, not a hardware vault.
3. **GitHub connector** is account-link only until repo tools land.
4. **Keyless web search** quality varies by IP (DDG captchas); Brave is the upgrade.
5. **No Next.js middleware** — auth is per-route.
6. **Default theme is dark** in code; light parchment is a toggle (Figma Make often showed light first).
7. **Prompt injection via memory/project instructions** — by design those strings enter the system prompt; treat them as user-influenced.

---

## 18. Glossary

| Term | Meaning |
|------|---------|
| **Aether Cloud** | Hosted access mode; server keys; branded model catalog |
| **BYOK** | Bring your own key; browser-held provider credentials |
| **Harness** | Classify → optional clarify → depth budgets for tool steps |
| **Artifact** | Model-produced living document in the inspector |
| **Vault** | User notes workspace (account DB or localStorage) |
| **Project** | Named instruction scope bound to conversations |
| **BUZZ** | Preferred OpenAI-compatible gateway for Claude/ChatGPT families |
| **OpenRouter** | Multi-model API used for long-tail + failover |
| **assistant-ui** | React library for chat threads, composers, and message actions |
| **Cloud mode** | `DATABASE_URL` or PGlite configured **and** user signed in |
| **FAK / streaming** | *(not used)* — Aether streams tokens; Stop cancels the stream |
| **Match website layout** | Unrelated folder; not part of this product |

---

*End of technical design — describes the current implementation in `src/`.*
