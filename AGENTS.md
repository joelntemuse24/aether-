# AGENTS.md

## Cursor Cloud specific instructions

### Product
This repo's primary product is **Aether** (repo root), a Next.js 15 (App Router) bring-your-own-key AI chat app. There is no database or server-side state — the only local process is the Next.js dev server. The `Match website layout/` subfolder is an unrelated standalone Figma/Vite export and is not part of Aether; ignore it unless specifically asked.

### Standard commands (root)
Defined in `package.json`: `npm run dev` (port 3000), `npm run build`, `npm run start`, `npm run lint`. Node >=20 required. Dependencies are installed by the startup update script (`npm install`).

### Non-obvious notes
- **BYOK, no server env vars.** The `/api/chat` route (`src/app/api/chat/route.ts`) reads the provider + key from request headers, which the browser populates from `localStorage` (Settings dialog). `.env.example` vars are all optional/commented. There are no required secrets.
- **Testing chat end-to-end without a real provider key.** The Settings dialog supports a "Custom" (OpenAI-compatible) provider. Point its Base URL at a local mock OpenAI-compatible server (implement `POST /chat/completions` with OpenAI SSE streaming) and set any API key + a custom model id. This exercises the full browser → `/api/chat` → provider streaming path with no external credentials. The mock server code is test-only infra (keep it outside the repo, e.g. `/tmp`).
- **Settings dialog auto-opens** on first visit when no key is saved; keys/history persist only in browser `localStorage` under the `aether:` prefix (clearing site data resets the app).
- Lint currently emits one pre-existing `react-hooks/exhaustive-deps` warning in `src/components/model-picker.tsx` (0 errors) — not introduced by setup.
