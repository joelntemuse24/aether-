import JSZip from "jszip";
import { xmlEscape, slugFilename } from "./xml";
import { bufferToDataUrl } from "./file-artifact";
import { DOCX_MIME } from "@/lib/office-text";

export type DocumentInput = {
  title: string;
  subtitle?: string;
  paragraphs: string[];
};

const MAX_PARAS = 80;
const MAX_CHARS = 2000;

function clip(value: string, max = MAX_CHARS): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function normalizeDocumentInput(input: DocumentInput): {
  title: string;
  subtitle?: string;
  paragraphs: string[];
} {
  const title = clip(input.title, 280) || "Document";
  const subtitle = input.subtitle ? clip(input.subtitle, 280) : "";
  const paragraphs = (input.paragraphs ?? [])
    .map((p) => clip(p))
    .filter(Boolean)
    .slice(0, MAX_PARAS);
  return {
    title,
    subtitle: subtitle || undefined,
    paragraphs,
  };
}

function wt(text: string): string {
  return `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>`;
}

function para(
  text: string,
  opts?: { bold?: boolean; sizeHalfPoints?: number; after?: number },
): string {
  const size = opts?.sizeHalfPoints ?? 24;
  const bold = opts?.bold ? "<w:b/>" : "";
  const after = opts?.after ?? 160;
  return `<w:p>
  <w:pPr>
    <w:spacing w:after="${after}"/>
    <w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
  </w:pPr>
  <w:r>
    <w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
    ${wt(text)}
  </w:r>
</w:p>`;
}

function documentXml(input: {
  title: string;
  subtitle?: string;
  paragraphs: string[];
}): string {
  const body = [
    para(input.title, { bold: true, sizeHalfPoints: 36, after: 200 }),
    input.subtitle
      ? para(input.subtitle, { sizeHalfPoints: 24, after: 280 })
      : "",
    ...input.paragraphs.map((p) => para(p)),
  ]
    .filter(Boolean)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
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

function appXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Aether</Application>
</Properties>`;
}

export async function buildDocumentDocx(input: DocumentInput): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
  paragraphCount: number;
  dataUrl: string;
}> {
  const doc = normalizeDocumentInput(input);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("docProps/core.xml", coreXml(doc.title));
  zip.file("docProps/app.xml", appXml());
  zip.file("word/document.xml", documentXml(doc));
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  return {
    buffer,
    filename: slugFilename(doc.title, "docx"),
    mime: DOCX_MIME,
    paragraphCount: 1 + (doc.subtitle ? 1 : 0) + doc.paragraphs.length,
    dataUrl: bufferToDataUrl(buffer, DOCX_MIME),
  };
}
