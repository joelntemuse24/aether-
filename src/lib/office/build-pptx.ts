import JSZip from "jszip";
import { xmlEscape, slugFilename } from "./xml";
import { bufferToDataUrl } from "./file-artifact";
import { PPTX_MIME } from "@/lib/office-text";

export type PresentationSlideLayout = "title" | "title_and_bullets" | "section";

export type PresentationSlide = {
  title: string;
  bullets?: string[];
  notes?: string;
  layout?: PresentationSlideLayout;
};

export type PresentationInput = {
  title: string;
  subtitle?: string;
  slides: PresentationSlide[];
};

const MAX_SLIDES = 40;
const MAX_BULLETS = 8;
const MAX_CHARS = 280;

/** Cream canvas + terracotta accent — matches Aether, travels in the file. */
const COLOR = {
  cream: "F6F1E8",
  ink: "2C2420",
  muted: "6B5E57",
  terracotta: "C45C3E",
  rule: "E4D9C8",
};

function clip(value: string, max = MAX_CHARS): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function para(
  text: string,
  opts: { sizePt: number; bold?: boolean; color: string; align?: "l" | "ctr"; bullet?: boolean },
): string {
  const algn = opts.align === "ctr" ? ` algn="ctr"` : "";
  const b = opts.bold ? ` b="1"` : "";
  const bu = opts.bullet
    ? `<a:buFont typeface="Arial"/><a:buChar char="•"/>`
    : `<a:buNone/>`;
  return `<a:p>
  <a:pPr${algn} marL="${opts.bullet ? "342900" : "0"}" indent="${opts.bullet ? "-171450" : "0"}">${bu}</a:pPr>
  <a:r>
    <a:rPr lang="en-US" sz="${opts.sizePt * 100}"${b} dirty="0">
      <a:solidFill><a:srgbClr val="${opts.color}"/></a:solidFill>
      <a:latin typeface="Arial"/>
    </a:rPr>
    <a:t>${xmlEscape(text)}</a:t>
  </a:r>
  <a:endParaRPr lang="en-US" sz="${opts.sizePt * 100}"/>
</a:p>`;
}

function shape(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  body: string,
): string {
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="${name}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${x}" y="${y}"/>
      <a:ext cx="${cx}" cy="${cy}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/>
    <a:lstStyle/>
    ${body}
  </p:txBody>
</p:sp>`;
}

function accentBar(): string {
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="2" name="Accent"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="0" y="0"/>
      <a:ext cx="12192000" cy="114300"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="${COLOR.terracotta}"/></a:solidFill>
    <a:ln><a:noFill/></a:ln>
  </p:spPr>
</p:sp>`;
}

