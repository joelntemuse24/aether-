/**
 * Starts the TrueForge sidecar, seeds Buzz/OpenRouter, then runs Next.
 * `npm run dev` and `npm run start` use this so the harness is not imported
 * into the Next webpack graph.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  TRUEFORGE_PORT,
  trueforgeOrigin,
  trueforgeRemoteUrl,
  trueforgeSidecarEnabled,
} from "./config";
import { loadLocalEnvFiles } from "./load-env";
import { withLocalMcpHosts } from "./outbound-hosts";
import { seedAetherModelProviders } from "./seed";

function cliPath(): string {
  return path.join(process.cwd(), "node_modules/@truefoundry/trueforge/dist/cli.js");
}

async function isUp(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/v1/capabilities`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(origin: string, child: ChildProcess | null): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child && child.exitCode != null) {
      throw new Error(`TrueForge sidecar exited (code ${child.exitCode}).`);
    }
    if (await isUp(origin)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TrueForge sidecar did not listen on ${origin} within 30s.`);
}

async function ensureSidecar(): Promise<ChildProcess | null> {
  if (!trueforgeSidecarEnabled()) return null;
  const origin = trueforgeOrigin();
  if (await isUp(origin)) {
    console.info("[aether] TrueForge already listening", origin);
    return null;
  }
  const cli = cliPath();
  if (!fs.existsSync(cli)) {
    throw new Error(`TrueForge CLI missing at ${cli}.`);
  }
  const child = spawn(process.execPath, [cli, "--port", String(TRUEFORGE_PORT)], {
    env: {
      ...process.env,
      STANDALONE: "true",
      HOST: "127.0.0.1",
      PORT: String(TRUEFORGE_PORT),
      APP_DATA_DIR_SUFFIX: process.env.APP_DATA_DIR_SUFFIX || "aether",
      OUTBOUND_URL_ALLOWED_HOSTS: withLocalMcpHosts(process.env.OUTBOUND_URL_ALLOWED_HOSTS),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitUntilUp(origin, child);
  return child;
}

async function main() {
  loadLocalEnvFiles();
  const mode = process.argv[2] === "start" ? "start" : "dev";
  const remote = trueforgeRemoteUrl();
  const sidecar = remote ? null : await ensureSidecar();
  if (remote) {
    console.info("[aether] TrueForge remote", remote);
  } else if (sidecar || (trueforgeSidecarEnabled() && (await isUp(trueforgeOrigin())))) {
    const seeded = await seedAetherModelProviders(trueforgeOrigin());
    console.info("[aether] TrueForge providers", seeded);
  }

  const nextBin = path.join(process.cwd(), "node_modules/next/dist/bin/next");
  const next = spawn(process.execPath, [nextBin, mode], {
    stdio: "inherit",
    env: process.env,
  });

  const stop = () => {
    next.kill("SIGTERM");
    sidecar?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  next.on("exit", (code) => {
    sidecar?.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
