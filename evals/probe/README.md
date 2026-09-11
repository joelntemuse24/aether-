# Aether probe harness

Repeatable, machine-readable breakage probe for hosted Aether (Fast and Expert). This is not a quality rubric — it fires the capability-gap seed pack and fails on the failure modes Joel was firefighting: blank transcripts, raw DSML/tool XML, client/Application errors, `This step failed`, `ZoneInfoNotFoundError`, stuck Stop, duplicate Working strips, and no answer after N seconds.

## Layout

| Path | What |
| --- | --- |
| `prompts.json` | Seed prompts + `harvested[]` placeholders for Grok-harvested hard prompts |
| `run.ts` | CLI (`npm run probe`) |
| `detectors.ts` | Pass/fail heuristics |
| `client.ts` | Headless hosted turn via Head Start → `/api/chat` fallback |
| `last-report.json` / `last-report.md` | Latest run (gitignored) |

Categories: `math`, `cite-search`, `fetch-extract`, `pptx-xlsx`, `github-list`, `time-dublin`, `research-deep`, `blank-survival`.

## How to run

Offline / CI (no model spend — fixtures + pack checks):

```bash
npm run probe
# or
npm run probe:smoke
```

Live against local / preview / prod (small Fast subset):

```bash
AETHER_PROBE_BASE_URL=http://localhost:3000 npm run probe:smoke -- --live
AETHER_PROBE_BASE_URL=https://YOUR-PREVIEW.vercel.app npm run probe:smoke -- --live
```

Full seed pack on Fast + Expert (spendier):

```bash
AETHER_PROBE_BASE_URL=https://YOUR-PROD-OR-PREVIEW npm run probe:full -- --live
```

Filter:

```bash
AETHER_PROBE_BASE_URL=… npm run probe:full -- --live --tier expert --id time-dublin
AETHER_PROBE_BASE_URL=… npm run probe:full -- --live --category math,time-dublin
```

## Env (do not commit secrets)

| Variable | Purpose |
| --- | --- |
| `AETHER_PROBE_BASE_URL` | Target origin (`https://…` or `http://localhost:3000`) |
| `AETHER_PROBE_COOKIE` | Optional `Cookie` header (Auth.js session / preview protection) |
| `AETHER_PROBE_SESSION_TOKEN` | Optional `Authorization: Bearer …` |
| `AETHER_PROBE_TIERS` | `fast`, `expert`, or `fast,expert` |
| `AETHER_PROBE_TIMEOUT_MS` | Override per-prompt timeout |

Hosted keys (`OPENROUTER_API_KEY`, optional Buzz) stay on the **server** you point at. The probe never embeds keys.

`/api/chat` is not session-gated for hosted Cloud. A cookie/token is only needed for preview auth walls or signed-in connectors (GitHub list, Drive). A “not connected” tool reply is **not** a probe failure; a crash / blank / DSML dump is.

## How it hits chat

1. `GET /api/hosted/status` — hosted available? `chatTransport: durable | request`
2. If durable: `POST /api/chat/head-start` with the same `metadata` shape as the browser (`accessMode: hosted`, `speedTier`, model from `resolveCloudTierModel`). Server still uses `resolveHostedRoute`.
3. On 404/503 (Trigger unset): `POST /api/chat` with `buildChatHeaders`-compatible `x-access-mode` / `x-speed-tier` / `x-tools`.
4. Parse UIMessage SSE. Run detectors. Write `evals/probe/last-report.json` + short markdown.

## Grok harvest

Leave `harvested[]` rows in `prompts.json` with `"enabled": false` and an empty `prompt`. When hard prompts land, paste the text, set `"enabled": true`. The runner picks them up on the next `--all` run. No code change.

## Playwright?

Not required. Hosted chat is already an HTTP API. If a preview is behind a browser-only wall that a cookie/token cannot pass, add Playwright later as `npm run probe:ui` with `AETHER_PROBE_BASE_URL` + the same cookie env — do not hardcode secrets.

## Joel / Grok Bot — next invoke

```bash
# 1) CI / PR: keep this green (offline smoke)
npm test
npm run probe:smoke

# 2) After a preview deploy
AETHER_PROBE_BASE_URL=https://<preview> AETHER_PROBE_COOKIE='<optional>' \
  npm run probe:smoke -- --live

# 3) Nightly / after a suspected regression (Fast + Expert, full pack)
AETHER_PROBE_BASE_URL=https://<prod-or-preview> \
  npm run probe:full -- --live

# 4) Read the failure report
cat evals/probe/last-report.md
```

Exit code 1 only on **live** failures. Offline smoke stays green so CI does not spend tokens.

A hosted 200 that still leaks `Missing Authentication header` / `ZoneInfoNotFoundError` / raw DSML is a **fail**. Point `--live` at a preview/prod box whose server keys actually work.
