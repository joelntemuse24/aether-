# TrueForge harness

The chat the user sees is the existing Aether shell: cream canvas, Inter chrome, Cormorant assistant text, terracotta, the composer, sidebar, “Worked for Ns” status, confirm cards, and the artifact panel. TrueForge (`@truefoundry/trueforge`) runs the agent loop in a local sidecar. Hosted Expert turns go to its session and turn APIs. The stream is translated into the AI SDK chunks that shell already renders. Trigger.dev is not on this path.

`AETHER_TRUEFORGE=0` restores the previous hosted path (Trigger when configured, otherwise the in-process `/api/chat` loop).

## Env

| Variable | Purpose |
| --- | --- |
| `AETHER_HOSTED_BUZZ_API_KEY` | Buzz token. Seeds GPT-5.6 Luna (`buzz/gpt-5-6-luna`) as the Expert default. |
| `AETHER_HOSTED_BUZZ_BASE_URL` | Buzz base. `https://api.buzzai.cc` is normalized to `https://api.buzzai.cc/v1`. |
| `AETHER_HOSTED_CLAUDE_API_KEY` / `AETHER_HOSTED_CLAUDE_BASE_URL` | Legacy aliases for the Buzz key and base URL. |
| `OPENROUTER_API_KEY` | Optional fallback catalog (`openrouter/gpt-5-6-luna`, sol, terra). |
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api/v1`. |
| `TRUEFORGE_PORT` | Sidecar port. Default `8790`. Bound to `127.0.0.1`. The browser never talks to it. |
| `APP_DATA_DIR_SUFFIX` | SQLite directory suffix. Default `aether`. |
| `AETHER_TRUEFORGE=0` | Do not start the sidecar. Trigger owns hosted turns when it is configured. |

Keys are read on the server at sidecar boot and upserted into TrueForge. They are not written to git or sent to the browser.

## Run locally

Node.js `>=22.14` (the TrueForge package requirement). From the repo root:

```bash
npm install
# .env.local — at least AETHER_HOSTED_BUZZ_API_KEY for Luna
npm run dev
```

Open http://localhost:3000. The dev process waits until the sidecar answers `/api/v1/capabilities`, seeds providers, then starts Next. A seed failure stops boot. SQLite lives under the OS app-data dir for `trueforge` with suffix `aether`.

Hosted turns send the composed system prompt as session instructions and file attachments as data-URI parts. If Buzz errors before any text or tool output, the same turn is retried on `openrouter/gpt-5-6-luna` when that model is seeded. Session ids are stored on the conversation metadata, so a restarted Next process reuses the sidecar session.

Approvals use the existing confirm card. Approving or declining resumes the paused harness turn and appends the assistant text to the thread. Auto-continue does not send a new user message while that card is open.

`npm run dev` and `npm run start` run `src/lib/trueforge/dev-server.ts`, which starts the sidecar and then Next. You do not run `npx trigger.dev` for this chat.

## What still uses the old path

- BYOK turns still use the in-process `/api/chat` loop. TrueForge handles hosted Expert only when the sidecar answers `/api/v1/capabilities`. If it does not, that turn uses the in-process loop.
- `AETHER_TRUEFORGE=0` sends hosted turns through Trigger when `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_ID` are set, otherwise the in-process loop.
- Auth.js, Neon / PGlite conversations, Drive, and GitHub connectors stay on the Next app.

## Deferred

- Sandbox provider credentials (Daytona and others)
- Full MCP OAuth redirect parity when the public origin differs from the sidecar bind address
- Hosted Postgres + Redis (this cut is standalone SQLite)
- Vercel serverless has no sidecar. Hosted turns detect that and use the in-process `/api/chat` loop. No `AETHER_TRUEFORGE=0` flag is required.
- Customer BYOK inside TrueForge (hosted Expert keys only)
- Aether-owned tools (Drive, GitHub, memory, artifacts) are not registered on the TrueForge session
- Source chips, the artifact panel, and a structured ask-user card. `tool.response_required` is a sentence in the thread; connect-to-continue is text for `mcp.auth_required`
