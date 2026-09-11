# Aether probe harness

Repeatable breakage probe for hosted Aether (Fast and Expert) on **API and UI**. This is not a quality rubric — it fires the capability-gap seed pack and fails on the modes Joel was firefighting.

API: blank transcripts, raw DSML/tool XML, client/Application errors, `This step failed`, `ZoneInfoNotFoundError`, stuck Stop, duplicate Working strips, no answer after N seconds, leaked upstream auth errors.

UI (Playwright against the wired chrome): blank **Howzit?** after send, duplicate Working strips, raw DSML visible, “Application error” client exception, stuck Stop, missing **Worked for Ns**, “This step failed” without recovery. Failures write a PNG under `evals/probe/artifacts/`.

## Layout

| Path | What |
| --- | --- |
| `prompts.json` | Seed prompts + `harvested[]` placeholders (`surfaces: ["api", "ui"]`) |
| `run.ts` | CLI (`npm run probe` / `probe:ui`) |
| `detectors.ts` | API/SSE pass/fail heuristics |
| `ui-detectors.ts` | DOM snapshot heuristics (Howzit, Working, Stop, Worked for) |
| `client.ts` | Headless hosted turn via Head Start → `/api/chat` |
| `ui-client.ts` | Playwright against the live composer |
| `last-report.json` / `last-report.md` | Latest run (gitignored) |
| `artifacts/` | UI failure screenshots (gitignored) |

Categories: `math`, `cite-search`, `fetch-extract`, `pptx-xlsx`, `github-list`, `time-dublin`, `research-deep`, `blank-survival`.

## How to run

Offline / CI (no model spend, no browser — fixtures + pack checks):

```bash
npm run probe
npm run probe:smoke
npm run probe:ui          # API fixtures + UI detector fixtures
```

Live API against local / preview / prod (small Fast subset):

```bash
AETHER_PROBE_BASE_URL=http://localhost:3000 npm run probe:smoke -- --live
AETHER_PROBE_BASE_URL=https://YOUR-PREVIEW.vercel.app npm run probe:smoke -- --live
```

Live **UI + API** (Playwright):

```bash
npx playwright install chromium   # once per machine
AETHER_PROBE_BASE_URL=https://YOUR-PREVIEW \
  AETHER_PROBE_COOKIE='<optional preview/session cookie>' \
  npm run probe:ui -- --live
```

Full pack on Fast + Expert (spendier):

```bash
AETHER_PROBE_BASE_URL=https://YOUR-PROD-OR-PREVIEW npm run probe:full -- --live --ui
```

Filter:

```bash
AETHER_PROBE_BASE_URL=… npm run probe:full -- --live --ui --tier expert --id time-dublin
AETHER_PROBE_BASE_URL=… npm run probe:ui -- --live --ui-only --id blank-survival-hello
```

## Env (do not commit secrets)

| Variable | Purpose |
| --- | --- |
| `AETHER_PROBE_BASE_URL` | Target origin (`https://…` or `http://localhost:3000`) |
| `AETHER_PROBE_COOKIE` | Optional `Cookie` header (Auth.js session / preview protection) |
| `AETHER_PROBE_SESSION_TOKEN` | Optional `Authorization: Bearer …` |
| `AETHER_PROBE_TIERS` | `fast`, `expert`, or `fast,expert` |
| `AETHER_PROBE_TIMEOUT_MS` | Override per-prompt timeout |

Hosted keys stay on the **server** you point at. The probe never embeds keys.

## How it hits chat

**API**

1. `GET /api/hosted/status`
2. Durable: `POST /api/chat/head-start` (same `metadata` as the browser). Server still uses `resolveHostedRoute`.
3. On 404/503: `POST /api/chat` with `buildChatHeaders`-compatible headers.
4. Parse UIMessage SSE. Run API detectors.

**UI**

1. Chromium opens `AETHER_PROBE_BASE_URL`.
2. Dismiss Preferences if hosted is ready (`Close preferences`).
3. Click Fast/Expert (`aria-label="Response speed"`).
4. Fill `textarea[aria-label="Message input"]`, click Send.
5. Assert wired chrome only: welcome `h1` (Howzit? / we uup / in the trenches?), `.aether-activity` Working / Worked for, `Stop generating`, `[data-role="assistant"]`, `.aether-tool-trace__error`.
6. On any UI finding, screenshot `evals/probe/artifacts/<id>-<tier>-ui.png`.

## Grok harvest

Leave `harvested[]` rows with `"enabled": false` and an empty `prompt`. When hard prompts land:

```json
{
  "id": "grok-harvest-placeholder-1",
  "enabled": true,
  "prompt": "…paste harvested text…",
  "surfaces": ["api", "ui"]
}
```

The runner picks them up on the next `--all` run. No code change.

## Figma Make / failure chrome

UI chrome for failure states (Howzit vanishing, Working → Worked for, This step failed, Application error) may be designed in Figma Make. **Those frames must stay synced with the real wired backend/UI** — this harness asserts the classes and copy that already ship in `thread.tsx` / `agent-status-strip.tsx` / `tool-ui.tsx`. Do not invent a fake probe-only surface that is not wired to chat. This PR does not open a Figma Make file.

## Joel / Grok Bot — next invoke

```bash
# 1) CI / PR
npm test
npm run probe:smoke
npm run probe:ui

# 2) After a preview deploy — API + UI
npx playwright install chromium
AETHER_PROBE_BASE_URL=https://<preview> AETHER_PROBE_COOKIE='<optional>' \
  npm run probe:ui -- --live

# 3) Nightly / suspected regression
AETHER_PROBE_BASE_URL=https://<prod-or-preview> \
  npm run probe:full -- --live --ui

# 4) Read the report + any screenshots
cat evals/probe/last-report.md
ls evals/probe/artifacts/
```

Exit code 1 only on **live** failures. Offline smoke stays green so CI does not spend tokens or require Chromium.

A hosted 200 that still leaks `Missing Authentication header` / `ZoneInfoNotFoundError` / raw DSML is a **fail**. Point `--live` at a preview/prod box whose server keys actually work.
