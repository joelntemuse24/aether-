import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DESIGN_UNAVAILABLE_MESSAGE, listDesignFiles, readDesignFile } from "./design";

describe("design connector (read)", () => {
  it("is honest when no design token is configured", async () => {
    const listed = await listDesignFiles(
      { query: "brand" },
      { FIGMA_ACCESS_TOKEN: "", AETHER_DESIGN_TOKEN: "" },
    );
    assert.equal(listed.ok, false);
    assert.equal(listed.error, DESIGN_UNAVAILABLE_MESSAGE);
    assert.doesNotMatch(String(listed.error), /Figma|FigJam/i);

    const read = await readDesignFile(
      { fileKey: "abc" },
      { FIGMA_ACCESS_TOKEN: "" },
    );
    assert.equal(read.ok, false);
    assert.match(String(read.error), /not connected/i);
  });

  it("returns file metadata from a real API payload without inventing pages", async () => {
    const result = await readDesignFile(
      { fileKey: "file123" },
      { AETHER_DESIGN_TOKEN: "tok" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              name: "Brand kit",
              lastModified: "2026-09-01T00:00:00Z",
              document: {
                name: "Document",
                children: [{ name: "Cover" }, { name: "Type" }],
              },
            }),
            { status: 200 },
          ),
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.title, "Brand kit");
      assert.deepEqual(result.pages, ["Cover", "Type"]);
    }
  });
});
