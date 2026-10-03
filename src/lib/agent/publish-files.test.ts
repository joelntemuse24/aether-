import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sandboxFileCards } from "./publish-files";

describe("sandbox file cards", () => {
  it("keeps downloadable files and drops internal paths", () => {
    const cards = sandboxFileCards({
      ok: true,
      data: {
        files: [
          {
            filename: "charts/plot.png",
            title: "plot.png",
            mime: "image/png",
            bytes: 4,
            persisted: false,
            content: "data:image/png;base64,aGVsbG8=",
          },
          { filename: "/workspace/secret.png", content: "data:image/png;base64,aGVsbG8=" },
          { filename: "sandbox:/mnt/data/out.csv", content: "data:text/csv;base64,YQ==" },
          { filename: "../out.pdf", content: "data:application/pdf;base64,YQ==" },
        ],
      },
    });
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.filename, "charts/plot.png");
    assert.match(cards[0]?.content ?? "", /^data:image\/png/);
  });
});
