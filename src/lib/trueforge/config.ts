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

let sandboxCache: { key: string; enabled: boolean; at: number } | null = null;

/** True only when capabilities say a sandbox provider (or local bubblewrap) is ready. */
export function sandboxEnabledFromCapabilities(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const sandbox = (body as { data?: { sandbox?: { enabled?: unknown } } }).data?.sandbox;
  return sandbox?.enabled === true;
}

/**
 * Sidecars without bubblewrap or a sandbox provider 422 session create when
 * sandbox.enabled is true. A failed probe leaves the sandbox off.
 */
export async function trueforgeSandboxEnabled(timeoutMs?: number): Promise<boolean> {
  if (!trueforgeSidecarEnabled()) return false;
  const remote = trueforgeRemoteUrl();
  if (remote && !trueforgeToken()) return false;
  const key = trueforgeOrigin();
  const now = Date.now();
  if (sandboxCache && sandboxCache.key === key) {
    const ttl = sandboxCache.enabled ? 60_000 : 15_000;
    if (now - sandboxCache.at < ttl) return sandboxCache.enabled;
  }
  const timeout = timeoutMs ?? (remote ? 2_000 : 400);
  let enabled = false;
  try {
    const response = await fetch(`${trueforgeOrigin()}/api/v1/capabilities`, {
      headers: trueforgeAuthHeaders(),
      signal: AbortSignal.timeout(timeout),
    });
    if (response.ok) enabled = sandboxEnabledFromCapabilities(await response.json());
  } catch {
    enabled = false;
  }
  sandboxCache = { key, enabled, at: Date.now() };
  return enabled;
}
