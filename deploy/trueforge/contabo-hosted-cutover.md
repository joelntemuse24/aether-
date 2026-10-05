# Contabo hosted Postgres + Redis cutover (opt-in)

These are prep artifacts for a later approved production cutover. The default remains standalone SQLite. Run the procedure as user `aether` on Contabo during the approved window. Keep ask-user off, skills unset, and `AETHER_AGENT_ENGINE` unset or `trueforge`. Never run `systemctl restart pm2-aether`; never touch `echomancer-takehome`.

## 1. Record the rollback point and back up

From the deployed repository, before updating it:

```bash
PREV=$(git rev-parse HEAD)
```

Record that SHA outside the shell session. Back up the existing SQLite app-data directory, the sidecar env files, and `/opt/aether/sidecar-only.ts` with permissions restricted to user `aether`. Retain these through the rollback window. Take Postgres backups before subsequent schema upgrades.

**TrueForge SQLite sessions do not migrate into Postgres. TrueForge sessions are empty after cutover.** Neon conversations remain in the Next app. Existing conversations can retain references to old TrueForge session IDs, so smoke-test with a new conversation and check how an existing conversation resumes before accepting the cutover.

## 2. Provision Postgres and Redis

Use managed Postgres + Redis reachable from Contabo, with TLS and credentials in their URLs, or the repository compose profile. For managed services, use a dedicated TrueForge database and Redis instance; retain Neon's existing Next-app configuration.

For the existing pm2 sidecar, provision **only the dependencies** with compose from the deployed repository:

```bash
read -r -s -p 'Postgres password: ' POSTGRES_PASSWORD
export POSTGRES_PASSWORD
export AETHER_TRUEFORGE_TOKEN  # already configured; required for compose interpolation
docker compose -f deploy/trueforge/docker-compose.yml --profile hosted up -d --wait postgres redis
unset POSTGRES_PASSWORD
```

The services persist their data, have health checks, share an internal network, and publish ports only on loopback. Use `127.0.0.1:5432` and `127.0.0.1:6379` from the pm2 sidecar. Choose a URL-encoded database password. The default database and user are `trueforge`. An empty Postgres password causes initialization to fail. Confirm there is no port conflict before provisioning.

For a separate Docker deployment, set `TRUEFORGE_DATABASE_URL=postgres://trueforge:<encoded-password>@postgres:5432/trueforge`, `REDIS_URL=redis://redis:6379`, `TRUEFORGE_API_KEY`, `POSTGRES_PASSWORD`, and the existing transport/provider secrets, then run `docker compose --profile hosted up -d --build`. Wait for dependency health before starting the TrueForge container. **Do not run that full stack beside the existing Contabo pm2 sidecar.** Plain `docker compose up` starts neither hosted dependency nor the agent profile.

## 3. Prepare the launcher and durable environment

The Contabo entry point `/opt/aether/sidecar-only.ts` is external to this repo. Before cutover, inspect it and prepare a backed-up edit so that its upstream spawn uses `buildTrueForgeUpstreamEnv(process.env)` from `src/lib/trueforge/runtime-mode.ts`, followed by its existing host, port, app-data, and outbound-host overlays. Alternatively, it must derive `STANDALONE=false` only when both trimmed database and Redis URLs are present. Keep `prepareSidecar()`, provider seeding, auth, and sandbox pruning intact. A hardcoded `STANDALONE=true` in this external launcher prevents cutover.

Use `contabo-hosted-env.example` as the template for a protected env file. Replace every placeholder, retain the current `AETHER_TRUEFORGE_TOKEN`, and keep provider keys unchanged. Required hosted variables:

- `TRUEFORGE_DATABASE_URL`: the dedicated TrueForge Postgres URL; mapped to package `DATABASE_URL`.
- `REDIS_URL`: the Redis URL. `TRUEFORGE_REDIS_URL` is also supported and maps to `REDIS_URL`.
- `TRUEFORGE_API_KEY`: required by TrueForge 0.2.1 in hosted mode; distinct from the Aether transport token.

Leave `STANDALONE` unset; the helper derives it. Both URLs must be non-empty after trimming. `DATABASE_URL` is a supported fallback, but prefer `TRUEFORGE_DATABASE_URL` to avoid the Neon URL on Vercel. Keep these hosted variables on Contabo.

