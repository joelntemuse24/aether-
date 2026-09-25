# TrueForge harness

The chat the user sees is the existing Aether shell: cream canvas, Inter chrome, Cormorant assistant text, terracotta, the composer, sidebar, “Worked for Ns” status, confirm cards, and the artifact panel. TrueForge (`@truefoundry/trueforge`) runs the agent loop in a local sidecar. Hosted Expert turns go to its session and turn APIs. The stream is translated into the AI SDK chunks that shell already renders. Trigger.dev is not on this path.

`AETHER_TRUEFORGE=0` restores the previous hosted path (Trigger when configured, otherwise the in-process `/api/chat` loop).

## Env

| Variable | Purpose |
| --- | --- |
| `AETHER_HOSTED_BUZZ_API_KEY` | Buzz token. Seeds GPT-5.6 Luna (`buzz/gpt-5-6-luna`) as the Expert default. |
| `AETHER_HOSTED_BUZZ_BASE_URL` | Buzz base. `https://api.buzzai.cc` is normalized to `https://api.buzzai.cc/v1`. |
| `AETHER_HOSTED_CLAUDE_API_KEY` / `AETHER_HOSTED_CLAUDE_BASE_URL` | Legacy aliases for the Buzz key and base URL. |
| `OPENROUTER_API_KEY` | Not used by TrueForge chat. Other features may still read it. |
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api/v1`. |
| `AETHER_TRUEFORGE_URL` | Remote sidecar origin, for example `https://forge.example.com`. Unset uses loopback. |
| `AETHER_TRUEFORGE_TOKEN` | Shared secret. Required with the URL. Sent as `Authorization: Bearer`. |
| `TRUEFORGE_PORT` | Public port. Default `8790`. |
| `APP_DATA_DIR_SUFFIX` | SQLite directory suffix. Default `aether`. |
| `AETHER_TRUEFORGE=0` | Do not use the sidecar. Trigger owns hosted turns when it is configured. |

Keys are read on the server at sidecar boot and upserted into TrueForge. They are not written to git or sent to the browser.

## Run locally

Node.js `>=22.14` (the TrueForge package requirement). From the repo root:

```bash
npm install
# .env.local — at least AETHER_HOSTED_BUZZ_API_KEY for Luna
npm run dev
```

Open http://localhost:3000. The dev process waits until the sidecar answers `/api/v1/capabilities`, seeds providers, then starts Next. A seed failure stops boot. SQLite lives under the OS app-data dir for `trueforge` with suffix `aether`.

Hosted turns send session instructions and file attachments as data-URI parts. The composer model chip sends the chosen Buzz model as `x-model`. GPT ids use the Buzz OpenAI-compatible provider (`buzz/…`). Claude ids use Buzz's Anthropic-compatible provider (`anthropic/…`, base `https://api.buzzai.cc/v1`). Unknown ids fall back to `gpt-5.6-luna`. Text, reasoning, and tool deltas stream as they arrive. A turn waits about 20 seconds for the first byte, then retries the same model once on a transient error (5xx, Cloudflare 525, network). If it still fails, the thread shows an error and Retry. A model that Buzz says is not enabled for the key is marked unavailable in the picker for the session. There is no OpenRouter failover on this path. Reasoning effort is `none`. A restarted Next process reuses the sidecar session and skips the session update when the model, instructions, and tool context are unchanged.

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
- Running TrueForge inside a Vercel function. Point `AETHER_TRUEFORGE_URL` at the VM instead. If that URL is unset or the VM does not answer, hosted chat uses the in-process loop.
- Customer BYOK inside TrueForge (hosted Expert keys only)
- Source chips and a structured ask-user card. `tool.response_required` is a sentence in the thread; connect-to-continue is text for `mcp.auth_required`

## Tools

Web search, page fetch, and browse are preloaded on one MCP server, so the model calls them by name. The prompt includes the current UTC time. TrueForge's `get_current_datetime` is the only clock tool; Aether's `current_time` is not attached. Memory, artifacts, Drive, and GitHub join that same preloaded server only when the turn has memory, Drive, GitHub, or a project. A second server with deferred loading is not registered: TrueForge then tells the model to discover every tool, and some models do that before `web_search`. All of them run on Vercel through `POST /api/trueforge/mcp`. Sessions set `config.sandbox.enabled` only when `GET /api/v1/capabilities` reports a sandbox. The sidecar shortens TrueForge's sandbox prompt (no skills text when none are mounted) and deletes local sandbox directories whose newest file is older than six hours. Skills stay unset; TrueForge has no built-in xlsx, docx, or pdf skills, and an unknown skill name rejects the session. `BRAVE_SEARCH_API_KEY` and `FIRECRAWL_API_KEY` stay in Vercel env. Writes (`memory_write`, `create_artifact`) return the existing confirm card. Set `AETHER_APP_URL` to the public origin the VM can reach. Locally that is `http://127.0.0.1:3000`, and the sidecar allowlists `127.0.0.1` and `localhost`. Drive and GitHub tokens travel in an AES-GCM header keyed from `AETHER_TRUEFORGE_TOKEN`. The sidecar stores that ciphertext, not the tokens.

## VM

The sidecar is a long-lived process. Vercel only calls it.

Install Docker (or Node.js `>=22.14` and this repo) on the Linux box.

On the VM:

| Variable | Purpose |
| --- | --- |
| `AETHER_TRUEFORGE_TOKEN` | Shared secret. The process refuses to listen without it. |
| `AETHER_HOSTED_BUZZ_API_KEY` | Buzz token. Seeded at boot. |
| `AETHER_HOSTED_BUZZ_BASE_URL` | Optional. `https://api.buzzai.cc` becomes `https://api.buzzai.cc/v1`. |
| `OPENROUTER_API_KEY` | Optional fallback. |
| `OPENROUTER_BASE_URL` | Optional. Default `https://openrouter.ai/api/v1`. |

Docker:

```bash
cd deploy/trueforge
# export the variables above, then:
docker compose up -d --build
```

Without Docker, from the repo root: `npm install` then `npm run trueforge`.

A launcher outside this repo, such as `/opt/aether/sidecar-only.ts`, should call `prepareSidecar()` from `src/lib/trueforge/sidecar-bootstrap.ts` before it starts TrueForge. That applies the package patch and starts sandbox pruning. `npm run trueforge` and `npm run dev` already call it.

Open port `8790` only to the HTTPS proxy, not to the public internet. `GET /health` is unauthenticated and reports whether TrueForge is up. Every other request needs `Authorization: Bearer <AETHER_TRUEFORGE_TOKEN>`.

Put HTTPS in front before Vercel calls it. Caddy: reverse-proxy `localhost:8790` and let it get a certificate. Or run `cloudflared tunnel` to that port. Do not terminate TLS inside this container.

On Vercel:

| Variable | Purpose |
| --- | --- |
| `AETHER_TRUEFORGE_URL` | `https://` origin of the VM. No path. |
| `AETHER_TRUEFORGE_TOKEN` | The same secret as the VM. |

Leave the Buzz key on the VM. OpenRouter is not used for these turns. If the URL is unset, the token is missing, or the VM does not answer `/api/v1/capabilities`, hosted chat uses the in-process loop.
