import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filePreviewMode,
  parseCsvTable,
  textFromArtifactContent,
} from "./table-preview";

describe("table preview helpers", () => {
  it("parses a csv into columns and rows", () => {
    const table = parseCsvTable("item,amount\nrent,1200\nsoftware,80\n");
    assert.ok(table);
    assert.deepEqual(table.columns, ["item", "amount"]);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0]?.item, "rent");
    assert.equal(table.rows[1]?.amount, "80");
  });

  it("treats csv as a table preview and office binaries as downloads", () => {
    assert.equal(filePreviewMode("q3-costs.csv"), "table");
    assert.equal(filePreviewMode("memo.docx"), "download");
    assert.equal(filePreviewMode("memo.pdf"), "download");
    assert.equal(filePreviewMode("q3-costs.xlsx"), "download");
    assert.equal(filePreviewMode("notes.txt"), "download");
  });

  it("decodes a csv data URL back to text", () => {
    const csv = "item,amount\nrent,1200";
    const dataUrl = `data:text/csv;base64,${Buffer.from(csv).toString("base64")}`;
    assert.equal(textFromArtifactContent(dataUrl), csv);
    assert.equal(textFromArtifactContent(csv), csv);
  });
});
