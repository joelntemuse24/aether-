import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { extractOfficeText } from "@/lib/office-text";
import { buildPresentationPptx } from "./build-pptx";
import { buildSpreadsheetXlsx } from "./build-xlsx";
import { buildDocumentDocx } from "./build-docx";
import { buildDocumentPdf } from "./build-pdf";
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
    const zip = await JSZip.loadAsync(deck.buffer);
    const contentTypes = zip.file("[Content_Types].xml");
    assert.ok(contentTypes, "pptx must include [Content_Types].xml");
    const xml = await contentTypes.async("string");
    assert.match(xml, /ContentType/);
    assert.match(xml, /presentationml/);
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
    const parsed = parseDataUrl(book.dataUrl);
    assert.ok(parsed);
    assert.equal(parsed?.buffer.equals(book.buffer), true);
    const text = await extractOfficeText(book.buffer, book.filename, book.mime);
    assert.match(String(text), /item/);
    assert.match(String(text), /rent/);
    assert.match(String(text), /1200/);
    const zip = await JSZip.loadAsync(book.buffer);
    const contentTypes = zip.file("[Content_Types].xml");
    assert.ok(contentTypes, "xlsx must include [Content_Types].xml");
    const xml = await contentTypes.async("string");
    assert.match(xml, /ContentType/);
    assert.match(xml, /spreadsheetml/);
    assert.ok(zip.file("xl/workbook.xml"), "xlsx must include xl/workbook.xml");
    assert.ok(
      zip.file("xl/worksheets/sheet1.xml"),
      "xlsx must include xl/worksheets/sheet1.xml",
    );
    assert.ok(zip.file("_rels/.rels"), "xlsx must include _rels/.rels");
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    assert.match(sheet, /rent/);
    assert.match(sheet, /1200/);
  });
});

describe("buildDocumentDocx", () => {
  it("builds a real .docx that round-trips title and paragraphs", async () => {
    const doc = await buildDocumentDocx({
      title: "Q3 ops memo",
      subtitle: "Internal briefing",
      paragraphs: [
        "Rent is the largest line item this quarter.",
        "Software spend stayed flat at 80.",
      ],
    });
    assert.equal(doc.filename.endsWith(".docx"), true);
    assert.equal(doc.buffer.subarray(0, 2).toString(), "PK");
    const parsed = parseDataUrl(doc.dataUrl);
    assert.ok(parsed);
    assert.equal(parsed?.buffer.equals(doc.buffer), true);
    const text = await extractOfficeText(doc.buffer, doc.filename, doc.mime);
    assert.match(String(text), /Q3 ops memo/);
    assert.match(String(text), /Internal briefing/);
    assert.match(String(text), /Rent is the largest line item/);
    const zip = await JSZip.loadAsync(doc.buffer);
    const contentTypes = zip.file("[Content_Types].xml");
    assert.ok(contentTypes, "docx must include [Content_Types].xml");
    const xml = await contentTypes.async("string");
    assert.match(xml, /ContentType/);
    assert.match(xml, /wordprocessingml/);
    assert.ok(zip.file("word/document.xml"), "docx must include word/document.xml");
    assert.ok(zip.file("_rels/.rels"), "docx must include _rels/.rels");
  });

  it("still produces a title paragraph when the model omits body copy", async () => {
    const doc = await buildDocumentDocx({
      title: "Empty-ish memo",
      paragraphs: [],
    });
    const text = await extractOfficeText(doc.buffer, "x.docx", doc.mime);
    assert.match(String(text), /Empty-ish memo/);
  });
});

describe("buildDocumentPdf", () => {
  it("builds a real .pdf with title and paragraphs", async () => {
    const pdf = await buildDocumentPdf({
      title: "Q3 ops memo",
      paragraphs: ["Rent is the largest line item this quarter."],
    });
    assert.equal(pdf.filename.endsWith(".pdf"), true);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.buffer.toString("latin1"), /%%EOF/);
    const parsed = parseDataUrl(pdf.dataUrl);
    assert.ok(parsed);
    assert.equal(parsed?.buffer.equals(pdf.buffer), true);
    const body = pdf.buffer.toString("latin1");
    assert.match(body, /Q3 ops memo/);
    assert.match(body, /Rent is the largest line item/);
  });
});
