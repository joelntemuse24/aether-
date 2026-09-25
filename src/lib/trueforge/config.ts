/** Local TrueForge sidecar. A remote VM is used when `AETHER_TRUEFORGE_URL` is set. */
export function trueforgePort(): number {
  const raw = Number(process.env.TRUEFORGE_PORT || 8790);
  return Number.isFinite(raw) && raw > 0 ? raw : 8790;
}

export const TRUEFORGE_PORT = trueforgePort();

/** Public sidecar origin. Empty means this process should use loopback. */
export function trueforgeRemoteUrl(): string | null {
  const raw = (process.env.AETHER_TRUEFORGE_URL ?? "").trim().replace(/\/$/, "");
  return raw || null;
}

export function trueforgeToken(): string {
  return (process.env.AETHER_TRUEFORGE_TOKEN ?? "").trim();
}

export function trueforgeOrigin(): string {
  return trueforgeRemoteUrl() ?? `http://127.0.0.1:${trueforgePort()}`;
}

export function trueforgeAuthHeaders(): Record<string, string> {
  const remote = trueforgeRemoteUrl();
  const token = trueforgeToken();
  if (!remote || !token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Set `AETHER_TRUEFORGE=0` to skip the sidecar (legacy Trigger / in-process chat). */
export function trueforgeSidecarEnabled(): boolean {
  return process.env.AETHER_TRUEFORGE !== "0";
}

let reachabilityCache: { key: string; ok: boolean; at: number } | null = null;

/** True when this process can call the sidecar. A miss falls back to in-process chat. */
export async function trueforgeSidecarReachable(timeoutMs?: number): Promise<boolean> {
  if (!trueforgeSidecarEnabled()) return false;
  const remote = trueforgeRemoteUrl();
  if (remote && !trueforgeToken()) return false;
  const key = `${trueforgeOrigin()}|${remote ? "remote" : "local"}`;
  const now = Date.now();
  if (reachabilityCache && reachabilityCache.key === key) {
    const ttl = reachabilityCache.ok ? 60_000 : 15_000;
    if (now - reachabilityCache.at < ttl) return reachabilityCache.ok;
  }
  const timeout = timeoutMs ?? (remote ? 2_000 : 400);
  let ok = false;
  try {
    const response = await fetch(`${trueforgeOrigin()}/api/v1/capabilities`, {
      headers: trueforgeAuthHeaders(),
      signal: AbortSignal.timeout(timeout),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  reachabilityCache = { key, ok, at: Date.now() };
  return ok;
}
