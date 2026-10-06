import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fitArtifactContent } from "./content-budget";
import { fileDownloadHeaders } from "./download";
import { classifyImageContent, imageToolResult } from "./image-result";
import { artifactHref, imageFileExtension, isPaintableImageContent } from "./image-src";
import { isBinaryArtifactKind } from "./kinds";

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("fitArtifactContent", () => {
  it("keeps an image data URL between 500k and 4M intact", () => {
    const big = `data:image/png;base64,${"A".repeat(900_000)}`;
    assert.equal(fitArtifactContent("image", big), big);
    assert.equal(fitArtifactContent("image", big).length, big.length);
  });

  it("throws for an image or file over 4M instead of slicing", () => {
    const huge = `data:image/png;base64,${"A".repeat(4_000_001)}`;
    assert.throws(() => fitArtifactContent("image", huge), /too large/i);
    assert.throws(() => fitArtifactContent("file", huge), /too large/i);
  });

  it("still slices text kinds at 500k", () => {
    assert.equal(fitArtifactContent("markdown", "x".repeat(600_000)).length, 500_000);
    assert.equal(fitArtifactContent("html", "<p>ok</p>"), "<p>ok</p>");
  });

  it("is what saveArtifact uses", () => {
    assert.match(read("./store.ts"), /fitArtifactContent\(kind, input\.content\)/);
  });
});

describe("imageToolResult", () => {
  it("returns downloadPath and omits content when persisted", () => {
    const result = imageToolResult({
      title: "Chart",
      content: DATA_URL,
      saved: { id: "img-1", persisted: true },
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "image");
    assert.equal(result.persisted, true);
    assert.equal(result.id, "img-1");
    assert.equal(result.downloadPath, "/api/artifacts/img-1/download");
    assert.equal(result.mime, "image/png");
    assert.ok((result.bytes ?? 0) > 0);
    assert.equal(result.content, undefined);
  });

  it("keeps the data URL for guests", () => {
    const result = imageToolResult({
      title: "Chart",
      content: DATA_URL,
      saved: { persisted: false },
    });
    assert.equal(result.persisted, false);
    assert.equal(result.content, DATA_URL);
    assert.equal(result.downloadPath, undefined);
    assert.ok(result.hint);
  });

  it("keeps a persisted https URL as content", () => {
    const result = imageToolResult({
      title: "Chart",
      content: "https://example.com/c.png",
      saved: { id: "img-2", persisted: true },
    });
    assert.equal(result.content, "https://example.com/c.png");
    assert.equal(result.downloadPath, undefined);
    assert.equal(result.id, "img-2");
  });
});

describe("classifyImageContent", () => {
  it("classifies data URLs, https URLs, base64, and paths", () => {
    assert.equal(classifyImageContent(DATA_URL).type, "data-url");
    assert.equal(classifyImageContent("https://x.test/a.png").type, "url");
    assert.deepEqual(classifyImageContent("/home/user/chart.png"), {
      type: "path",
      path: "/home/user/chart.png",
    });
    assert.equal(classifyImageContent("chart.JPG").type, "path");
    const b64 = classifyImageContent(`iVBORw0KGgo${"A".repeat(200)}`);
    assert.equal(b64.type, "base64");
    const jpeg = classifyImageContent(`/9j/${"A".repeat(200)}`);
    assert.equal(jpeg.type, "base64");
    assert.match((jpeg as { dataUrl: string }).dataUrl, /^data:image\/jpeg;base64,/);
  });

  it("rejects prose and non-image data URLs", () => {
    assert.equal(classifyImageContent("a nice chart of yields").type, "unknown");
    assert.equal(classifyImageContent("data:text/plain;base64,aGk=").type, "unknown");
    assert.equal(classifyImageContent("http://x.test/a.png").type, "unknown");
    assert.equal(classifyImageContent("").type, "unknown");
  });
});

describe("artifactHref", () => {
  it("prefers downloadPath, then the API path, then content", () => {
    assert.equal(
      artifactHref({ downloadPath: "/api/artifacts/a/download", content: "x" }),
      "/api/artifacts/a/download",
    );
    assert.equal(
      artifactHref({ id: "a b", persisted: true, content: "" }),
      "/api/artifacts/a%20b/download",
    );
    assert.equal(artifactHref({ persisted: false, id: "a", content: DATA_URL }), DATA_URL);
    assert.equal(artifactHref({ content: "" }), null);
  });

  it("uses a stored https URL directly", () => {
    assert.equal(
      artifactHref({ id: "a", persisted: true, content: "https://x.test/a.png" }),
      "https://x.test/a.png",
    );
  });

  it("flags truncated or non-image content as not paintable", () => {
    assert.equal(isPaintableImageContent(DATA_URL), true);
    assert.equal(isPaintableImageContent(`${DATA_URL}[truncated]`), false);
    assert.equal(isPaintableImageContent("/home/user/chart.png"), false);
    assert.equal(isPaintableImageContent(undefined), false);
  });

  it("names downloads from mime", () => {
    assert.equal(imageFileExtension("image/jpeg"), "jpg");
    assert.equal(imageFileExtension(undefined, "data:image/webp;base64,AA"), "webp");
    assert.equal(imageFileExtension(), "png");
  });
});

describe("image download headers", () => {
  it("serves images inline and other files as attachments", () => {
    assert.match(fileDownloadHeaders("c.png", "image/png", 3)["Content-Disposition"], /^inline;/);
    assert.match(
      fileDownloadHeaders("d.pptx", "application/vnd.ms-powerpoint", 3)["Content-Disposition"],
      /^attachment;/,
    );
  });

  it("classifies binary kinds", () => {
    assert.equal(isBinaryArtifactKind("image"), true);
    assert.equal(isBinaryArtifactKind("file"), true);
    assert.equal(isBinaryArtifactKind("pptx"), true);
    assert.equal(isBinaryArtifactKind("html"), false);
  });
});

describe("image preview wiring", () => {
  it("panel resolves image src and download through artifactHref", () => {
    const panel = read("../../components/layout/artifact-panel.tsx");
    const img = panel.slice(panel.indexOf("<img"), panel.indexOf("<img") + 400);
    assert.match(img, /artifactHref\(/);
    assert.match(img, /downloadPath: artifact\.downloadPath/);
    assert.doesNotMatch(img, /src=\{content\}/);
    const download = panel.slice(panel.indexOf("const onDownload"), panel.indexOf("const onExportPdf"));
    assert.match(download, /artifactHref\(/);
  });

  it("tool-ui treats downloadPath as a usable image and keeps the soft-fail", () => {
    const toolUi = read("../../components/assistant-ui/tool-ui.tsx");
    assert.match(toolUi, /isImageKind && !!bodyTitle && !!\(bodyContent \|\| downloadPath\)/);
    assert.match(toolUi, /const complete =\s+part\.result !== undefined/);
    assert.doesNotMatch(toolUi.slice(toolUi.indexOf("const complete ="), toolUi.indexOf("const complete =") + 200), /isError|ok === false/);
  });

  it("reopen sets downloadPath for saved binary artifacts", () => {
    const provider = read("../../providers/artifact-provider.tsx");
    assert.match(provider, /downloadPath: binary \? artifactDownloadPath\(a\.id\)/);
  });

  it("download route builds headers through fileDownloadHeaders", () => {
    assert.match(
      read("../../app/api/artifacts/[id]/download/route.ts"),
      /fileDownloadHeaders\(filename, parsed\.mime/,
    );
  });
});
