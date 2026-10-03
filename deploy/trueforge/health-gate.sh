#!/usr/bin/env bash
# After a VM checkout of this repo, start the sidecar and require it to stay up.
# Restart count must not change for 60s, and http://127.0.0.1:8790/health must answer.
# On failure, check out the previous commit and start that build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PREVIOUS="${1:-${AETHER_SIDECAR_PREVIOUS:-}}"
if [[ -z "$PREVIOUS" ]]; then
  PREVIOUS="$(git rev-parse HEAD~1)"
fi

START_CMD="${AETHER_SIDECAR_START:-}"
if [[ -z "$START_CMD" ]]; then
  if [[ -f /opt/aether/sidecar-only.ts ]]; then
    START_CMD="npx tsx /opt/aether/sidecar-only.ts"
  else
    START_CMD="npm run trueforge"
  fi
fi

pid=""
start_sidecar() {
  nohup bash -c "$START_CMD" >>/tmp/aether-sidecar.log 2>&1 &
  pid=$!
  disown "$pid" 2>/dev/null || true
}

stop_sidecar() {
  if [[ -n "${pid}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  pid=""
}

health_ok() {
  node -e "fetch('http://127.0.0.1:8790/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
}

watch() {
  local baseline=""
  local i
  for i in $(seq 1 12); do
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
      echo "[aether] sidecar process exited during the health gate" >&2
      return 1
    fi
    if [[ -z "$baseline" ]]; then
      baseline="$pid"
    elif [[ "$pid" != "$baseline" ]]; then
      echo "[aether] sidecar restarted during the health gate ($baseline -> $pid)" >&2
      return 1
    fi
    sleep 5
  done
  health_ok
}

rollback() {
  echo "[aether] health gate failed; rolling back to $PREVIOUS" >&2
  stop_sidecar
  git checkout --detach "$PREVIOUS"
  start_sidecar
}

start_sidecar
if watch; then
  echo "[aether] sidecar health gate passed (pid $pid)"
  exit 0
fi
rollback
exit 1
