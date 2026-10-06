# HARNESS.md

Read this before changing Aether. It lists the rules that keep the product true. Each rule has an enforcement status:

- **deterministic** — a test or script fails when the rule breaks. The check path is the source of truth.
- **agent** — a person or coding agent must apply the rule. No automated check owns it yet.
- **unverified** — the rule is intended, and nothing checks it yet.

## Topology

Aether is a Next.js 15 app. Production is Vercel project `aether-seven-theta` plus the Contabo VM sidecar. The VM process is `tsx /opt/aether/sidecar-only.ts` under pm2 app `aether`. Trigger.dev is not the live chat path. Railway and the root `Dockerfile` are unused.

TrueForge defaults to `STANDALONE=true` with SQLite. Hosted Postgres + Redis activates only when both database and Redis environment variables are set. Deploy through the health gate only, which reloads pm2 app `aether`; never touch `echomancer-takehome`.

| Rule | Status | Check |
| --- | --- | --- |
| Production is Vercel plus the VM sidecar. Do not treat Railway or the root Dockerfile as the deploy path. | agent | `README.md`, `docs/trueforge-harness.md` |
| Only pm2 app `aether` may be reloaded. Do not `systemctl restart pm2-aether` and do not touch `echomancer-takehome`. | deterministic | `deploy/trueforge/health-gate.sh`, `src/lib/trueforge/harness-rules.test.ts` |
| Do not edit `/opt/aether/sidecar-only.ts` from the repo. It imports `prepareSidecar`, `load-env`, and `seed`. | agent | `docs/trueforge-harness.md` |
| Node is `>=22.14`. | deterministic | `package.json` `engines`, `src/lib/trueforge/hygiene.test.ts` |

## Keys

Hosted Buzz keys live on Vercel and on the VM sidecar env. The hosted default is Free auto (`free-only` → `omniroute/free-only`; Contabo OmniRoute combo `free-only`, cost 0) on a loopback OmniRoute provider: `AETHER_HOSTED_OMNIROUTE_BASE_URL` (default `http://127.0.0.1:20128/v1`) and optional `AETHER_HOSTED_OMNIROUTE_API_KEY` (empty uses the dummy `local`) in the VM sidecar env. `AETHER_HOSTED_OPENROUTER_API_KEY` in the VM sidecar env optionally seeds one legacy free model; it is the only OpenRouter key seeded into sidecar provider settings. User BYOK keys stay in the browser `localStorage` (`aether:` prefix). They are not written to Neon, Trigger env, or sidecar provider settings.

| Rule | Status | Check |
| --- | --- | --- |
| Do not seed a user OpenRouter key into TrueForge provider settings. The hosted default is Free auto via OmniRoute; only `AETHER_HOSTED_OPENROUTER_API_KEY` seeds OpenRouter. Buzz models stay hidden unless `AETHER_BUZZ_MODELS_ENABLED=1`, and the hosted default is not backed up with a user key. | deterministic | `src/lib/openrouter/models.test.ts`, `src/lib/hosted/default-model.test.ts` |
| `AETHER_TRUEFORGE_TOKEN` is the bearer secret shared with the VM. `AETHER_TOOL_CONTEXT_KEY` encrypts tool context and is Vercel-only. Do not put the context key on the VM. | agent | `docs/trueforge-harness.md`, `src/lib/trueforge/tool-context.ts` |
| Do not log API keys, access tokens, or refresh tokens. | deterministic | `src/lib/trueforge/harness-rules.test.ts` |
| Do not return raw `error.message` from API responses. Log a redacted detail and send a fixed sentence. | deterministic | `src/lib/trueforge/harness-rules.test.ts` |

## Tools and prompts

The system prompt may name only tools attached to that turn. Web tools are `web_search`, `fetch_url`, and `browse_page`. Account tools join the same preloaded MCP server only when memory, Drive, GitHub, or a project is present. `current_time` is not attached. The sidecar patch removes TrueForge's builtin clock.

| Rule | Status | Check |
| --- | --- | --- |
| The prompt's tool names equal the attached MCP tool set. A turn with no registration uses the no-tools note. Playbook and session-skill lines that name tools the turn did not attach (office tools, gated browser actions, skills) are dropped, so guests see web tools and the sandbox only. The prompt carries sandbox facts: relative paths, a network that reaches only pypi.org and github.com, the per-exec timeout, simulations with exec, and the installed python packages. | deterministic | `src/lib/trueforge/harness-rules.test.ts` |
| Sandbox files are published as cards: pptx, xlsx, pdf, and png as download cards; html and svg open in the preview panel. Internal sandbox paths, fenced or unfenced `sandbox_artifacts` blocks, and paths that drop the sandbox subfolder are recovered or removed from the answer. Markdown image and link targets with a `sandbox:` scheme or a relative file name publish through the same download path. A stray `[/sandbox_artifacts]` closing line and model `<thinking>` tags never reach the visible answer. The hosted prompt does not name office tools that are not attached. | deterministic | `src/lib/trueforge/sandbox-files.test.ts`, `src/lib/trueforge/chat-stream.test.ts`, `src/lib/trueforge/harness-rules.test.ts` |
| User-supplied URL fetches go through `src/lib/connectors/url-safety.ts` (`assertPublicHttpUrl`, `fetchWithPublicRedirects`). | deterministic | `src/lib/trueforge/harness-rules.test.ts` |
| Sidecar string patches still match the installed `@truefoundry/trueforge-core` and `@truefoundry/trueforge` packages. A missing target string warns. The sandbox venv is created with `--system-site-packages` so the system-wide python packages (pandas, numpy, openpyxl, python-pptx) are importable, and the jail reads `/usr/share/zoneinfo` so pandas' timezone data loads. Sub-agent system prompts receive the session's date and timezone lines, and the delegated-task tool note tells the parent to include them in the task input. | deterministic | `src/lib/trueforge/harness-rules.test.ts`, `src/lib/trueforge/sidecar-patch.test.ts` |

