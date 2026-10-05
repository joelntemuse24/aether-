#!/usr/bin/env node
// One-shot cleanup for the TrueForge sidecar MCP server inventory.
//
// Run as user `aether` on the VM (never as root; the sidecar and pm2 app
// `aether` belong to that user):
//   node deploy/trueforge/mcp-slot-cleanup.mjs            # list only (dry run)
//   node deploy/trueforge/mcp-slot-cleanup.mjs --apply    # try to DELETE legacy rows
//
// The app now reuses pooled names `aether-s01` .. `aether-sNN` through
// createOrUpdate, so new rows stop appearing. This script handles the rows that
// older builds left behind: `aether-<conversationId>` and `aetherx-<conversationId>`.
// Pool slots (`aether-sNN`) and every other MCP server are never touched.
//
// TrueForge 0.2.1 may answer DELETE with 405/501. The script stops at the first
// such answer and reports it. Legacy rows then stay listed but idle; pooled
// reuse in the app is the durable fix and needs no DELETE. The script does not
// overwrite slots, because that needs the app's tool-context key.
//
// Auth: AETHER_TRUEFORGE_TOKEN from the environment, else from .env / .env.local
// in the current directory. The token is never printed. Target URL:
// AETHER_TRUEFORGE_URL, else http://127.0.0.1:${TRUEFORGE_PORT:-8790}.
import fs from "node:fs";

const SLOT = /^aether-s\d{2}$/;
const LEGACY = /^aetherx?-[a-z0-9]+$/;

if (typeof process.getuid === "function" && process.getuid() === 0) {
  console.error("Run as user aether, not root.");
  process.exit(2);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node deploy/trueforge/mcp-slot-cleanup.mjs [--apply]");
  process.exit(0);
}
const apply = process.argv.includes("--apply");

function fileEnv(key) {
  for (const name of [".env", ".env.local"]) {
    if (!fs.existsSync(name)) continue;
    for (const line of fs.readFileSync(name, "utf8").split("\n")) {
      const match = line.trim().replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && match[1] === key) return match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return "";
}

const token = (process.env.AETHER_TRUEFORGE_TOKEN || fileEnv("AETHER_TRUEFORGE_TOKEN") || "").trim();
if (!token) {
  console.error("AETHER_TRUEFORGE_TOKEN is not set.");
  process.exit(2);
}
const port = process.env.TRUEFORGE_PORT || fileEnv("TRUEFORGE_PORT") || "8790";
const origin = (
  process.env.AETHER_TRUEFORGE_URL || fileEnv("AETHER_TRUEFORGE_URL") || `http://127.0.0.1:${port}`
).replace(/\/$/, "");
const endpoint = `${origin}/api/v1/settings/mcp-servers`;
const headers = { Authorization: `Bearer ${token}` };

function rowName(row) {
  if (typeof row === "string") return row;
  return row?.name ?? row?.manifest?.name ?? "";
}

const listed = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15_000) });
if (!listed.ok) {
  console.error(`List failed: HTTP ${listed.status}`);
  process.exit(1);
}
const body = await listed.json();
const rows = Array.isArray(body) ? body : (body?.data ?? body?.items ?? body?.mcp_servers ?? []);
const names = rows.map(rowName).filter(Boolean);
const slots = names.filter((name) => SLOT.test(name));
const legacy = names.filter((name) => !SLOT.test(name) && LEGACY.test(name));
const other = names.length - slots.length - legacy.length;
console.log(
  `MCP servers: ${names.length} total, ${slots.length} pool slots, ${legacy.length} legacy per-conversation, ${other} other (left alone).`,
);

if (!apply) {
  console.log("Dry run. Pass --apply to try DELETE on the legacy rows.");
  process.exit(0);
}

let removed = 0;
let failed = 0;
for (const name of legacy) {
  let response;
  try {
    response = await fetch(`${endpoint}/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    failed += 1;
    continue;
  }
  if (response.status === 405 || response.status === 501) {
    console.warn(`Sidecar cannot delete MCP servers (HTTP ${response.status}). Stopping.`);
    console.warn("Legacy rows remain but are no longer written. Pooled slot reuse in the app keeps new growth at zero.");
    process.exit(3);
  }
  if (response.ok || response.status === 404) removed += 1;
  else failed += 1;
}
console.log(`Deleted ${removed} legacy rows, ${failed} failed.`);
process.exit(failed ? 1 : 0);
