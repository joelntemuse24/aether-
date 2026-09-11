import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractOfficeText } from "@/lib/office-text";
import { buildPresentationPptx } from "./build-pptx";
import { buildSpreadsheetXlsx } from "./build-xlsx";
import { parseDataUrl } from "./file-artifact";

describe("buildPresentationPptx", () => {
  it("builds a real .pptx that round-trips slide text", async () => {
    const deck = await buildPresentationPptx({
      title: "Ireland investment operations",
      slides: [
        {
          title: "Ireland investment operations",
          bullets: ["Market map for 2026"],
          layout: "title",
        },
        {
          title: "Market size",
          bullets: ["AUM growing in Dublin", "Fund admin still concentrated"],
        },
      ],
    });
    assert.equal(deck.filename.endsWith(".pptx"), true);
    assert.equal(deck.buffer.subarray(0, 2).toString(), "PK");
    const parsed = parseDataUrl(deck.dataUrl);
    assert.ok(parsed);
    assert.equal(parsed?.buffer.equals(deck.buffer), true);
    const text = await extractOfficeText(deck.buffer, deck.filename, deck.mime);
    assert.match(String(text), /Ireland investment operations/);
    assert.match(String(text), /Market size/);
    assert.match(String(text), /AUM growing in Dublin/);
    assert.equal(deck.slideCount, 2);
  });

  it("still produces a title slide when the model omits slides", async () => {
    const deck = await buildPresentationPptx({
      title: "Empty-ish",
      slides: [],
    });
    assert.equal(deck.slideCount, 1);
    const text = await extractOfficeText(deck.buffer, "x.pptx", deck.mime);
    assert.match(String(text), /Empty-ish/);
  });
});

describe("buildSpreadsheetXlsx", () => {
  it("builds a real .xlsx with headers and rows", async () => {
    const book = await buildSpreadsheetXlsx({
      title: "Q3 costs",
      sheets: [
        {
          name: "Costs",
          headers: ["item", "amount"],
          rows: [
            ["rent", 1200],
            ["software", 80],
          ],
        },
      ],
    });
    assert.equal(book.filename.endsWith(".xlsx"), true);
    assert.equal(book.buffer.subarray(0, 2).toString(), "PK");
    const text = await extractOfficeText(book.buffer, book.filename, book.mime);
    assert.match(String(text), /rent/);
    assert.match(String(text), /1200/);
  });
});
