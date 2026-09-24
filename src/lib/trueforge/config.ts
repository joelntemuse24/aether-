/** Local TrueForge sidecar. Only the Next server talks to it. */
export function trueforgePort(): number {
  const raw = Number(process.env.TRUEFORGE_PORT || 8790);
  return Number.isFinite(raw) && raw > 0 ? raw : 8790;
}

export const TRUEFORGE_PORT = trueforgePort();

export function trueforgeOrigin(): string {
  return `http://127.0.0.1:${trueforgePort()}`;
}

/** Set `AETHER_TRUEFORGE=0` to skip the sidecar (legacy Trigger / in-process chat). */
export function trueforgeSidecarEnabled(): boolean {
  return process.env.AETHER_TRUEFORGE !== "0";
}

let reachabilityCache: { ok: boolean; at: number } | null = null;

/** True when this process can call the sidecar. A miss falls back to in-process chat. */
export async function trueforgeSidecarReachable(timeoutMs = 400): Promise<boolean> {
  if (!trueforgeSidecarEnabled()) return false;
  const now = Date.now();
  if (reachabilityCache) {
    const ttl = reachabilityCache.ok ? 5_000 : 30_000;
    if (now - reachabilityCache.at < ttl) return reachabilityCache.ok;
  }
  let ok = false;
  try {
    const response = await fetch(`${trueforgeOrigin()}/api/v1/capabilities`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  reachabilityCache = { ok, at: Date.now() };
  return ok;
}
