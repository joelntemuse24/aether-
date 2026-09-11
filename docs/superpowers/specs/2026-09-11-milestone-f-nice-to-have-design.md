# Milestone F — Nice-to-have (2026-09-11)

Shippable increment on A–E. Cream canvas unchanged. Aether-tools seam unchanged: the worker never sees Drive/GitHub cookies.

## Shipped

1. **TTS playback.** Listen on an assistant answer uses this device’s speech synthesis. Honest unavailable copy when the browser cannot speak. No hosted vendor.
2. **Scheduled automations.** `schedule_create` / list / cancel plus Settings → Automations. Trigger task `scheduled.automation` prepares a draft and a confirm card. Never silent-send, including Auto and after the schedule itself was approved.
3. **ffmpeg via workspace.** `workspace_ffmpeg` (trim / concat / gif / burn_subs) plus `workspace_exec` annotation. Honest `MISSING` when the binary is absent.
4. **Design + deployments reads.** Operator PAT only. Honest “not connected” — no invented files or statuses. Dedicated deployments token (never the workspace access token).
5. **Social stub.** Unavailable without an official API key. No scrape path.
6. **Thin MCP hook.** `AETHER_MCP_ENABLED` + `AETHER_MCP_URL` status only. No marketplace.

## Deferred forever (this slice)

- MCP marketplace / dynamic tool catalog
- Per-user Design / Deployments OAuth
- Official social-feed API
- Hosted / cloud TTS voices
- ffmpeg bundled into the sandbox image (operator install only)

## Constraints honored

- No vendor names in product UI
- Confirm before spend / email send / third-party write / schedule create
- Confirm-before-send on every scheduled run
- Do not scrape social feeds
