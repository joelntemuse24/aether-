import fs from "node:fs";
import nodeModule from "node:module";
import os from "node:os";
import path from "node:path";

let started = false;

type EnableCompileCache = (cacheDir?: string) => void;

/**
 * Persist V8's code cache across pm2 reloads. tsx still transforms changed
 * TypeScript on a cold boot; this caches the JS it and Node load afterwards.
 * The directory is ~/.cache/aether-compile unless AETHER_COMPILE_CACHE is set.
 * Older @types/node builds do not name this export, so the call is optional.
 */
export function enableAetherCompileCache(): string | null {
  if (started) return process.env.AETHER_COMPILE_CACHE ?? null;
  started = true;
  const enable = (nodeModule as { enableCompileCache?: EnableCompileCache }).enableCompileCache;
  if (typeof enable !== "function") return null;
  const dir =
    process.env.AETHER_COMPILE_CACHE ||
    path.join(os.homedir(), ".cache", "aether-compile");
  try {
    fs.mkdirSync(dir, { recursive: true });
    enable(dir);
    return dir;
  } catch {
    return null;
  }
}

enableAetherCompileCache();
