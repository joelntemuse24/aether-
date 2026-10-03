import "./compile-cache";
import fs from "node:fs";
import path from "node:path";

/**
 * One `.env` assignment. Accepts `export KEY=value`. Unquoted values drop a
 * trailing ` # comment`. Quoted values are kept as written.
 */
export function parseEnvAssignment(line: string): { key: string; value: string } | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("export ")) trimmed = trimmed.slice("export ".length).trim();
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return { key, value: value.slice(1, -1) };
  }
  const comment = value.search(/\s+#/);
  if (comment >= 0) value = value.slice(0, comment).trim();
  return { key, value };
}

/** Load `.env` then `.env.local` without overriding variables already set. */
export function loadLocalEnvFiles(cwd = process.cwd()): void {
  for (const name of [".env", ".env.local"]) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const parsed = parseEnvAssignment(line);
      if (!parsed) continue;
      if (process.env[parsed.key] === undefined) process.env[parsed.key] = parsed.value;
    }
  }
}
