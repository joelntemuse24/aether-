import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GUEST_FILE_HINT,
  artifactDownloadPath,
  fileToolResult,
} from "./file-result";

describe("fileToolResult", () => {
  const dataUrl = "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEs=";

  it("returns a download path and omits the data URL when the file is persisted", () => {
    const result = fileToolResult({
      title: "Dublin junior investment-ops",
      filename: "dublin-junior-investment-ops.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: 23000,
      dataUrl,
      saved: { id: "art-1", persisted: true },
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, "file");
    assert.equal(result.persisted, true);
    assert.equal(result.id, "art-1");
    assert.equal(result.downloadPath, artifactDownloadPath("art-1"));
    assert.equal(result.downloadPath, "/api/artifacts/art-1/download");
    assert.equal(result.content, undefined);
    assert.equal(result.hint, undefined);
  });

  it("keeps bytes in-thread for guests and does not claim a cloud attachment", () => {
    const result = fileToolResult({
      title: "Dublin junior investment-ops",
      filename: "dublin.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: 23000,
      dataUrl,
      saved: { persisted: false },
    });
    assert.equal(result.ok, true);
    assert.equal(result.persisted, false);
    assert.equal(result.downloadPath, undefined);
    assert.equal(result.content, dataUrl);
    assert.equal(result.hint, GUEST_FILE_HINT);
    assert.doesNotMatch(JSON.stringify(result), /attached/i);
  });
});
