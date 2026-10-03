# Native agent engine

`AETHER_AGENT_ENGINE` is unset in production. Chat stays on TrueForge (or the legacy in-process path). Set it to `native` only after the VM process below answers `/health`.

The browser still posts `/api/chat` and still reads an AI SDK UI message stream. Vercel mints a short-lived turn token (user, conversation, allowed tool names, approval mode, expiry, request id), then proxies the VM's NDJSON `{ id, chunk }` stream. Chunk objects are the existing `UiChunk` values. No API key is written into the token, the JSON body, or a log line. An OpenRouter key arrives as the `x-openrouter-key` header for that request only.

`AETHER_AGENT_TRANSPORT=direct` is rejected. The browser does not connect to the VM yet.

A normal attempt writes text and tool chunks as the model produces them, so those rows show up during the turn. Error, finish, and other control chunks stay held until that attempt has shown text or a tool. The AI SDK client treats the first `error` chunk as a failed chat and stops reading, so forwarding it early would make a silent retry invisible. A failure before any text or tool chunk still retries with the original history and then streams the next attempt. After text or tools have been forwarded, a transient failure writes `{ "type": "error", "errorText" }` and stops. The thread already shows that with Retry. There is no stream part that clears parts already applied (`start` only sets the message id), so this path does not append a second answer onto the partial. Callers that omit `onChunk` still buffer until the attempt is committed.

Web tools (`web_search`, `fetch_url`, `browse_page`, `current_time`) run in this process. Page fetches use the same public-URL check as the rest of Aether. Account tools (memory, artifacts, project knowledge, Drive, and the GitHub reads on the live tool list) are not executed here. The VM POSTs the tool name and arguments to `POST /api/hermes/aether-tools` with the turn token as the bearer. Vercel checks that token, then reads Drive and GitHub tokens on the server. The token does not contain those secrets, and this process does not receive them. A callback origin that is missing, loopback, or private is refused, and those account tools are left off the prompt. Sandbox tools are not attached. This process does not change `/opt/aether/sidecar-only.ts`.

## Env

Vercel, only when the VM process is up:

| Name | Value |
| --- | --- |
| `AETHER_AGENT_ENGINE` | `native` |
| `AETHER_AGENT_URL` | HTTPS origin that reaches the agent port. Not the TrueForge sidecar origin. |
| `AETHER_TRUEFORGE_TOKEN` | Same bearer the VM checks. Already set for the sidecar. |
| `AETHER_AGENT_TRANSPORT` | Omit or `proxy`. |

VM process environment:

| Name | Value |
| --- | --- |
| `AETHER_TRUEFORGE_TOKEN` | Required. The process refuses to listen without it. |
| `AETHER_AGENT_HOST` | `127.0.0.1` (default). Do not publish this port on the public internet. |
| `AETHER_AGENT_PORT` | `8792` (default). |
| `AETHER_HOSTED_BUZZ_API_KEY` | Hosted model key. `AETHER_HOSTED_CLAUDE_API_KEY` is the legacy alias. |
| `AETHER_HOSTED_BUZZ_BASE_URL` | Optional. Normalized to Buzz `/v1`. |

Do not set `AETHER_TOOL_CONTEXT_KEY` on the VM. Do not put user API keys in the VM environment. Account tools need `AETHER_APP_URL` on Vercel (the public origin, not a Deployment Protection URL). The proxy sends that origin with the turn. The image command for the sidecar stays `npx tsx src/lib/trueforge/vm-server.ts`. The agent overrides that command.

## VM deploy

Do not run these from CI. The same pm2 daemon also runs `echomancer-takehome`. This repo does not start a second pm2 app. The tool registry does not start `aether-agent`. The process and TLS wait until after the sandbox change, with an explicit go-ahead.

1. Deploy the sidecar the way it already ships: `/opt/aether/deploy.sh`, then `deploy/trueforge/health-gate.sh <previous-sha>`. That script only runs `pm2 reload aether`. It does not reload anything else and it does not restart systemd unit `pm2-aether`.
2. Confirm before creating a pm2 process for the agent. The intended command, as user `aether` from `/opt/aether`, after that confirmation:

```bash
pm2 start npx --name aether-agent -- tsx src/agent-server/server.ts
```

3. Ready check (manual): `curl -sS http://127.0.0.1:8792/health` returns `{"ok":true}`. Other routes need `Authorization: Bearer <AETHER_TRUEFORGE_TOKEN>`.
4. Put TLS in Caddy (or the existing tunnel) in front of `127.0.0.1:8792`. Point Vercel `AETHER_AGENT_URL` at that HTTPS origin. Then set `AETHER_AGENT_ENGINE=native`.

`docker compose up` still starts only the TrueForge service. The agent service is the `agent` profile: `docker compose --profile agent up`. Its container listens on `0.0.0.0` inside the network namespace and publishes `127.0.0.1:8792` on the host.
