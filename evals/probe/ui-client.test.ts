import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artifactPngPath, parseCookieHeader } from "./ui-client";

describe("probe UI client helpers", () => {
  it("parses Cookie env into Playwright cookies without hardcoding secrets", () => {
    const cookies = parseCookieHeader(
      "aether.session=abc; preview=1",
      "https://preview.example.com",
    );
    assert.equal(cookies.length, 2);
    assert.equal(cookies[0]?.name, "aether.session");
    assert.equal(cookies[0]?.url, "https://preview.example.com");
    assert.equal(cookies[1]?.name, "preview");
  });

  it("writes failure screenshots under evals/probe/artifacts/", () => {
    const path = artifactPngPath("time-dublin", "expert");
    assert.match(path, /evals\/probe\/artifacts\/time-dublin-expert-ui\.png$/);
  });
});
