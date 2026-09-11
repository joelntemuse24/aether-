import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDriveMultipart,
  isAllowedDriveUploadName,
  resolveDriveUploadMime,
} from "./drive-upload";

describe("isAllowedDriveUploadName", () => {
  it("accepts generated office files and common attachments", () => {
    for (const name of [
      "Q3-deck.pptx",
      "costs.xlsx",
      "memo.pdf",
      "brief.docx",
      "chart.png",
      "notes.md",
    ]) {
      assert.equal(isAllowedDriveUploadName(name), true, name);
    }
  });

  it("rejects path tricks and unknown types", () => {
    assert.equal(isAllowedDriveUploadName("../secret.exe"), false);
    assert.equal(isAllowedDriveUploadName("no-extension"), false);
    assert.equal(isAllowedDriveUploadName(""), false);
  });
});

describe("resolveDriveUploadMime / buildDriveMultipart", () => {
  it("picks office mime types and builds a binary multipart body", () => {
    assert.match(resolveDriveUploadMime("deck.pptx"), /presentationml/);
    const buf = Buffer.from("PK\x03\x04fake-pptx");
    const part = buildDriveMultipart({
      filename: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: buf,
      folderId: "folder-1",
    });
    assert.match(part.contentType, /multipart\/related/);
    assert.match(part.body.toString("utf8"), /"name":"deck.pptx"/);
    assert.match(part.body.toString("utf8"), /folder-1/);
    assert.ok(part.body.includes(buf));
  });
});
