import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("TrueForge harness wiring", () => {
  it("keeps the Aether chat shell and does not publish the sidecar", () => {
    const config = readFileSync(new URL("../../../next.config.ts", import.meta.url), "utf8");
    assert.doesNotMatch(config, /\/api\/v1\/:path\*/);
    assert.doesNotMatch(config, /rewrites\s*\(/);
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
    assert.match(route, /trueforgeSidecarReachable/);
    assert.match(route, /system,/);
    assert.match(route, /attachments,/);
  });
});