The pm2 app `aether` must load the protected file on every launch. With the existing `loadLocalEnvFiles()` launcher, edit `.env.local` in the app's working directory with mode `600` and verify the working directory and env loader. That loader reads `.env` first and preserves inherited values: remove conflicting assignments from `.env`, and confirm pm2 has no inherited hosted URL variables that override `.env.local`. If pm2 already owns such variables, prepare the app's durable startup configuration so the protected file supplies the intended values on reload. Do not rely on exports in an operator shell: `health-gate.sh` runs plain `pm2 reload aether` and does not use `--update-env`.

Load the same protected env into the operator shell for the companion check, without printing it. For a shell-compatible file that you own and have reviewed:

```bash
set -a
. /opt/aether/.env.local  # replace with the verified pm2 working-directory path
set +a
```

## 4. Migrate once and reload through the health gate

TrueForge 0.2.1 migrates Postgres on hosted boot before serving requests. For the **published npm runtime installed by this repository**, perform the initial migration through the first health-gated hosted reload below. This starts the existing sidecar once; allow sufficient startup time for the initial migration. Confirm its migration success in redacted logs and database schema before accepting traffic.

The package also declares a `migrate` script with `STANDALONE=false`. It requires a full TrueForge source installation with its development dependencies and `.env`; the published 0.2.1 package here lacks `src/db/postgres/migrate-cli.ts` and `cross-env`. If using that source distribution for an advance migration, from its package root run the following once with the same hosted environment, then return to the Aether repository:

```bash
DATABASE_URL="$TRUEFORGE_DATABASE_URL" STANDALONE=false npm run migrate
```

There is no `trueforge migrate` CLI subcommand in the published package. For the normal published-runtime path, deploy the approved prep revision onto the production master checkout, then run:

```bash
bash deploy/trueforge/health-gate.sh "$PREV"
bash deploy/trueforge/hosted-health-check.sh
```

The health gate reloads **only `aether`**, checks capabilities and the required default model, and checks process stability. Leave the existing default-model setting intact. The companion is a no-op without both hosted URLs; confirm that the operator shell and pm2 have the same configuration before trusting it. Its capabilities URL defaults to `http://127.0.0.1:8790/api/v1/capabilities`; set `AETHER_SIDECAR_HEALTH_URL` only if needed. A 200 capabilities response checks readiness; confirm hosted storage separately from startup logs/schema because capabilities alone does not prove the storage backend.

## 5. Smoke and accept

Use the normal Aether web app with the existing sidecar transport token configured. Confirm capabilities returns 200, create a new conversation, submit a short hosted Expert turn, and verify that it completes. Send a follow-up in that conversation and check that it retains context. Navigate away and reopen it to check the saved Neon conversation. Check an existing conversation for stale SQLite session references. Confirm default-model availability, provider seeding, expected tools, and sandbox behavior without enabling ask-user, skills, or native. Check redacted logs for database/Redis errors. Keep the old SQLite data and external launcher backup until acceptance.

## Rollback

The health gate's automatic code rollback cannot undo hosted environment changes or database migrations. If the gate fails, or smoke tests fail, restore the protected standalone env and clear **all** hosted URL aliases (`TRUEFORGE_DATABASE_URL`, `DATABASE_URL`, `REDIS_URL`, `TRUEFORGE_REDIS_URL`) from the sidecar's durable startup environment and env files. Preserve Neon configuration on Vercel. Restore the backed-up external launcher if necessary, retain the SQLite app-data directory and suffix, and deploy the recorded previous revision using the existing operator process. Then run the health gate with the recorded rollback SHA to reload `aether` and verify capabilities/default-model health. The helper forces standalone mode when hosted URLs are absent, even if an inherited `STANDALONE=false` remains.

Restore the operator shell environment too; a standalone companion check exits 0 without a request. Smoke-test a new turn and an old SQLite-backed conversation. Postgres sessions created during cutover remain in Postgres and do not transfer back into SQLite. Keep Postgres/Redis data for investigation; do not delete volumes during rollback. Never restart the systemd pm2 unit or reload other pm2 apps.
