import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPreviewDoc, type PreviewTheme } from "./preview-doc";

const THEME: PreviewTheme = {
  canvas: "#faf7f1",
  elevated: "#f4efe6",
  text: "#1a1714",
  textSecondary: "#2e2a24",
  muted: "#6b6458",
  accent: "#d4734f",
  border: "rgba(0,0,0,0.08)",
  codeBg: "#f3eee3",
};

describe("artifact preview doc", () => {
  it("sizes a viewBox-only svg so the centered preview is not blank", () => {
    const svg =
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="40" fill="#d4734f"/></svg>';
    const doc = buildPreviewDoc("svg", "svg", svg, THEME);
    assert.match(doc, /svg\{width:100%;height:auto;max-width:100%;max-height:100%\}/);
    assert.match(doc, /display:flex;align-items:center;justify-content:center/);
    assert.equal(doc.includes(svg), true);
  });

  it("wraps a bare html snippet in a full document", () => {
    const doc = buildPreviewDoc("html", "html", "<p>Hello</p>", THEME);
    assert.match(doc, /^<!doctype html>/);
    assert.equal(doc.includes("<p>Hello</p>"), true);
  });

  it("leaves a complete html document untouched", () => {
    const page = "<!doctype html><html><body><p>Hello</p></body></html>";
    assert.equal(buildPreviewDoc("html", "html", page, THEME), page);
  });
});
