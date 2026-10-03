import fs from "node:fs";
import { enableCompileCache } from "node:module";
import os from "node:os";
import path from "node:path";

let started = false;

/**
 * Persist V8's code cache across pm2 reloads. tsx still transforms changed
 * TypeScript on a cold boot; this caches the JS it and Node load afterwards.
 * The directory is ~/.cache/aether-compile unless AETHER_COMPILE_CACHE is set.
 */
export function enableAetherCompileCache(): string | null {
  if (started) return process.env.AETHER_COMPILE_CACHE ?? null;
  started = true;
  const dir =
    process.env.AETHER_COMPILE_CACHE ||
    path.join(os.homedir(), ".cache", "aether-compile");
  try {
    fs.mkdirSync(dir, { recursive: true });
    enableCompileCache(dir);
    return dir;
  } catch {
    return null;
  }
}

enableAetherCompileCache();
