import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aetherProviderManifests } from "./providers";
import { upsertAetherProviders } from "./seed";

describe("TrueForge provider seed", () => {
  it("skips a rejected model and still seeds the rest", async () => {
    const manifests = aetherProviderManifests(
      { AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret" },
      ["gpt-5.6-luna", "claude-haiku-4-5-20251001", "claude-sonnet-5"],
    );
    const sent: string[][] = [];
    const seeded = await upsertAetherProviders(manifests, async (manifest) => {
      sent.push(manifest.models.map((model) => model.modelId));
      if (manifest.models.some((model) => model.modelId.includes("haiku"))) {
        throw new Error("expected array to have >=1 items … reasoning_efforts");
      }
    });
    assert.deepEqual(seeded, ["buzz", "anthropic"]);
    assert.equal(sent.some((ids) => ids.includes("claude-haiku-4-5-20251001") && ids.includes("claude-sonnet-5")), false);
    assert.equal(sent.some((ids) => ids.length === 1 && ids[0] === "claude-sonnet-5"), true);
  });
});
