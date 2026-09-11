import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTIFACT_KINDS,
  CANONICAL_ARTIFACT_KINDS,
  downloadExtension,
  downloadMime,
  isFileArtifactKind,
  isLivePreviewKind,
  isTextArtifactKind,
  normalizeArtifactKind,
  parseCsv,
  previewMode,
} from "./kinds";

describe("artifact kinds", () => {
  it("includes Claude-parity kinds plus back-compat aliases", () => {
    for (const kind of [
      "markdown",
      "code",
      "html",
      "react",
      "svg",
      "csv",
      "image",
      "pptx",
      "xlsx",
      "docx",
      "pdf",
      "document",
      "data",
      "file",
    ]) {
      assert.ok((ARTIFACT_KINDS as readonly string[]).includes(kind), kind);
    }
    assert.ok(CANONICAL_ARTIFACT_KINDS.includes("html"));
    assert.ok(CANONICAL_ARTIFACT_KINDS.includes("react"));
  });

  it("normalizes aliases and office filenames", () => {
    assert.equal(normalizeArtifactKind("document"), "markdown");
    assert.equal(normalizeArtifactKind("data"), "csv");
    assert.equal(normalizeArtifactKind("HTML"), "html");
    assert.equal(normalizeArtifactKind("file", { language: "brief.docx" }), "docx");
    assert.equal(normalizeArtifactKind("file", { filename: "deck.pptx" }), "pptx");
    assert.equal(normalizeArtifactKind("file", { mime: "application/pdf" }), "pdf");
    assert.equal(normalizeArtifactKind("file"), "file");
  });

  it("classifies live preview, text, and file kinds", () => {
    assert.equal(isLivePreviewKind("html"), true);
    assert.equal(isLivePreviewKind("react"), true);
    assert.equal(isLivePreviewKind("code", "tsx"), true);
    assert.equal(isLivePreviewKind("code", "python"), false);
    assert.equal(isTextArtifactKind("html"), true);
    assert.equal(isTextArtifactKind("pptx"), false);
    assert.equal(isFileArtifactKind("pdf"), true);
    assert.equal(isFileArtifactKind("file"), true);
    assert.equal(isFileArtifactKind("html"), false);
    assert.equal(previewMode("html"), "live");
    assert.equal(previewMode("markdown"), "document");
    assert.equal(previewMode("csv"), "table");
    assert.equal(previewMode("docx"), "file");
  });

  it("downloads HTML/React as source files", () => {
    assert.equal(downloadExtension("html"), "html");
    assert.equal(downloadMime("html"), "text/html");
    assert.equal(downloadExtension("react"), "jsx");
    assert.equal(downloadMime("react"), "text/javascript");
    assert.equal(downloadExtension("code", "ts"), "ts");
  });

  it("parses a headered CSV into rows", () => {
    const parsed = parseCsv("item,amount\nrent,1200\nfood,80");
    assert.ok(parsed);
    assert.deepEqual(parsed.columns, ["item", "amount"]);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.item, "rent");
    assert.equal(parsed.rows[1]?.amount, "80");
  });
});
