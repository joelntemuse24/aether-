#!/usr/bin/env bash
# Optional hosted-mode companion; it never reloads a process.
set -euo pipefail

node <<'NODE'
const env = process.env;
const databaseUrl = env.TRUEFORGE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
const redisUrl = env.REDIS_URL?.trim() || env.TRUEFORGE_REDIS_URL?.trim();
if (!databaseUrl || !redisUrl) process.exit(0);
const url = env.AETHER_SIDECAR_HEALTH_URL || 'http://127.0.0.1:8790/api/v1/capabilities';
const headers = env.AETHER_TRUEFORGE_TOKEN
  ? { authorization: `Bearer ${env.AETHER_TRUEFORGE_TOKEN}` }
  : {};
fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  .then((response) => {
    if (response.status !== 200) {
      console.error('[aether] hosted capabilities check must return 200');
      process.exit(1);
    }
  })
  .catch(() => {
    console.error('[aether] hosted capabilities check failed');
    process.exit(1);
  });
NODE
