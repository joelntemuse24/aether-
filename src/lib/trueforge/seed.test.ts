import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aetherProviderManifests } from "./providers";
import { ensureDefaultModelSeeded, upsertAetherProviders } from "./seed";

describe("TrueForge provider seed", () => {
  it("skips a rejected model and still seeds the rest", async () => {
    const manifests = aetherProviderManifests(
      { AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret" },
      ["gpt-5.6-luna", "claude-haiku-4-5-20251001", "claude-sonnet-5"],
    );
    assert.equal(manifests[0]?.type === "custom" && manifests[0].name, "omniroute");
    const sent: string[][] = [];
    const seeded = await upsertAetherProviders(manifests, async (manifest) => {
      sent.push(manifest.models.map((model) => model.modelId));
      if (manifest.models.some((model) => model.modelId.includes("haiku"))) {
        throw new Error("expected array to have >=1 items … reasoning_efforts");
      }
    });
    assert.deepEqual(seeded, ["omniroute", "buzz", "anthropic"]);
    assert.equal(sent.some((ids) => ids.includes("claude-haiku-4-5-20251001") && ids.includes("claude-sonnet-5")), false);
    assert.equal(sent.some((ids) => ids.length === 1 && ids[0] === "claude-sonnet-5"), true);
  });

  describe("ensureDefaultModelSeeded", () => {
    const quiet = { info() {}, warn() {}, error() {} };
    const fqn = "omniroute/auto";

    it("does not re-seed when the model is listed", async () => {
      let reseeds = 0;
      const ok = await ensureDefaultModelSeeded({
        fqn,
        listModelNames: async () => [fqn],
        reseed: async () => void reseeds++,
        sleep: async () => {},
        log: quiet,
      });
      assert.equal(ok, true);
      assert.equal(reseeds, 0);
    });

    it("re-seeds until the model appears", async () => {
      let reseeds = 0;
      const sleeps: number[] = [];
      const ok = await ensureDefaultModelSeeded({
        fqn,
        listModelNames: async () => (reseeds >= 1 ? [fqn] : ["buzz/gpt-5-6-luna"]),
        reseed: async () => void reseeds++,
        sleep: async (ms) => void sleeps.push(ms),
        log: quiet,
      });
      assert.equal(ok, true);
      assert.equal(reseeds, 1);
      assert.equal(sleeps.length, 1);
    });

    it("gives up after three checks and survives list and seed errors", async () => {
      let lists = 0;
      let reseeds = 0;
      const ok = await ensureDefaultModelSeeded({
        fqn,
        listModelNames: async () => {
          lists++;
          throw new Error("down");
        },
        reseed: async () => {
          reseeds++;
          throw new Error("seed down");
        },
        sleep: async () => {},
        log: quiet,
      });
      assert.equal(ok, false);
      assert.equal(lists, 3);
      assert.equal(reseeds, 2);
    });
  });
});
