# Trigger.dev `chat.agent` as the live chat path

**Date:** 2026-09-02  
**Status:** Implementation spec (Joel’s request)

## Goal

Hosted Cloud and BYOK chat turns run as a Trigger.dev `chat.agent` (`id: chat.agent`) with `useChat` + `useTriggerChatTransport`. Vercel keeps the cream UI, Auth.js, Settings, Neon, and Drive/GitHub connectors. Trigger is not a Next host. Idle sessions suspend and cost nothing. No Vercel `maxDuration` 300 wall clock on the live path.

## Non-goals

- Trigger Head Start (first tokens on Next) — explicitly out.
- Deleting Railway / Hermes files — they stay unused.
- Inventing a Trigger project ref — `TRIGGER_PROJECT_ID` comes from the operator’s dashboard.
- Showing the words Trigger, Vercel, Hermes, Buzz, Railway, or OpenRouter in product UI.

## Transport selection

| Env | Client transport |
| --- | --- |
| `TRIGGER_SECRET_KEY` **and** `TRIGGER_PROJECT_ID` set | `useTriggerChatTransport` → Trigger session |
| Either missing | Existing `AssistantChatTransport` → `POST /api/chat` |

`GET /api/hosted/status` includes `chatTransport: "durable" | "request"` (internal JSON; not shown in UI).

## BYOK keys

Keys stay in the browser (`aether:settings:v1`). They are **not** stored in Trigger env, Neon, logs, or anything we persist.

Per turn, the client sends `accessMode`, `provider`, `apiKey`, optional `baseURL` as Trigger `clientData` / per-turn metadata. Hosted turns omit the key; the worker uses `OPENROUTER_API_KEY` / `AETHER_HOSTED_BUZZ_*` already on the worker env.

Helpers:

- `redactChatClientData` — logs
- `persistableChatClientData` — strips `apiKey` (and any connector tokens) before DB / snapshot writes

## Session routes (thin)

- `POST /api/chat/start-session` — Auth.js optional, validate hosted vs BYOK, mint a signed Aether context JWT, call `chat.createStartSessionAction("chat.agent")`, return `{ publicAccessToken }`.
- `POST /api/chat/mint-token` — mint a session-scoped Trigger PAT (`read` + `write` sessions:{chatId}).

Guests can chat (same as today). Do not persist BYOK keys.

The context JWT (`purpose: aether-agent-context`) carries user/conversation ids, Ask/Auto, capability flags, and encrypted Drive/GitHub **access** material so Vercel can execute connectors. The worker treats the JWT as opaque and never receives `aether.drive` / `aether.github` cookies. `createStartSessionAction` receives `sessionSafeChatClientData` (no BYOK key); per-turn transport `clientData` still carries the key for that turn only.

## Agent

`src/trigger/chat.ts` — `chat.agent({ id: "chat.agent" })`.

- `run` reuses `runLegacyLocalChat` / hosted `streamText` (playbooks, durable stubs, depth budgets). Spread `chat.toStreamTextOptions({ tools })` first.
- No Head Start. No short turn `maxDuration`.
- `idleTimeoutInSeconds: 30` so idle chats suspend.
- Aether-owned tools (memory, artifacts, Drive/GitHub, confirm cards) `fetch` existing `/api/hermes/aether-tools` with the context JWT. Confirm cards stay on `/api/harness/confirm` + current UIMessage parts (not a Trigger HITL rewrite).

## Fallback

`/api/chat` remains. When Trigger env is unset, the live site is unchanged (including optional Hermes if `HERMES_ENABLED=1`).
