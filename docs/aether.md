# Aether on TrueForge

This fork is the Aether agent runtime. It keeps TrueForge sessions, tools, and approvals, and it does **not** use Trigger.dev.

Local mode (SQLite, one process) is the path to run first. Hosted mode (Postgres + Redis) is unchanged upstream and is a follow-up for a shared deploy. Sandbox providers, OIDC login, and a Vercel deploy are not part of this cut.

## Models

Expert is the only tier. The composer prefers **GPT-5.6 Luna via Buzz** (`buzz/gpt-5-6-luna`). OpenRouter is a second custom provider for the fallback catalog.

Both are OpenAI-compatible `custom` providers. On startup, if the matching server key is set, TrueForge upserts the provider for the `default` tenant. Keys stay in the environment. They are not written into git.

| Env var | Purpose | Example |
| --- | --- | --- |
| `AETHER_HOSTED_BUZZ_API_KEY` | Buzz token. Required for Luna. | (secret) |
| `AETHER_HOSTED_BUZZ_BASE_URL` | Buzz Chat Completions base. `/v1` is added when the value is `https://api.buzzai.cc`. | `https://api.buzzai.cc/v1` |
| `AETHER_HOSTED_CLAUDE_API_KEY` | Legacy alias for the same Buzz key. | (secret) |
| `AETHER_HOSTED_CLAUDE_BASE_URL` | Legacy alias for the Buzz base URL. | `https://api.buzzai.cc/v1` |
| `OPENROUTER_API_KEY` | OpenRouter token. Optional fallback catalog. | (secret) |
| `OPENROUTER_BASE_URL` | OpenRouter base. Defaults to the public API. | `https://openrouter.ai/api/v1` |

Seeded model ids:

- Buzz: `gpt-5.6-luna` (default), `gpt-5.6-sol`
- OpenRouter: `openai/gpt-5.6-luna`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`

Settings → Models still lists the upstream catalog. These two providers are added from env, not from that YAML. You can rotate a key by changing the env var and restarting.

Customer BYOK is out of scope.

## Run locally

Requirements: Node.js `>=22.14`, pnpm 10 (see the root `packageManager` field).

```bash
pnpm install
cp packages/trueforge/.env.example packages/trueforge/.env
# Edit packages/trueforge/.env and set at least AETHER_HOSTED_BUZZ_API_KEY.
# Optional: OPENROUTER_API_KEY
pnpm standalone:dev
```

`pnpm standalone:dev` sets `STANDALONE=true` (SQLite, no Redis, no Trigger).

- API: `http://localhost:8790`
- Chat UI: `http://localhost:3000`

Open the UI, start a chat, and send a turn. The model selector should show `buzz/gpt-5-6-luna` when the Buzz key is set. With no keys the UI still boots; add a provider under Settings → Models or set the env vars and restart.

SQLite lives under the app data directory (`APP_DATA_DIR_SUFFIX=dev` in the example env).

## UI

The bundled chat UI uses the Aether cream canvas (`#faf7f1`), Inter for chrome, Cormorant Garamond for assistant text, and terracotta (`#d4734f`) for actions. Tool rows stay small and only reflect real tool steps. A finished call reads `Worked for Ns`.

## Deferred

- Hosted Postgres/Redis deploy
- Sandbox provider credentials (Daytona and others)
- OIDC / team auth (local mode has no login)
- Vercel deploy
- Customer BYOK
