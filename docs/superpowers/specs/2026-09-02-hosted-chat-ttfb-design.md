# Hosted chat TTFB: first-send path + Head Start

**Date:** 2026-09-02  
**Status:** Implementation spec (Joel’s TTFB goal)

## Goal

Guest hosted first visible token should sit near provider TTFB, not ~15s. Collapse every wait that is not the model itself.

Measured 2026-09-02 (guest Claude Sonnet 5, “Reply with the single word pong”): **15.41s** to first token. ~8s after send before `POST /api/chat/start-session`; start-session ~989ms; append ~935ms; ~5.7s on SSE until first token.

## Confirmed causes

1. **~8s client gap.** `waitForChatHistoryReady()` defaulted to **8000ms**, and composer send **awaited** `threadListItem().initialize()` (conversation create + `/c/<id>` via ThreadUrlSync) before `composer.send()`. Send must hit the network immediately; URL can lag.
2. **~6s agent cold start.** First turn waited for the durable run to boot before `streamText`. Head Start runs step 1 on warm Next while the agent boots. Preload is not used (idle compute if the user never sends).

## First-send path

- New empty chat from `/`: do **not** wait for history hydrate.
- Existing thread with stored history: wait at most 250ms.
- Do **not** await initialize / router replace before send. Bind the durable `useChat` id, fire-and-forget initialize so `/c/<id>` updates in the background.
- Heuristic classify stays sync for shallow turns (pong). Do not add round-trips.

## Head Start (first turn only)

- Transport `headStart: "/api/chat/head-start"`.
- Handler: `chat.headStart` from `@trigger.dev/sdk/chat-server`. Creates the session + handover-prepare run in one control-plane call (collapses start-session + append on first send). Mint-token is not on this path.
- `run` uses schema-only tools (`src/lib/harness/tool-schemas.ts`), same hosted Buzz-first / BYOK model as the agent, `stopWhen` owned by the SDK (`stepCountIs(1)`).
- BYOK keys stay in AsyncLocalStorage for the warm `streamText` call. Wire `metadata` is `sessionSafeChatClientData` (no `apiKey`). Context JWT is minted here like start-session.
- `maxDuration = 60`. Long tool loops stay on the agent. Do not put the whole loop on Vercel 300.
- Turn 2+ writes `session.in` with the PAT from response headers. `accessToken` / `start-session` remain for refresh / missing session.

## Non-goals

- Inventing `TRIGGER_PROJECT_ID` (prod is `proj_mlxwkrtqbzhzbhuqgucc`).
- Naming Trigger / Hermes / Buzz / Vercel / OpenRouter in product UI.
- Preload (speculative idle billing).
- Deleting Railway / Hermes files.