function slideXml(slide: PresentationSlide, index: number): string {
  const layout = slide.layout ?? (index === 0 ? "title" : "title_and_bullets");
  const title = clip(slide.title, 120) || `Slide ${index + 1}`;
  const bullets = (slide.bullets ?? [])
    .map((b) => clip(b))
    .filter(Boolean)
    .slice(0, MAX_BULLETS);

  let shapes = accentBar();
  if (layout === "title") {
    const subtitle = bullets[0] || clip(slide.notes ?? "", 160);
    shapes += shape(
      3,
      "Title",
      685800,
      2286000,
      10820400,
      1714500,
      para(title, { sizePt: 36, bold: true, color: COLOR.ink, align: "ctr" }),
    );
    if (subtitle) {
      shapes += shape(
        4,
        "Subtitle",
        685800,
        4114800,
        10820400,
        1143000,
        para(subtitle, { sizePt: 16, color: COLOR.muted, align: "ctr" }),
      );
    }
  } else if (layout === "section") {
    shapes += shape(
      3,
      "Title",
      685800,
      2743200,
      10820400,
      1371600,
      para(title, { sizePt: 32, bold: true, color: COLOR.ink, align: "ctr" }),
    );
  } else {
    shapes += shape(
      3,
      "Title",
      685800,
      411480,
      10820400,
      822960,
      para(title, { sizePt: 24, bold: true, color: COLOR.ink }),
    );
    const body =
      bullets.length > 0
        ? bullets
            .map((b) =>
              para(b, { sizePt: 16, color: COLOR.ink, bullet: true }),
            )
            .join("")
        : para("", { sizePt: 16, color: COLOR.ink });
    shapes += shape(4, "Body", 685800, 1371600, 10820400, 4800600, body);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="${COLOR.cream}"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapes}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function presentationXml(count: number): string {
  const ids = Array.from({ length: count }, (_, i) => {
    const rId = i + 2; // rId1 = slideMaster
    return `<p:sldId id="${256 + i}" r:id="rId${rId}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(count: number): string {
  const slideRels = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`;
}

function contentTypes(count: number): string {
  const slides = Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${slides}
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Aether">
  <a:themeElements>
    <a:clrScheme name="Aether">
      <a:dk1><a:srgbClr val="${COLOR.ink}"/></a:dk1>
      <a:lt1><a:srgbClr val="${COLOR.cream}"/></a:lt1>
      <a:dk2><a:srgbClr val="4A403C"/></a:dk2>
      <a:lt2><a:srgbClr val="${COLOR.rule}"/></a:lt2>
      <a:accent1><a:srgbClr val="${COLOR.terracotta}"/></a:accent1>
      <a:accent2><a:srgbClr val="8C4A38"/></a:accent2>
      <a:accent3><a:srgbClr val="6B5E57"/></a:accent3>
      <a:accent4><a:srgbClr val="C4A574"/></a:accent4>
      <a:accent5><a:srgbClr val="3D5A4C"/></a:accent5>
      <a:accent6><a:srgbClr val="5C6B73"/></a:accent6>
      <a:hlink><a:srgbClr val="${COLOR.terracotta}"/></a:hlink>
      <a:folHlink><a:srgbClr val="8C4A38"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Aether">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Aether">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="${COLOR.cream}"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`;

function coreXml(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>Aether</dc:creator>
  <cp:lastModifiedBy>Aether</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(count: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Aether</Application>
  <Slides>${count}</Slides>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
</Properties>`;
}

export function normalizePresentationInput(
  input: PresentationInput,
): PresentationSlide[] {
  const slides = (input.slides ?? [])
    .map((slide) => ({
      title: clip(slide.title || "", 120),
      bullets: (slide.bullets ?? []).map((b) => clip(b)).filter(Boolean),
      notes: slide.notes ? clip(slide.notes, 400) : undefined,
      layout: slide.layout,
    }))
    .filter((s) => s.title || (s.bullets && s.bullets.length > 0))
    .slice(0, MAX_SLIDES);
  if (slides.length > 0) return slides;
  const fallbackTitle = clip(input.title, 120) || "Presentation";
  return [
    {
      title: fallbackTitle,
      bullets: input.subtitle ? [clip(input.subtitle)] : [],
      layout: "title",
    },
  ];
}

export async function buildPresentationPptx(
  input: PresentationInput,
): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
  slideCount: number;
  dataUrl: string;
}> {
  const title = clip(input.title, 120) || "Presentation";
  const slides = normalizePresentationInput({ ...input, title });
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes(slides.length));
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("docProps/core.xml", coreXml(title));
  zip.file("docProps/app.xml", appXml(slides.length));
  zip.file("ppt/presentation.xml", presentationXml(slides.length));
  zip.file("ppt/_rels/presentation.xml.rels", presentationRels(slides.length));
  zip.file("ppt/theme/theme1.xml", THEME_XML);
  zip.file("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", MASTER_RELS);
  zip.file("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", LAYOUT_RELS);
  slides.forEach((slide, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(slide, i));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, SLIDE_RELS);
  });
  const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const filename = slugFilename(title, "pptx");
  return {
    buffer,
    filename,
    mime: PPTX_MIME,
    slideCount: slides.length,
    dataUrl: bufferToDataUrl(buffer, PPTX_MIME),
  };
}
