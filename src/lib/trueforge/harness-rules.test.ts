import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AETHER_MCP_TOOL_NAMES } from "./mcp-http";
import { aetherMcpServers } from "./mcp-register";
import {
  TRUEFORGE_NO_TOOLS_NOTE,
  instructionsForAttachedTools,
  toolNamesInPrompt,
  trueforgeInstructions,
  trueforgeToolNote,
} from "./instructions";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { applyTrueForgeSidecarPatches } from "./sidecar-patch";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("harness rules", () => {
  it("names only the tools attached to the turn", () => {
    const catalog = AETHER_MCP_TOOL_NAMES;
    const web = aetherMcpServers({ direct: "aether-chat" }, false)[0]?.enableTools ?? [];
    const all = aetherMcpServers({ direct: "aether-chat" }, true)[0]?.enableTools ?? [];
    const base = trueforgeInstructions(`${TOOLS_SYSTEM_PROMPT}\n\nMemory: likes tea`);
    const webPrompt = instructionsForAttachedTools(base, web);
    const allPrompt = instructionsForAttachedTools(base, all);
    const nonePrompt = instructionsForAttachedTools(base, []);
    assert.deepEqual(toolNamesInPrompt(trueforgeToolNote(web), catalog), [...web].sort());
    assert.deepEqual(toolNamesInPrompt(webPrompt, catalog), [...web].sort());
    assert.deepEqual(toolNamesInPrompt(allPrompt, catalog), [...all].sort());
    assert.deepEqual(toolNamesInPrompt(nonePrompt, catalog), []);
    assert.deepEqual(toolNamesInPrompt(TRUEFORGE_NO_TOOLS_NOTE, catalog), []);
    assert.equal(webPrompt.includes("memory_search"), false);
    assert.equal(webPrompt.includes("execute_python"), false);
  });

  it("still matches the installed sidecar package", () => {
    const files = [
      "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.js",
      "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.js",
      "node_modules/@truefoundry/trueforge-core/dist/agent-session/builtinsFromSpec.mjs",
    ];
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-patch-"));
    for (const relative of files) {
      const to = path.join(temp, relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(root, relative), to);
    }
    const patched = applyTrueForgeSidecarPatches(temp);
    assert.equal(patched.length, files.length);
    assert.match(fs.readFileSync(path.join(temp, files[0]!), "utf8"), /!server\.preload/);
    assert.equal(
      fs.readFileSync(path.join(temp, files[2]!), "utf8").includes("currentDateTime({ tracing })"),
      false,
    );
  });

  it("does not return raw error.message from API routes", () => {
    const api = walk(path.join(root, "src/app/api"));
    const hits: string[] = [];
    for (const file of api) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const window = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
        const returnsBody = /return new Response|Response\.json/.test(lines[i] ?? "");
        if (!returnsBody) continue;
        if (/error\.message/.test(window) && /JSON\.stringify\(\{ error: message \}\)|error: error\.message/.test(window)) {
          hits.push(`${path.relative(root, file)}:${i + 1}`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });

  it("sends user-supplied URL fetches through the SSRF guard", () => {
    const browse = read("src/lib/connectors/browse-page.ts");
    const browser = read("src/lib/connectors/browser.ts");
    const fetchUrl = read("src/lib/connectors/web-and-drive.ts");
    assert.match(browse, /assertPublicHttpUrl/);
    assert.match(browse, /fetchWithPublicRedirects/);
    assert.match(browser, /assertPublicHttpUrl/);
    assert.match(browser, /fetchWithPublicRedirects/);
    assert.match(fetchUrl, /browsePage\(/);
    const mcp = read("src/lib/trueforge/mcp-http.ts");
    assert.match(mcp, /fetchUrlText\(/);
    assert.match(mcp, /browsePage\(/);
  });

  it("does not log API keys or access tokens", () => {
    const files = walk(path.join(root, "src"));
    const hits: string[] = [];
    const secret =
      /\b(apiKey|accessToken|refreshToken|openRouterKey|AETHER_TRUEFORGE_TOKEN|OPENROUTER_API_KEY)\b/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const re = /console\.(log|info|warn|error|debug)\(/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const end = text.indexOf(";", match.index);
        const call = text.slice(match.index, end === -1 ? match.index + 200 : end);
        if (secret.test(call) && !/redact/i.test(call)) {
          hits.push(`${path.relative(root, file)}: ${call.slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });

  it("reloads only the pm2 app aether", () => {
    const script = read("deploy/trueforge/health-gate.sh");
    assert.match(script, /APP="aether"/);
    assert.match(script, /pm2 reload "\$APP"/);
    assert.doesNotMatch(script, /pm2 reload all/);
    assert.doesNotMatch(script, /systemctl restart pm2-aether/);
    assert.doesNotMatch(script, /echomancer/);
  });
});
