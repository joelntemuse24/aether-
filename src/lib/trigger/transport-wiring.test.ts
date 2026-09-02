import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolveChatTransportMode } from "./config";

describe("chat transport wiring contract", () => {
  it("falls back to the request path when Trigger env is unset", () => {
    assert.equal(resolveChatTransportMode({}), "request");
  });

  it("keeps POST /api/chat as the request fallback in the client runtime", () => {
    const runtime = readFileSync(
      new URL("../../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    assert.match(runtime, /api:\s*"\/api\/chat"/);
  });

  it("uses the durable transport hook when chatTransport is durable", () => {
    const runtime = readFileSync(
      new URL("../../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    assert.match(runtime, /useTriggerChatTransport/);
    assert.match(runtime, /chatTransport/);
    assert.match(runtime, /\/api\/chat\/start-session/);
    assert.match(runtime, /\/api\/chat\/mint-token/);
    assert.match(runtime, /headStart:\s*DURABLE_HEAD_START_PATH/);
    assert.match(runtime, /DURABLE_HEAD_START_PATH/);
  });

  it("does not call start-session or mint-token on the first-send path", () => {
    const runtime = readFileSync(
      new URL("../../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    // First turn POSTs headStart. start-session/mint-token stay for turn 2+.
    assert.match(runtime, /headStart:\s*DURABLE_HEAD_START_PATH/);
    assert.doesNotMatch(
      runtime,
      /await currentAui\.threadListItem\(\)\.initialize\(\)/,
    );
  });

  it("starts and mints against the transport chatId, not a remapped thread remoteId", () => {
    const runtime = readFileSync(
      new URL("../../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    // Remapping start-session to assistant-ui's remoteId while useChat
    // still appends with its own id is the production 403:
    // appendToSessionStream failed: 403 unauthorized access_token.
    assert.doesNotMatch(runtime, /chatId:\s*remoteId/);
    assert.match(runtime, /buildStartSessionRequest/);
    assert.match(runtime, /transportChatId:\s*chatId/);
    assert.match(runtime, /parseMintedAccessToken/);
    assert.match(runtime, /parseStartSessionResult/);
    assert.match(
      runtime,
      /id:\s*chatTransport === "durable" \? durableChatId : undefined/,
    );
  });

  it("does not name vendors in the cream UI runtime", () => {
    const runtime = readFileSync(
      new URL("../../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    // Import paths may mention the SDK; visible copy / user strings must not.
    const userFacing = runtime.replace(/from\s+"[^"]+"/g, "");
    assert.doesNotMatch(userFacing, /["'`][^"'`]*\b(Trigger|Hermes|Buzz|Railway|OpenRouter|Vercel)\b/);
  });

  it("keeps the durable agent as step 2+ owner (no Head Start import in the worker)", () => {
    const agent = readFileSync(
      new URL("../../trigger/chat.ts", import.meta.url),
      "utf8",
    );
    assert.match(agent, /chat\.agent/);
    assert.doesNotMatch(agent, /headStart|Head Start|chat\.headStart/);
    assert.doesNotMatch(agent, /@trigger\.dev\/sdk\/chat-server/);
  });

  it("keeps POST /api/chat/start-session from persisting BYOK keys on the session", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/start-session/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /sessionSafeChatClientData/);
    assert.match(route, /parseStartSessionResult/);
    assert.doesNotMatch(route, /drizzle|getDb\(|sql`/);
  });

  it("does not list the SDK in both transpilePackages and serverExternalPackages", () => {
    const config = readFileSync(
      new URL("../../../next.config.ts", import.meta.url),
      "utf8",
    );
    const transpile = /transpilePackages:\s*\[[^\]]*@trigger\.dev\/sdk/.test(config);
    const external = /serverExternalPackages:\s*\[[^\]]*@trigger\.dev\/sdk/.test(config);
    assert.equal(transpile && external, false);
  });

  it("initializes __LOCALID_ threads with the durable useChat id", () => {
    const adapter = readFileSync(
      new URL("../local-thread-adapter.tsx", import.meta.url),
      "utf8",
    );
    assert.match(adapter, /resolveInitializedRemoteId/);
    assert.doesNotMatch(
      adapter,
      /const remoteId = threadId\.startsWith\("__LOCALID_"\)\s*\n\s*\? crypto\.randomUUID\(\)/,
    );
  });

  it("returns initialize remoteId without awaiting conversation create", () => {
    const adapter = readFileSync(
      new URL("../local-thread-adapter.tsx", import.meta.url),
      "utf8",
    );
    const start = adapter.indexOf("async initialize(threadId");
    const end = adapter.indexOf("async rename(");
    assert.ok(start >= 0 && end > start);
    const initialize = adapter.slice(start, end);
    assert.doesNotMatch(initialize, /if \(await ensureMode\(\)\)/);
    assert.doesNotMatch(initialize, /await cloudCreateThread\(\{ id: remoteId \}\);\s*\n\s*return \{ remoteId/);
    assert.match(initialize, /void \(async \(\) => \{/);
    assert.match(initialize, /return \{ remoteId, externalId: undefined \}/);
  });
});