## UI

The chat shell stays the cream Aether UI. TrueForge events become AI SDK UI chunks. Do not change layout, color, or type unless a design request asks for it.

| Rule | Status | Check |
| --- | --- | --- |
| Visible text, tool parts, and errors follow the UI chunk translator. | deterministic | `src/lib/trueforge/ui-chunks.test.ts` |
| The automatic "Continue from where you left off…" turn stays in the model history but shows no user bubble; the manual Continue button keeps its bubble. | deterministic | `src/lib/chat-continue.test.ts` |
| A sandbox command times out and returns that error to the model. A turn stops before the platform limit, keeps any partial answer, and does not leave the status line on "Running exec". | deterministic | `src/lib/trueforge/sidecar-patch.test.ts`, `src/lib/trueforge/chat-stream.test.ts`, `src/lib/agent-activity.test.ts` |
| Today's date and the user's timezone are in every model's instructions. Answers render common maths and `\text{...}` leftovers. Reasoning headings that ran together are separated, and the reasoning summary in the disclosure drops its `**` markers. A bare top-level `<svg>` renders as an inline image, not raw text, and the svg preview keeps a viewBox-only svg from collapsing to nothing. Each tool call is one step in the single disclosure. | deterministic | `src/lib/trueforge/clock.test.ts`, `src/lib/render-math.test.ts`, `src/lib/agent-activity.test.ts`, `src/lib/visible-chat-text.test.ts`, `src/lib/artifacts/preview-doc.test.ts` |
| No visual redesign without an explicit design ask. | agent | this file |

## Native agent engine

`src/lib/agent` is the model-agnostic loop. `AETHER_AGENT_ENGINE=native` proxies `/api/chat` to the VM agent server (`src/agent-server`) and streams the same UI chunks back. Unset or `trueforge` keeps the current TrueForge / legacy router. `legacy` skips the TrueForge sidecar. The agent process is not pm2 app `aether`. `deploy/trueforge/health-gate.sh` still reloads only `aether`.

| Rule | Status | Check |
| --- | --- | --- |
| Unset or unrecognised `AETHER_AGENT_ENGINE` does not select native. | deterministic | `src/lib/agent/engine.test.ts`, `src/lib/trueforge/harness-rules.test.ts` |
| `legacy` does not select the TrueForge sidecar. | deterministic | `src/lib/agent/engine.test.ts` |
| A native prompt names only the tools attached to that turn. | deterministic | `src/lib/agent/registry.test.ts` |
| Claude is not sent a reasoning effort when the allowed list is empty. | deterministic | `src/lib/agent/profiles.test.ts` |
| A streamed native attempt forwards text and tool chunks as they are produced. Control chunks stay held until that progress exists, so a transient failure before the first token still retries. After text or tools are forwarded, a transient failure emits an `error` chunk and does not append another attempt. | deterministic | `src/lib/agent/loop.test.ts`, `src/agent-server/handler.test.ts` |
| The agent server sources do not import Next, and the proxy forwards chunk objects unchanged. | deterministic | `src/lib/trueforge/harness-rules.test.ts`, `src/lib/agent/proxy.test.ts` |
| Native web tools and `current_time` run on the VM. Account tools call Vercel with the turn token only. Drive and GitHub tokens stay on Vercel. A private callback origin is refused. | deterministic | `src/lib/agent/catalog.test.ts`, `src/lib/agent/web-exec.test.ts`, `src/lib/agent/account-callback.test.ts`, `src/lib/agent/account-on-vercel.test.ts`, `src/agent-server/run-turn.test.ts` |
| `sandbox_exec` and `sandbox_files` use bubblewrap with no network, CPU/memory/pid/time limits, and kill-on-abort. Stale workspaces are removed with `pruneOldSandboxes`. A missing `bwrap` returns "The sandbox is unavailable this turn." | deterministic | `src/lib/agent/sandbox.test.ts`, `src/agent-server/run-turn.test.ts` |

## How to run the checks

`npm test` includes `src/lib/trueforge/harness-rules.test.ts`. GitHub Actions runs that file as its own step in `.github/workflows/ci.yml`, then the full suite.
