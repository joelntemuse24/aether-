import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SANDBOX_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Same data dir TrueForge uses via env-paths(`trueforge`, { suffix }). */
export function trueforgeDataDir(suffix = process.env.APP_DATA_DIR_SUFFIX || "aether"): string {
  const name = `trueforge-${suffix || "aether"}`;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", name);
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(local, name, "Data");
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, name);
}

export function trueforgeSandboxDir(suffix?: string): string {
  return path.join(trueforgeDataDir(suffix), "sandboxes");
}

/** Delete sandbox directories whose mtime is older than maxAgeMs. Active dirs stay. */
export async function pruneOldSandboxes(
  dir: string,
  maxAgeMs = DEFAULT_SANDBOX_MAX_AGE_MS,
  now = Date.now(),
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const stat = await fs.stat(full);
    if (now - stat.mtimeMs < maxAgeMs) continue;
    await fs.rm(full, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}
