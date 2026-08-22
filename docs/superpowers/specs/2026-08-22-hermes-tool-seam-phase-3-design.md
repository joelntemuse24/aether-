# Hermes tool seam Phase 3 — Design

**Date:** 2026-08-22  
**Status:** Implemented  
**Product constraint:** Users only see the Aether website. Never mention Hermes, Buzz, Railway, or OpenRouter in product UI copy.

## Mechanism (verified)

Official `nousresearch/hermes-agent` chat-completions does **not** accept per-request custom tools ([issue 57431](https://github.com/NousResearch/hermes-agent/issues/57431)). MCP is static at host boot. Therefore Aether:

1. Executes Aether-owned tools on Vercel (`src/lib/hermes/aether-tools.ts`) with the user session. Tokens/cookies never go to the host.
2. Registers a host plugin (`deploy/hermes/plugins/aether-tools`) that HTTP-callbacks `POST /api/hermes/aether-tools` with a shared secret + session key.
3. Same-turn loop: if the model emits OpenAI `tool_calls` or `[[aether_tool]]` fences, Aether executes and continues the completions request on the same HTTP turn.

Do not wire these as in-process `streamText` tools on the hosted path.

## Ask / Auto

- **Ask** (default): mutations (`memory_write`, `create_artifact`) wait on the existing confirm card. Safe reads stay live.
- **Auto**: routine / non-destructive Aether tools run without a tap.
- Always confirm: destructive, spend, third-party submit, delete, writes to someone else's Drive/GitHub, and `request_confirmation`.

Guest preference: `aether:settings:v1`. Signed-in + DB: `user_preferences` via `/api/preferences`.

## Confirm persist

`/api/harness/confirm` is unchanged as the only approval API. Pending rows persist in `pending_confirmations` when cloud DB is on. Guests stay session-local.

## Connectors

Drive/GitHub stay read-only. If not connected, the seam says so. Writes do not exist and are not faked.
