# Hermes remote gateway (operator guide)

Users only use the Aether website. This host is **your** always-on agent backend.

## Architecture

- Browser → Aether (Vercel) → Hermes (`HERMES_BASE_URL`) with `HERMES_API_KEY`
- Do **not** set `API_SERVER_CORS_ORIGINS` for production Aether (server-to-server only)
- Use a sandboxed terminal backend (Docker / Modal / Daytona / etc.) — never unrestricted host shell for multi-tenant traffic

## Minimal env on the Hermes host

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=same-as-aether-HERMES_API_KEY
# Point Hermes models at OpenRouter (or your hosted providers)
OPENROUTER_API_KEY=...
```

Enable per-request model ids from Aether’s picker (Hermes config):

```yaml
gateway:
  platforms:
    api_server:
      direct_model_requests: true
```

## Aether env (Vercel)

```bash
HERMES_BASE_URL=https://hermes.yourdomain.com
HERMES_API_KEY=same-as-API_SERVER_KEY
# HERMES_MODEL_NAME=hermes-agent
```

When these are set, hosted chat uses Hermes. BYOK still runs the in-process loop on Vercel.

## Tenancy headers Aether sends

- `X-Hermes-Session-Id` — Aether conversation id
- `X-Hermes-Session-Key` — `aether:user:{id}` or `aether:anon:{conversationId}`

## Health

```bash
curl -sS "$HERMES_BASE_URL/health"
curl -sS -H "Authorization: Bearer $HERMES_API_KEY" "$HERMES_BASE_URL/v1/models"
```

See also: `docs/superpowers/specs/2026-08-12-hermes-remote-backend-design.md`
