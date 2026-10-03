/**
 * VM agent process. Bind loopback unless AETHER_AGENT_HOST is set.
 *   npx tsx src/agent-server/server.ts
 * This is not the TrueForge sidecar and it is not pm2 app "aether".
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentServer } from "./handler";
import { runNativeTurn } from "./run-turn";
import { loadLocalEnvFiles } from "@/lib/trueforge/load-env";

function readPort(name: string, fallback: number): number {
  const raw = Number(process.env[name] || fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function startAgentServer(): void {
  loadLocalEnvFiles();
  const token = (process.env.AETHER_TRUEFORGE_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("AETHER_TRUEFORGE_TOKEN is required to expose the agent server.");
  }
  const port = readPort("AETHER_AGENT_PORT", 8792);
  const host = (process.env.AETHER_AGENT_HOST ?? "").trim() || "127.0.0.1";
  const server = createAgentServer({
    token,
    runTurn: (body, signal, onChunk) => runNativeTurn(body, signal, { onChunk }),
  });
  server.listen(port, host, () => {
    console.info(`[agent-server] listening on ${host}:${port}`);
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) startAgentServer();
