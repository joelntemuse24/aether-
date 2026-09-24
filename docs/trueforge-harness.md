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
| `TRUEFORGE_PORT` | Sidecar port. Default `8790`. Next proxies `/api/v1/*` to it. |
| `APP_DATA_DIR_SUFFIX` | SQLite directory suffix. Default `aether`. |
| `AETHER_TRUEFORGE=0` | Do not start the sidecar, do not proxy `/api/v1`, and let Trigger own hosted turns again. |

Keys are read on the server at sidecar boot and upserted into TrueForge. They are not written to git or sent to the browser.

## Run locally

Node.js `>=22.14` (the TrueForge package requirement). From the repo root:

```bash
npm install
# .env.local — at least AETHER_HOSTED_BUZZ_API_KEY for Luna
npm run dev
```

Open http://localhost:3000. The first request waits until the sidecar answers `/api/v1/capabilities`. SQLite lives under the OS app-data dir for `trueforge` with suffix `aether`.

`npm run dev` and `npm run start` run `src/lib/trueforge/dev-server.ts`, which starts the sidecar and then Next. You do not run `npx trigger.dev` for this chat.

## What still uses the old path

- BYOK turns still use the in-process `/api/chat` loop. TrueForge handles hosted Expert only.
- `AETHER_TRUEFORGE=0` sends hosted turns through Trigger when `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_ID` are set, otherwise the in-process loop.
- Auth.js, Neon / PGlite conversations, Drive, and GitHub connectors stay on the Next app. TrueForge session ids are mapped from the Aether conversation id inside the server process.

## Deferred

- Sandbox provider credentials (Daytona and others)
- Full MCP OAuth redirect parity when the public origin differs from the sidecar bind address
- Hosted Postgres + Redis (this cut is standalone SQLite)
- Vercel serverless: the sidecar is a long-lived process beside `next start`, not a function
- Customer BYOK inside TrueForge (hosted Expert keys only)
