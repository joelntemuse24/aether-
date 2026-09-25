/**
 * TrueForge on a VM. The published package does not require a key in standalone
 * mode, so this process binds the public port, checks `AETHER_TRUEFORGE_TOKEN`
 * on every API request, and proxies to TrueForge on loopback.
 *
 *   npm run trueforge
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { bearerMatches } from "./auth";
import { loadLocalEnvFiles } from "./load-env";
import { withLocalMcpHosts } from "./outbound-hosts";
import { seedAetherModelProviders } from "./seed";

const PUBLIC_PORT = Number(process.env.TRUEFORGE_PORT || 8790);
const UPSTREAM_PORT = Number(process.env.TRUEFORGE_UPSTREAM_PORT || 8791);
const UPSTREAM = `http://127.0.0.1:${UPSTREAM_PORT}`;

function cliPath(): string {
  return path.join(process.cwd(), "node_modules/@truefoundry/trueforge/dist/cli.js");
}

async function upstreamUp(): Promise<boolean> {
  try {
    const response = await fetch(`${UPSTREAM}/api/v1/capabilities`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUpstream(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`TrueForge sidecar exited (code ${child.exitCode}).`);
    }
    if (await upstreamUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TrueForge sidecar did not listen on ${UPSTREAM} within 30s.`);
}

function startUpstream(): ChildProcess {
  const cli = cliPath();
  if (!fs.existsSync(cli)) throw new Error(`TrueForge CLI missing at ${cli}.`);
  return spawn(process.execPath, [cli, "--port", String(UPSTREAM_PORT)], {
    env: {
      ...process.env,
      STANDALONE: "true",
      HOST: "127.0.0.1",
      PORT: String(UPSTREAM_PORT),
      APP_DATA_DIR_SUFFIX: process.env.APP_DATA_DIR_SUFFIX || "aether",
      OUTBOUND_URL_ALLOWED_HOSTS: withLocalMcpHosts(process.env.OUTBOUND_URL_ALLOWED_HOSTS),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function proxy(req: http.IncomingMessage, res: http.ServerResponse) {
  const headers = { ...req.headers, host: `127.0.0.1:${UPSTREAM_PORT}` };
  delete headers.authorization;
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: UPSTREAM_PORT,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "TrueForge sidecar is not reachable." }));
  });
  req.pipe(upstream);
}

function listen(token: string): http.Server {
  const server = http.createServer((req, res) => {
    const pathOnly = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && pathOnly === "/health") {
      void upstreamUp().then((ok) => {
        res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok }));
      });
      return;
    }
    if (!bearerMatches(req.headers.authorization, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized." }));
      return;
    }
    proxy(req, res);
  });
  server.listen(PUBLIC_PORT, "0.0.0.0", () => {
    console.info(`[aether] TrueForge VM listening on 0.0.0.0:${PUBLIC_PORT}`);
  });
  return server;
}

async function main() {
  loadLocalEnvFiles();
  const token = (process.env.AETHER_TRUEFORGE_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("AETHER_TRUEFORGE_TOKEN is required to expose the sidecar.");
  }
  const child = startUpstream();
  await waitForUpstream(child);
  const seeded = await seedAetherModelProviders(UPSTREAM);
  console.info("[aether] TrueForge providers", seeded);
  const server = listen(token);
  const stop = () => {
    server.close();
    child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 1);
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
