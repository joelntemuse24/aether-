# Native agent engine

`AETHER_AGENT_ENGINE` is unset in production. Chat stays on TrueForge (or the legacy in-process path). Set it to `native` only after the VM process below answers `/health`.

The browser still posts `/api/chat` and still reads an AI SDK UI message stream. Vercel mints a short-lived turn token (user, conversation, allowed tool names, approval mode, expiry, request id), then proxies the VM's NDJSON `{ id, chunk }` stream. Chunk objects are the existing `UiChunk` values. No API key is written into the token, the JSON body, or a log line. An OpenRouter key arrives as the `x-openrouter-key` header for that request only.

`AETHER_AGENT_TRANSPORT=direct` is rejected. The browser does not connect to the VM yet.

A normal attempt writes text and tool chunks as the model produces them, so those rows show up during the turn. Error, finish, and other control chunks stay held until that attempt has shown text or a tool. The AI SDK client treats the first `error` chunk as a failed chat and stops reading, so forwarding it early would make a silent retry invisible. A failure before any text or tool chunk still retries with the original history and then streams the next attempt. After text or tools have been forwarded, a transient failure writes `{ "type": "error", "errorText" }` and stops. The thread already shows that with Retry. There is no stream part that clears parts already applied (`start` only sets the message id), so this path does not append a second answer onto the partial. Callers that omit `onChunk` still buffer until the attempt is committed.

`fetch_url`, `browse_page`, and `current_time` run in this process. Page fetches use the same public-URL check as the rest of Aether. `web_search` does not scrape from the VM. It POSTs to `POST /api/hermes/aether-tools` with the turn token, and Vercel runs the same `runWebSearch` live chat uses (existing search keys when they are set, otherwise the keyless sources). A missing or private callback origin returns "Search is unavailable this turn." An HTTP 202 or any other non-200 from a search source is an error the model sees, not an empty result list. Account tools (memory, artifacts, project knowledge, Drive, and the GitHub reads on the live tool list) use that same callback. Vercel checks the turn token, then reads Drive and GitHub tokens on the server. The token does not contain those secrets, and this process does not receive them. A callback origin that is missing, loopback, or private is refused, and those account tools are left off the prompt.

`sandbox_exec` and `sandbox_files` run in this process when `bwrap` is on `PATH`. The sandbox is bubblewrap with `--unshare-net` (no network), `--clearenv` (host API keys stay out), and `--die-with-parent`. CPU, virtual memory, and process-count limits are separate `ulimit` calls inside the sandbox (`ulimit -v`, then `ulimit -p`, then `ulimit -t`: 30 CPU seconds, 2048 MB virtual address space, 64 processes). `/bin/sh` on Ubuntu is dash, which accepts one limit per call and has no `-u`. At most two sandbox commands run at once; each still has its own 2048 MB virtual limit. The wall clock is 60 seconds; abort and that timer SIGKILL the bubblewrap process. The directory name is the user (or guest cookie) id plus the conversation id, under `AETHER_SANDBOX_DIR` or `~/.local/share/aether-agent/sandboxes`. A turn with no user id or no conversation id does not use a shared folder; the sandbox is refused with "The sandbox is unavailable this turn." The chat route mints a conversation id when the browser did not send one. Startup and the first use of a workspace call `pruneOldSandboxes` from `src/lib/trueforge/sandbox-prune.ts` and delete directories whose newest file is older than six hours. If `bwrap` is missing or refuses to start, those tools are left off the prompt and a call returns "The sandbox is unavailable this turn."

Charts, spreadsheets, and decks the command writes (`pptx`, `xlsx`, `png`, `csv`, `pdf`, and the other image types) are posted back to Vercel with the turn token and stored with the existing file and artifact helper. Signed-in cloud users get `/api/artifacts/<id>/download`. Guests get a data URL in the thread. The tool result and the file card do not include `/workspace`, a host path, or a `sandbox:` link.

Python 3 is the command inside that sandbox (`python3`). Charts, spreadsheets, and decks need these packages installed on the VM so they are visible through the read-only `/usr` bind. This repo does not install them. `pip install` inside the sandbox fails because there is no network. Install into the system environment, not a user site outside `/usr`:

