import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FFMPEG_MISSING_MESSAGE,
  annotateWorkspaceCommandResult,
  buildFfmpegCommand,
} from "./workspace-media";

describe("ffmpeg workspace skill", () => {
  it("builds trim / concat / gif / burn-subs commands from workspace paths", () => {
    assert.match(
      buildFfmpegCommand({
        action: "trim",
        inputPath: "clip.mp4",
        outputPath: "out.mp4",
        start: "00:00:02",
        duration: "5",
      }).command,
      /ffmpeg .*clip\.mp4/,
    );
    assert.match(
      buildFfmpegCommand({
        action: "concat",
        inputPath: "a.mp4",
        extraInputs: ["b.mp4"],
        outputPath: "joined.mp4",
      }).command,
      /concat/,
    );
    assert.match(
      buildFfmpegCommand({
        action: "gif",
        inputPath: "clip.mp4",
        outputPath: "clip.gif",
      }).command,
      /gif/,
    );
    assert.match(
      buildFfmpegCommand({
        action: "burn_subs",
        inputPath: "clip.mp4",
        subsPath: "subs.srt",
        outputPath: "captioned.mp4",
      }).command,
      /subtitles/,
    );
  });

  it("rejects path traversal and shell metacharacters", () => {
    assert.equal(
      buildFfmpegCommand({
        action: "trim",
        inputPath: "../secret.mp4",
        outputPath: "out.mp4",
      }).ok,
      false,
    );
    assert.equal(
      buildFfmpegCommand({
        action: "gif",
        inputPath: "clip.mp4; rm -rf /",
        outputPath: "x.gif",
      }).ok,
      false,
    );
  });

  it("reports ffmpeg MISSING without vendor names", () => {
    const annotated = annotateWorkspaceCommandResult({
      command: "ffmpeg -i clip.mp4 out.gif",
      exitCode: 127,
      stdout: "",
      stderr: "bash: ffmpeg: command not found",
    });
    assert.equal(annotated.ok, false);
    assert.equal(annotated.missing, "ffmpeg");
    assert.equal(annotated.error, FFMPEG_MISSING_MESSAGE);
    assert.match(String(annotated.error), /MISSING/);
    assert.doesNotMatch(String(annotated.error), /Vercel|Sandbox|FFmpeg\.org/i);
  });

  it("does not treat a successful echo as a missing binary", () => {
    const annotated = annotateWorkspaceCommandResult({
      command: "echo ffmpeg",
      exitCode: 0,
      stdout: "ffmpeg\n",
      stderr: "",
    });
    assert.equal(annotated.ok, true);
    assert.equal(annotated.missing, undefined);
  });
});
