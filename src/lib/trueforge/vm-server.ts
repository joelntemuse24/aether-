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
import { prepareSidecar } from "./sidecar-bootstrap";

function readPort(name: string, fallback: number): number {
  const raw = Number(process.env[name] || fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function cliPath(): string {
  return path.join(process.cwd(), "node_modules/@truefoundry/trueforge/dist/cli.js");
}

async function upstreamUp(upstreamPort: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/api/v1/capabilities`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUpstream(child: ChildProcess, upstreamPort: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`TrueForge sidecar exited (code ${child.exitCode}).`);
    }
    if (await upstreamUp(upstreamPort)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TrueForge sidecar did not listen on 127.0.0.1:${upstreamPort} within 30s.`);
}

function startUpstream(upstreamPort: number): ChildProcess {
  const cli = cliPath();
  if (!fs.existsSync(cli)) throw new Error(`TrueForge CLI missing at ${cli}.`);
  return spawn(process.execPath, [cli, "--port", String(upstreamPort)], {
    env: {
      ...process.env,
      STANDALONE: "true",
      HOST: "127.0.0.1",
      PORT: String(upstreamPort),
      APP_DATA_DIR_SUFFIX: process.env.APP_DATA_DIR_SUFFIX || "aether",
      OUTBOUND_URL_ALLOWED_HOSTS: withLocalMcpHosts(process.env.OUTBOUND_URL_ALLOWED_HOSTS),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function proxy(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number) {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  delete headers.authorization;
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
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

function listen(token: string, publicPort: number, upstreamPort: number): http.Server {
  const server = http.createServer((req, res) => {
    const pathOnly = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && pathOnly === "/health") {
      void upstreamUp(upstreamPort).then((ok) => {
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
    proxy(req, res, upstreamPort);
  });
  server.listen(publicPort, "0.0.0.0", () => {
    console.info(`[aether] TrueForge VM listening on 0.0.0.0:${publicPort}`);
  });
  return server;
}

async function main() {
  loadLocalEnvFiles();
  const publicPort = readPort("TRUEFORGE_PORT", 8790);
  const upstreamPort = readPort("TRUEFORGE_UPSTREAM_PORT", 8791);
  const token = (process.env.AETHER_TRUEFORGE_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("AETHER_TRUEFORGE_TOKEN is required to expose the sidecar.");
  }
  prepareSidecar();
  const child = startUpstream(upstreamPort);
  await waitForUpstream(child, upstreamPort);
  const seeded = await seedAetherModelProviders(`http://127.0.0.1:${upstreamPort}`);
  console.info("[aether] TrueForge providers", seeded);
  const server = listen(token, publicPort, upstreamPort);
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
