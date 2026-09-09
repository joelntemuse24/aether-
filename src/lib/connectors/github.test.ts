import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { githubReadFileForUser } from "./github";

const originalFetch = globalThis.fetch;

describe("githubReadFileForUser", () => {
  beforeEach(() => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) {
        return new Response(
          JSON.stringify({
            type: "file",
            name: "large.txt",
            path: "large.txt",
            download_url: "https://raw.githubusercontent.com/acme/demo/main/large.txt",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      assert.equal(url, "https://raw.githubusercontent.com/acme/demo/main/large.txt");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer durable-token",
      );
      return new Response("durable file contents", { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the durable callback token for raw download fallbacks", async () => {
    const result = await githubReadFileForUser(
      "user-1",
      "acme/demo",
      "large.txt",
      "main",
      "durable-token",
    );

    assert.deepEqual(result, {
      ok: true,
      name: "large.txt",
      path: "large.txt",
      text: "durable file contents",
      truncated: false,
    });
  });
});
