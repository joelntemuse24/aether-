# Remote agent gateway on Railway (trial / free-tier)

Users only use [https://aether-seven-theta.vercel.app/](https://aether-seven-theta.vercel.app/). They never install this host. Do not put this product’s internal host name in the Aether UI.

Aether on Vercel already proxies hosted `/api/chat` to a remote OpenAI-compatible API when `HERMES_BASE_URL` + `HERMES_API_KEY` are set. Those Vercel vars have been empty because there was no host. This folder is that host.

Do **not** deploy the public Railway marketplace Hermes templates. They enable a public dashboard.

## 1. Create a Railway project and connect this repo

1. [railway.com](https://railway.com) → New Project.
2. Deploy from GitHub → `joelntemuse24/aether-`.
3. If the first build starts Railpack/Nixpacks on the Next.js app, cancel it.

## 2. Confirm it builds the gateway image, not Next.js

Railway [Config as Code](https://docs.railway.com/config-as-code) (`railway.toml`) is **deprecated for new services** (hard cutoff 2026-12-01). Do not rely on the toml file alone.

Set this service variable **before** the first successful deploy:

```bash
RAILWAY_DOCKERFILE_PATH=deploy/hermes/Dockerfile
```

This repo also ships:

| File | Why it is here |
|------|----------------|
| Root `railway.toml` and `deploy/hermes/railway.toml` | `builder = "DOCKERFILE"`, `dockerfilePath = "deploy/hermes/Dockerfile"`, healthcheck `/health`, restart on failure. **No `startCommand`.** |
| Root `Dockerfile` | Same image as `deploy/hermes/Dockerfile`. Railway [auto-detects](https://docs.railway.com/builds/dockerfiles) a root `Dockerfile`, so connecting this repo cannot silently Railpack the website. |

Build logs should mention a Dockerfile (`nousresearch/hermes-agent` / `deploy/hermes`). If you see `npm run build` or Next.js, the service is building the website — fix `RAILWAY_DOCKERFILE_PATH` and redeploy.

**Do not set a Railway Start Command.** The official image `ENTRYPOINT` is `entrypoint-dispatch.sh` (s6 supervision). A start command replaces that entrypoint and the API server will not come up cleanly.

Leave **Root Directory** empty (repository root). The Dockerfile `COPY` paths assume that context.

Vercel project `aether` stays on the Next.js builder. Do not switch that project to Docker.

## 3. Public URL

Service → Settings → Networking → Generate domain.

Copy the HTTPS origin **with no trailing slash**. That value is Vercel `HERMES_BASE_URL`.

## 4. Railway variables

Use `deploy/hermes/.env.example` as the checklist. Minimum:

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_KEY="$(openssl rand -hex 32)"
OPENROUTER_API_KEY=          # same key family Aether Cloud already uses
HERMES_DASHBOARD=0
HERMES_GATEWAY_BOOTSTRAP_STATE=running
RAILWAY_DOCKERFILE_PATH=deploy/hermes/Dockerfile
```

Official API server docs: `API_SERVER_KEY` minimum 8 characters. The published image refuses keys shorter than 16. `openssl rand -hex 32` satisfies both.

**Do not set** `API_SERVER_CORS_ORIGINS=*` — Aether calls this host server-to-server.

**Do not set** Telegram / Discord / WhatsApp tokens. Those platforms start when their tokens are present.

**Do not** mount `/var/run/docker.sock`. Terminal is container-local (`terminal.backend: local` in the seed). That is not an unrestricted Railway VM shell.

### Port

Railway injects `PORT` and uses it for the public proxy and [healthchecks](https://docs.railway.com/deployments/healthchecks). Hermes listens on `API_SERVER_PORT` (default **8642**).

This image maps `API_SERVER_PORT=${PORT:-8642}` in `railway-cmd.sh` (and in s6 cont-init `00-aether-port.sh`) so you do **not** replace `ENTRYPOINT`.

If you would rather pin the documented port: set `PORT=8642` and the domain **target port** to `8642`.

## 5. Volume at `/opt/data`

Official data dir is `/opt/data` (config, `.env`, sessions, skills, memory).

Attach a Railway volume there if the plan allows it.

**Trial / free-tier may be ephemeral.** Without a volume, sessions and first-boot config reset on every redeploy.

## 6. RAM (honest)

Official published minimums:

| | Memory |
|--|--------|
| Without browser tools | **1 GB** |
| With Playwright / Chromium | **2–4 GB** |

The first-boot seed disables the `browser` toolset. The smallest trial replica can still OOM — watch metrics and bump RAM if the container is killed.

## 7. Point Vercel at this host

On Vercel project **`aether`**, Production:

```bash
HERMES_BASE_URL=https://YOUR-SERVICE.up.railway.app
HERMES_API_KEY=          # exactly the same string as Railway API_SERVER_KEY
```

No trailing slash on the URL. Optional: `HERMES_PROVIDER=openrouter` (hosted default).

Redeploy Aether after saving.

Users still only open the Aether site. The browser never talks to Railway.

## 8. Verify

```bash
export HERMES_BASE_URL='https://YOUR-SERVICE.up.railway.app'
export HERMES_API_KEY='…'

curl -sS "$HERMES_BASE_URL/health"
# {"status":"ok"}

curl -sS -H "Authorization: Bearer $HERMES_API_KEY" "$HERMES_BASE_URL/v1/models"
```

`/health` is public. `/v1/models` requires the bearer key.

If `/health` never returns 200: check that `API_SERVER_ENABLED=true`, `API_SERVER_HOST=0.0.0.0`, `API_SERVER_KEY` is ≥16 chars, `HERMES_GATEWAY_BOOTSTRAP_STATE=running` on a first boot, and that Start Command is empty.

## What was verified (not guessed)

| Topic | Source |
|-------|--------|
| Image `nousresearch/hermes-agent:latest`, volume `/opt/data`, command `gateway run` | [Docker user guide](https://hermes-agent.nousresearch.com/docs/user-guide/docker) |
| `ENTRYPOINT` = `entrypoint-dispatch.sh` → s6 `/init` when the image owns PID 1; empty official `CMD` | [Official Dockerfile](https://github.com/NousResearch/hermes-agent/blob/main/Dockerfile) and live `nousresearch/hermes-agent:latest` amd64 config (2026-08-22 06:32 UTC): `Entrypoint=['/opt/hermes/docker/entrypoint-dispatch.sh']`, `Cmd=None`, `User=root`, volume `/opt/data`, `HERMES_HOME=/opt/data`. `HERMES_DASHBOARD` and `API_SERVER_ENABLED` are unset in the stock image. |
| `API_SERVER_ENABLED` / `HOST` / `PORT` / `KEY` (min 8), default port **8642**, `GET /health` and `GET /v1/models` | [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) |
| `direct_model_requests` under `gateway.platforms.api_server` | Same API server page |
| OpenRouter via `OPENROUTER_API_KEY` + `model.provider: openrouter` | [Providers](https://hermes-agent.nousresearch.com/docs/integrations/providers) |
| `tool_loop_guardrails.hard_stop_enabled` for unattended gateways | Docker user guide |
| Dashboard only when `HERMES_DASHBOARD=1` | Docker user guide (do not enable) |
| First-boot `HERMES_GATEWAY_BOOTSTRAP_STATE=running` | Official env reference / image stage2 hook |
| Railway `PORT` + healthcheck path; `startCommand` overrides Dockerfile entrypoint | [Healthchecks](https://docs.railway.com/deployments/healthchecks), [start commands](https://docs.railway.com/builds/build-and-start-commands) |
| Official RAM table (1 GB / 2–4 GB) | Docker user guide → Resource limits |

Local VPS compose (not Railway) is in `docker-compose.example.yml`.
