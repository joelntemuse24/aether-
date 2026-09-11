import JSZip from "jszip";
import { xmlEscape, slugFilename } from "./xml";
import { bufferToDataUrl } from "./file-artifact";
import { XLSX_MIME } from "@/lib/office-text";

export type SpreadsheetSheet = {
  name?: string;
  headers?: string[];
  rows: Array<Array<string | number | boolean | null>>;
};

export type SpreadsheetInput = {
  title: string;
  sheets: SpreadsheetSheet[];
};

const MAX_SHEETS = 8;
const MAX_ROWS = 400;
const MAX_COLS = 24;
const MAX_CELL = 200;

function clipCell(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= MAX_CELL) return text;
  return `${text.slice(0, MAX_CELL - 1).trimEnd()}…`;
}

function colName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetName(raw: string | undefined, index: number): string {
  const cleaned = (raw || `Sheet ${index + 1}`)
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned || `Sheet ${index + 1}`;
}

export function normalizeSpreadsheetInput(input: SpreadsheetInput): {
  title: string;
  sheets: Array<{ name: string; grid: string[][] }>;
} {
  const title = clipCell(input.title) || "Spreadsheet";
  const sheets = (input.sheets ?? [])
    .slice(0, MAX_SHEETS)
    .map((sheet, index) => {
      const headers = (sheet.headers ?? []).map(clipCell).slice(0, MAX_COLS);
      const body = (sheet.rows ?? [])
        .slice(0, MAX_ROWS)
        .map((row) => (row ?? []).map(clipCell).slice(0, MAX_COLS));
      const width = Math.max(
        headers.length,
        ...body.map((r) => r.length),
        1,
      );
      const pad = (row: string[]) => {
        const next = row.slice(0, width);
        while (next.length < width) next.push("");
        return next;
      };
      const grid = [
        ...(headers.some((h) => h) ? [pad(headers)] : []),
        ...body.map(pad),
      ];
      return { name: sheetName(sheet.name, index), grid };
    })
    .filter((s) => s.grid.length > 0);
  if (sheets.length > 0) return { title, sheets };
  return { title, sheets: [{ name: "Sheet 1", grid: [[title]] }] };
}

function sheetXml(grid: string[][]): string {
  const rows = grid
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (!value) {
            return `<c r="${ref}"/>`;
          }
          if (/^-?\d+(\.\d+)?$/.test(value)) {
            return `<c r="${ref}" t="n"><v>${xmlEscape(value)}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const colCount = Math.max(1, ...grid.map((r) => r.length));
  const rowCount = Math.max(1, grid.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${colName(colCount - 1)}${rowCount}"/>
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map(
      (name, i) =>
        `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function workbookRels(count: number): string {
  const rels = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}

function contentTypes(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets}
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

function coreXml(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>Aether</dc:creator>
  <cp:lastModifiedBy>Aether</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(names: string[]): string {
  const titles = names
    .map((n) => `<vt:lpstr>${xmlEscape(n)}</vt:lpstr>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Aether</Application>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${names.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="${names.length}" baseType="lpstr">${titles}</vt:vector>
  </TitlesOfParts>
</Properties>`;
}

export async function buildSpreadsheetXlsx(input: SpreadsheetInput): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
  sheetCount: number;
  dataUrl: string;
}> {
  const { title, sheets } = normalizeSpreadsheetInput(input);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes(sheets.length));
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("docProps/core.xml", coreXml(title));
  zip.file(
    "docProps/app.xml",
    appXml(sheets.map((s) => s.name)),
  );
  zip.file("xl/workbook.xml", workbookXml(sheets.map((s) => s.name)));
  zip.file("xl/_rels/workbook.xml.rels", workbookRels(sheets.length));
  sheets.forEach((sheet, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.grid));
  });
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  return {
    buffer,
    filename: slugFilename(title, "xlsx"),
    mime: XLSX_MIME,
    sheetCount: sheets.length,
    dataUrl: bufferToDataUrl(buffer, XLSX_MIME),
  };
}
