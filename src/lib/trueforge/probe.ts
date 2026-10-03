/**
 * Sidecar probes. A transport miss must not stick as "down".
 * Two misses mark the probe down for a few seconds. A real HTTP answer
 * (including sandbox disabled) is kept for the positive window.
 */
export const SIDECAR_PROBE_POSITIVE_MS = 60_000;
export const SIDECAR_PROBE_NEGATIVE_MS = 3_000;
export const SIDECAR_PROBE_MISS_LIMIT = 2;
export const SIDECAR_PROBE_LOCAL_TIMEOUT_MS = 1_500;
export const SIDECAR_PROBE_REMOTE_TIMEOUT_MS = 5_000;

export type ProbeState = {
  key: string;
  ok: boolean;
  at: number;
  misses: number;
  confident: boolean;
};

export function cachedProbe(state: ProbeState | null, key: string, now: number): boolean | undefined {
  if (!state || state.key !== key) return undefined;
  if (state.confident && now - state.at < SIDECAR_PROBE_POSITIVE_MS) return state.ok;
  if (
    !state.ok &&
    !state.confident &&
    state.misses >= SIDECAR_PROBE_MISS_LIMIT &&
    now - state.at < SIDECAR_PROBE_NEGATIVE_MS
  ) {
    return false;
  }
  return undefined;
}

export function recordProbe(
  prev: ProbeState | null,
  key: string,
  result: { ok: boolean; confident: boolean },
  now: number,
): ProbeState {
  if (result.confident) return { key, ok: result.ok, at: now, misses: 0, confident: true };
  const misses = prev && prev.key === key ? prev.misses + 1 : 1;
  if (misses < SIDECAR_PROBE_MISS_LIMIT && prev?.key === key && prev.ok && prev.confident) {
    return { ...prev, misses };
  }
  return { key, ok: false, at: now, misses, confident: false };
}
