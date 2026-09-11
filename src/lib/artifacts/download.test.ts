import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildPresentationPptx } from "@/lib/office/build-pptx";
import {
  artifactDownloadPath,
  bytesFromArtifactContent,
  downloadFilename,
  fileDownloadHeaders,
} from "./download";

describe("artifact download helpers", () => {
  it("builds the signed-in download path", () => {
    assert.equal(
      artifactDownloadPath("art-9"),
      "/api/artifacts/art-9/download",
    );
  });

  it("round-trips a pptx data URL into ZIP bytes with [Content_Types].xml", async () => {
    const deck = await buildPresentationPptx({
      title: "Dublin junior investment-ops",
      slides: [
        { title: "Market", bullets: ["Junior ops roles remain concentrated in IFSC"] },
      ],
    });
    const parsed = bytesFromArtifactContent(deck.dataUrl);
    assert.ok(parsed);
    assert.equal(parsed?.buffer.subarray(0, 2).toString(), "PK");
    const zip = await JSZip.loadAsync(parsed!.buffer);
    assert.ok(zip.file("[Content_Types].xml"));
    const headers = fileDownloadHeaders(
      downloadFilename({ title: deck.filename, language: deck.filename, mime: deck.mime }),
      deck.mime,
      parsed!.buffer.byteLength,
    );
    assert.equal(headers["Content-Type"], deck.mime);
    assert.match(headers["Content-Disposition"], /attachment/);
    assert.match(headers["Content-Disposition"], /\.pptx/);
  });

  it("names downloadable office files from language or mime", () => {
    assert.match(
      downloadFilename({
        title: "q3-costs.xlsx",
        language: "q3-costs.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      /\.xlsx$/,
    );
    assert.match(
      downloadFilename({
        title: "memo.docx",
        language: "memo.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      /\.docx$/,
    );
    assert.match(
      downloadFilename({
        title: "memo.pdf",
        language: "memo.pdf",
        mime: "application/pdf",
      }),
      /\.pdf$/,
    );
  });

  it("returns null for empty artifact content instead of a fake file", () => {
    assert.equal(bytesFromArtifactContent(""), null);
    assert.equal(bytesFromArtifactContent("   "), null);
  });
});

describe("download route wiring", () => {
  it("exposes GET /api/artifacts/:id/download", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../app/api/artifacts/[id]/download/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /export async function GET/);
    assert.match(src, /requireCloudUser/);
    assert.match(src, /bytesFromArtifactContent/);
    assert.match(src, /fileDownloadHeaders/);
  });
});
