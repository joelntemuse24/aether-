import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildSpreadsheetXlsx } from "@/lib/office/build-xlsx";
import {
  filePreviewMode,
  isXlsxFilename,
  parseCsvTable,
  parseXlsxTable,
  textFromArtifactContent,
  XLSX_PREVIEW_MAX_COLS,
  XLSX_PREVIEW_MAX_ROWS,
} from "./table-preview";

const SHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

async function zipBytes(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(files)) zip.file(path, body);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

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
    assert.equal(filePreviewMode("q3-costs.xlsx"), "table");
    assert.equal(filePreviewMode("Q3-COSTS.XLSX"), "table");
    assert.equal(filePreviewMode("deck.pptx"), "download");
    assert.equal(filePreviewMode("notes.txt"), "download");
    assert.equal(isXlsxFilename("q3-costs.xlsx"), true);
    assert.equal(isXlsxFilename("q3-costs.csv"), false);
  });

  it("decodes a csv data URL back to text", () => {
    const csv = "item,amount\nrent,1200";
    const dataUrl = `data:text/csv;base64,${Buffer.from(csv).toString("base64")}`;
    assert.equal(textFromArtifactContent(dataUrl), csv);
    assert.equal(textFromArtifactContent(csv), csv);
  });
});

describe("xlsx table preview", () => {
  it("round-trips a workbook from buildSpreadsheetXlsx (data URL, base64, buffer)", async () => {
    const built = await buildSpreadsheetXlsx({
      title: "Costs",
      sheets: [
        {
          name: "Q3",
          headers: ["item", "amount"],
          rows: [
            ["rent & utilities", 1200],
            ["software", 80],
          ],
        },
        { name: "Other", headers: ["x"], rows: [["ignored"]] },
      ],
    });
    for (const source of [
      built.dataUrl,
      built.buffer.toString("base64"),
      built.buffer,
    ]) {
      const table = await parseXlsxTable(source);
      assert.ok(table);
      assert.deepEqual(table.columns, ["item", "amount"]);
      assert.equal(table.rows.length, 2);
      assert.equal(table.rows[0]?.item, "rent & utilities");
      assert.equal(table.rows[1]?.amount, "80");
      assert.equal(table.sheetName, "Q3");
      assert.equal(table.truncated, false);
    }
  });

  it("caps rows and columns", async () => {
    const wide = Array.from({ length: XLSX_PREVIEW_MAX_COLS + 5 }, (_, i) => `h${i}`);
    const rows = Array.from({ length: 300 }, (_, r) =>
      wide.map((_, c) => `${r}-${c}`),
    );
    // buildSpreadsheetXlsx caps at 24 cols; build the wide sheet by hand.
    const cell = (r: number, c: number, v: string) => {
      const letters = c < 26 ? String.fromCharCode(65 + c) : `A${String.fromCharCode(65 + c - 26)}`;
      return `<c r="${letters}${r}" t="inlineStr"><is><t>${v}</t></is></c>`;
    };
    const sheetRows = [wide, ...rows]
      .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(r + 1, c, v)).join("")}</row>`)
      .join("");
    const buffer = await zipBytes({
      "xl/workbook.xml": `<workbook ${SHEET_NS} xmlns:r="x"><sheets><sheet name="Big" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${SHEET_NS}><sheetData>${sheetRows}</sheetData></worksheet>`,
    });
    const table = await parseXlsxTable(buffer);
    assert.ok(table);
    assert.equal(table.columns.length, XLSX_PREVIEW_MAX_COLS);
    assert.equal(table.rows.length, XLSX_PREVIEW_MAX_ROWS);
    assert.equal(table.truncated, true);
    assert.equal(table.rows[0]?.h0, "0-0");
  });

  it("reads shared strings, booleans, gaps, and follows the workbook rels", async () => {
    const buffer = await zipBytes({
      "xl/workbook.xml": `<workbook ${SHEET_NS} xmlns:r="x"><sheets><sheet name="Data" sheetId="3" r:id="rId9"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId9" Target="worksheets/data.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst ${SHEET_NS}><si><t>name</t></si><si><r><t>Al</t></r><r><t xml:space="preserve">ice</t></r></si><si><t/></si><si><t>flag</t></si></sst>`,
      "xl/worksheets/data.xml": `<worksheet ${SHEET_NS}><sheetData>
        <row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="s"><v>3</v></c></row>
        <row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4"><v>3.5</v></c><c r="C4" t="b"><v>1</v></c></row>
      </sheetData></worksheet>`,
    });
    const table = await parseXlsxTable(buffer);
    assert.ok(table);
    assert.deepEqual(table.columns, ["name", "col_2", "flag"]);
    assert.equal(table.rows.length, 1);
    assert.deepEqual(table.rows[0], { name: "Alice", col_2: "3.5", flag: "TRUE" });
  });

  it("returns null for empty sheets, missing parts, and non-workbooks", async () => {
    const empty = await buildSpreadsheetXlsx({ title: "", sheets: [{ rows: [] }] });
    // The builder writes a single title cell for an empty input, which is a header-only table.
    const headerOnly = await parseXlsxTable(empty.buffer);
    assert.ok(headerOnly);
    assert.equal(headerOnly.rows.length, 0);

    const blank = await zipBytes({
      "xl/workbook.xml": `<workbook ${SHEET_NS}><sheets><sheet name="A" sheetId="1"/></sheets></workbook>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${SHEET_NS}><sheetData><row r="1"><c r="A1"/></row></sheetData></worksheet>`,
    });
    assert.equal(await parseXlsxTable(blank), null);
    assert.equal(await parseXlsxTable(await zipBytes({ "readme.txt": "hi" })), null);
    assert.equal(await parseXlsxTable("not a zip"), null);
    assert.equal(await parseXlsxTable(""), null);
  });
});
