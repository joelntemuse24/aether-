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
    assert.doesNotMatch(runtime, /headStart|Head Start|chat\.headStart/);
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

  it("does not use Head Start on the durable agent", () => {
    const agent = readFileSync(
      new URL("../../trigger/chat.ts", import.meta.url),
      "utf8",
    );
    assert.match(agent, /chat\.agent/);
    assert.doesNotMatch(agent, /headStart|Head Start|chat\.headStart/);
  });

  it("keeps POST /api/chat/start-session from persisting BYOK keys on the session", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/start-session/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /sessionSafeChatClientData/);
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
});
