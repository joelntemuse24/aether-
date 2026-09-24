import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("TrueForge harness wiring", () => {
  it("proxies the harness API and keeps the Aether chat shell", () => {
    const config = readFileSync(new URL("../../../next.config.ts", import.meta.url), "utf8");
    assert.match(config, /\/api\/v1\/:path\*/);
    const layout = readFileSync(
      new URL("../../app/(chat)/layout.tsx", import.meta.url),
      "utf8",
    );
    assert.match(layout, /ChatProviders/);
    assert.doesNotMatch(layout, /TrueForgeUI|TrueForgeChat/);
  });

  it("sends hosted turns through TrueForge before the legacy stream", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/route.ts", import.meta.url),
      "utf8",
    );
    const forge = route.indexOf("return streamTrueForgeHostedChat");
    const legacy = route.indexOf("return streamLegacyLocalChat");
    assert.ok(forge > 0 && legacy > forge);
  });
});
