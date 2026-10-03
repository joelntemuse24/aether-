import { cachedProbe, recordProbe, type ProbeState, SIDECAR_PROBE_LOCAL_TIMEOUT_MS, SIDECAR_PROBE_REMOTE_TIMEOUT_MS } from "./probe";

/** Local TrueForge sidecar. A remote VM is used when `AETHER_TRUEFORGE_URL` is set. */
export function trueforgePort(): number {
  const raw = Number(process.env.TRUEFORGE_PORT || 8790);
  return Number.isFinite(raw) && raw > 0 ? raw : 8790;
}

/**
 * Port at the moment this module was first imported. Prefer `trueforgePort()`
 * after `loadLocalEnvFiles()`. Kept as a number so an external launcher can
 * still import it.
 */
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

let reachabilityCache: ProbeState | null = null;
let sandboxCache: ProbeState | null = null;

export function resetTrueforgeProbeCache(): void {
  reachabilityCache = null;
  sandboxCache = null;
}

/** Move cached probe timestamps back so tests can expire a positive result. */
export function ageTrueforgeProbeCache(ms: number): void {
  if (reachabilityCache) reachabilityCache = { ...reachabilityCache, at: reachabilityCache.at - ms };
  if (sandboxCache) sandboxCache = { ...sandboxCache, at: sandboxCache.at - ms };
}

async function probeSidecar(
  cache: ProbeState | null,
  key: string,
  timeoutMs: number,
  read: (response: Response) => Promise<boolean>,
): Promise<{ cache: ProbeState; ok: boolean }> {
  const now = Date.now();
  const cached = cachedProbe(cache, key, now);
  if (cached !== undefined) return { cache: cache as ProbeState, ok: cached };
  let result = { ok: false, confident: false };
  try {
    const response = await fetch(`${trueforgeOrigin()}/api/v1/capabilities`, {
      headers: trueforgeAuthHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) result = { ok: await read(response), confident: true };
  } catch {
    result = { ok: false, confident: false };
  }
  const next = recordProbe(cache, key, result, Date.now());
  return { cache: next, ok: next.ok };
}

/** True when this process can call the sidecar. A miss falls back to in-process chat. */
export async function trueforgeSidecarReachable(timeoutMs?: number): Promise<boolean> {
  if (!trueforgeSidecarEnabled()) return false;
  const remote = trueforgeRemoteUrl();
  if (remote && !trueforgeToken()) return false;
  const key = `${trueforgeOrigin()}|${remote ? "remote" : "local"}`;
  const timeout = timeoutMs ?? (remote ? SIDECAR_PROBE_REMOTE_TIMEOUT_MS : SIDECAR_PROBE_LOCAL_TIMEOUT_MS);
  const result = await probeSidecar(reachabilityCache, key, timeout, async () => true);
  reachabilityCache = result.cache;
  return result.ok;
}

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
  const timeout = timeoutMs ?? (remote ? SIDECAR_PROBE_REMOTE_TIMEOUT_MS : SIDECAR_PROBE_LOCAL_TIMEOUT_MS);
  const result = await probeSidecar(sandboxCache, key, timeout, async (response) =>
    sandboxEnabledFromCapabilities(await response.json()),
  );
  sandboxCache = result.cache;
  return result.ok;
}