```bash
sudo apt-get install -y bubblewrap python3 python3-numpy python3-pandas python3-matplotlib python3-openpyxl
python3 -m pip install python-pptx
# python3-pptx when the distro package exists
python3 -c "import pandas, numpy, matplotlib, openpyxl, pptx"
```

`bubblewrap` is already installed on the Aether VM, along with `socat` and `ripgrep` for the TrueForge sidecar. The native sandbox does not use `socat` (it has no network). Matplotlib uses the Agg backend and writes image files into the workspace. Debian's matplotlib looks for `/etc/matplotlibrc`, which this sandbox does not bind. A matplotlib install under `/usr/local` finds its own data files and is what the VM uses.

`sandbox_exec` and `sandbox_files` run in Ask and Auto. The sandbox has no network, and a confirmed card does not resume a paused tool yet, so a card would stop the command. Account writes and other external writes still show a confirm card. Destructive risk is not used for the sandbox: that would also wait in Auto.

Tool order on a tools-enabled turn is web, then sandbox, then account. GPT and Claude keep all 16. Gemini keeps 12 (web, sandbox, and account tools through `drive_read`). Unknown families keep the first four, which are the web tools. This process does not change `/opt/aether/sidecar-only.ts`.

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
| `AETHER_SANDBOX_DIR` | Optional. Conversation workspaces. Default `~/.local/share/aether-agent/sandboxes`. |

Do not set `AETHER_TOOL_CONTEXT_KEY` on the VM. Do not put user API keys in the VM environment. Account tools need `AETHER_APP_URL` on Vercel (the public origin, not a Deployment Protection URL). The proxy sends that origin with the turn. The image command for the sidecar stays `npx tsx src/lib/trueforge/vm-server.ts`. The agent overrides that command.

## VM deploy

Do not run these from CI. The same pm2 daemon also runs `echomancer-takehome`. This repo does not start a second pm2 app and does not start `aether-agent`. The process and TLS still wait for an explicit go-ahead. Before that process is started, install the packages in the sandbox section above if `python3 -c "import pandas, numpy, matplotlib, openpyxl, pptx"` fails. Do not `apt-get` from this repo.

1. Deploy the sidecar the way it already ships: `/opt/aether/deploy.sh`, then `deploy/trueforge/health-gate.sh <previous-sha>`. That script only runs `pm2 reload aether`. It does not reload anything else and it does not restart systemd unit `pm2-aether`.
2. Confirm before creating a pm2 process for the agent. On this VM the checkout is `/opt/aether/app` (not `/opt/aether`). The intended command, as user `aether`, after that confirmation:

```bash
pm2 start npx --name aether-agent --cwd /opt/aether/app --max-memory-restart 700M -- tsx src/agent-server/server.ts
```

`700M` is the recommended Node restart limit. The agent and the live sidecar share one 2G cgroup (`MemoryMax`). A loaded agent process was about 290 MB; 700M restarts a leak before it crowds the sidecar. `pm2 start npx` only measures the npm wrapper, so that flag does not see the Node process until pm2's child is Node itself. Do not launch with `--interpreter node --node-args "--import tsx"`: `isDirectRun()` checks `process.argv[1]`, the process exits 0, and pm2 restart-loops. At most two sandbox commands run at once. The 2048 MB figure is virtual address space per command, not RSS.

3. Ready check (manual): `curl -sS http://127.0.0.1:8792/health` returns `{"ok":true}`. Other routes need `Authorization: Bearer <AETHER_TRUEFORGE_TOKEN>`.
4. Put TLS in Caddy (or the existing tunnel) in front of `127.0.0.1:8792`. Point Vercel `AETHER_AGENT_URL` at that HTTPS origin. Then set `AETHER_AGENT_ENGINE=native`.

`docker compose up` still starts only the TrueForge service. The agent service is the `agent` profile: `docker compose --profile agent up`. Its container listens on `0.0.0.0` inside the network namespace and publishes `127.0.0.1:8792` on the host.
