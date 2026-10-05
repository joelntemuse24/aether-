#!/usr/bin/env bash
# Reload the existing pm2 app "aether" and require it to stay up.
# Does not start a second sidecar and does not touch any other pm2 app.
# Run as user aether. Do not restart systemd unit pm2-aether (that owns every app).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="aether"

usage() {
  cat <<'EOF'
Usage:
  deploy/trueforge/health-gate.sh --lockfile-changed <prev> [new]
  deploy/trueforge/health-gate.sh <prev-sha>

--lockfile-changed exits 0 when package-lock.json differs (npm ci is needed)
and 1 when it does not.

The deploy reloads pm2 app aether only. Health URL defaults to
http://127.0.0.1:8790/api/v1/capabilities (override with AETHER_SIDECAR_HEALTH_URL).
After a hosted cutover reload, operators can run deploy/trueforge/hosted-health-check.sh.
Pass when restart_time rises by at most 1 and then stays stable, the URL
returns 200, and GET AETHER_SIDECAR_MODELS_URL (default
http://127.0.0.1:8790/api/v1/models) lists AETHER_SIDECAR_REQUIRED_MODEL
(default openrouter/qwen3-8-27b-free; set it to an empty string to skip). The
sidecar answers capabilities before it finishes seeding model providers, so the
model listing proves the default model is configured. On failure, git reset --hard <prev> on master and reload aether.
EOF
}

lockfile_changed() {
  local prev="$1"
  local new="$2"
  ! git diff --quiet "$prev" "$new" -- package-lock.json
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

ROOT="${AETHER_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
cd "$ROOT"

if [[ "${1:-}" == "--lockfile-changed" ]]; then
  prev="${2:?previous commit required}"
  new="${3:-HEAD}"
  if lockfile_changed "$prev" "$new"; then
    exit 0
  fi
  exit 1
fi

PREVIOUS="${1:-${AETHER_SIDECAR_PREVIOUS:-}}"
if [[ -z "$PREVIOUS" ]]; then
  echo "[aether] previous commit sha is required" >&2
  usage >&2
  exit 2
fi

HEALTH_URL="${AETHER_SIDECAR_HEALTH_URL:-http://127.0.0.1:8790/api/v1/capabilities}"
MODELS_URL="${AETHER_SIDECAR_MODELS_URL:-http://127.0.0.1:8790/api/v1/models}"
REQUIRED_MODEL="${AETHER_SIDECAR_REQUIRED_MODEL-openrouter/qwen3-8-27b-free}"
GATE_SECONDS="${AETHER_HEALTH_GATE_SECONDS:-60}"
GATE_INTERVAL="${AETHER_HEALTH_GATE_INTERVAL:-5}"

read_aether() {
  pm2 jlist | node "$SCRIPT_DIR/pm2-aether-status.mjs"
}

reload_aether() {
  pm2 reload "$APP"
}

health_ok() {
  node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }).then((r) => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))' "$HEALTH_URL"
}

model_ok() {
  [[ -z "$REQUIRED_MODEL" ]] && return 0
  node -e '
    const headers = process.env.AETHER_TRUEFORGE_TOKEN ? { authorization: `Bearer ${process.env.AETHER_TRUEFORGE_TOKEN}` } : {};
    fetch(process.argv[1], { headers, signal: AbortSignal.timeout(5000) })
      .then(async (r) => {
        if (r.status !== 200) process.exit(1);
        const body = await r.json();
        const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        process.exit(rows.some((row) => row?.name === process.argv[2]) ? 0 : 1);
      })
      .catch(() => process.exit(1));
  ' "$MODELS_URL" "$REQUIRED_MODEL"
}

watch_aether() {
  local base_pid base_count now_pid now_count expect_pid expect_count last_health
  read -r base_pid base_count < <(read_aether)
  reload_aether
  read -r now_pid now_count < <(read_aether)
  echo "[aether] reloaded aether pid $base_pid -> $now_pid restart_time $base_count -> $now_count"
  if (( now_count < base_count || now_count > base_count + 1 )); then
    echo "[aether] restart_time moved from $base_count to $now_count" >&2
    return 1
  fi
  expect_pid="$now_pid"
  expect_count="$now_count"
  local passes=1
  local i
  if (( GATE_INTERVAL > 0 && GATE_SECONDS > 0 )); then
    passes="$((GATE_SECONDS / GATE_INTERVAL))"
    if (( passes < 1 )); then
      passes=1
    fi
  fi
  last_health=1
  for ((i = 0; i < passes; i++)); do
    read -r now_pid now_count < <(read_aether)
    if [[ "$now_pid" != "$expect_pid" || "$now_count" != "$expect_count" ]]; then
      echo "[aether] aether restarted during the gate (pid $expect_pid count $expect_count -> pid $now_pid count $now_count)" >&2
      return 1
    fi
    if health_ok && model_ok; then
      last_health=0
    else
      last_health=1
    fi
    if (( i + 1 < passes )); then
      sleep "$GATE_INTERVAL"
    fi
  done
  if (( last_health != 0 )); then
    if health_ok; then
      echo "[aether] $MODELS_URL does not list $REQUIRED_MODEL" >&2
    else
      echo "[aether] $HEALTH_URL did not return 200" >&2
    fi
    return 1
  fi
  echo "[aether] health gate passed pid=$expect_pid restart_time=$expect_count"
}

NPM_CI_RAN=0
if lockfile_changed "$PREVIOUS" HEAD; then
  npm ci
  NPM_CI_RAN=1
else
  echo "[aether] package-lock.json unchanged; skipping npm ci"
fi

rollback() {
  echo "[aether] health gate failed; resetting master to $PREVIOUS" >&2
  git checkout master
  git reset --hard "$PREVIOUS"
  if [[ "$NPM_CI_RAN" == "1" ]]; then
    npm ci
  fi
  reload_aether
  if health_ok; then
    echo "[aether] rolled back to $PREVIOUS and capabilities returned 200" >&2
  else
    echo "[aether] rollback reload did not return 200 from $HEALTH_URL" >&2
  fi
}

if watch_aether; then
  exit 0
fi
rollback
exit 1
