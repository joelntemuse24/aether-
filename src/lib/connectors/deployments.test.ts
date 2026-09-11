import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEPLOYMENTS_UNAVAILABLE_MESSAGE,
  listDeployments,
  readDeployment,
} from "./deployments";

describe("deployments connector (read)", () => {
  it("is honest when no deployments token is configured", async () => {
    const listed = await listDeployments(
      {},
      { AETHER_DEPLOYMENTS_TOKEN: "", VERCEL_TOKEN: "" },
    );
    assert.equal(listed.ok, false);
    assert.equal(listed.error, DEPLOYMENTS_UNAVAILABLE_MESSAGE);
    assert.doesNotMatch(String(listed.error), /Vercel|Netlify/i);
  });

  it("does not reuse the workspace access token by default", async () => {
    const listed = await listDeployments(
      {},
      {
        AETHER_DEPLOYMENTS_TOKEN: "",
        VERCEL_TOKEN: "sandbox-tok",
        VERCEL_TEAM_ID: "team",
        VERCEL_PROJECT_ID: "prj",
      },
    );
    assert.equal(listed.ok, false);
    assert.equal(listed.error, DEPLOYMENTS_UNAVAILABLE_MESSAGE);
  });

  it("lists deployments from a real API payload", async () => {
    const listed = await listDeployments(
      {},
      { AETHER_DEPLOYMENTS_TOKEN: "tok" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              deployments: [
                { uid: "dpl_1", name: "aether", url: "aether.example", created: 1 },
              ],
            }),
            { status: 200 },
          ),
      },
    );
    assert.equal(listed.ok, true);
    if (listed.ok) {
      assert.equal(listed.deployments[0]?.id, "dpl_1");
    }
  });

  it("reads one deployment by id", async () => {
    const read = await readDeployment(
      { id: "dpl_1" },
      { AETHER_DEPLOYMENTS_TOKEN: "tok" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              uid: "dpl_1",
              name: "aether",
              url: "aether.example",
              readyState: "READY",
            }),
            { status: 200 },
          ),
      },
    );
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.id, "dpl_1");
  });
});
