import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLAYBACK_UNAVAILABLE_MESSAGE,
  plainTextForSpeech,
  plainTextFromMessage,
  speechSynthesisSupported,
  utteranceStarted,
} from "./tts";

describe("TTS playback helpers", () => {
  it("strips markdown so answers read naturally", () => {
    const spoken = plainTextForSpeech(
      "Hello **world** — see [1](https://example.com) and `code`.",
    );
    assert.match(spoken, /Hello world/);
    assert.doesNotMatch(spoken, /\*\*|`|https:\/\//);
    assert.doesNotMatch(spoken, /OpenRouter|Buzz|Trigger/i);
  });

  it("returns empty for blank or tool-only payloads", () => {
    assert.equal(plainTextForSpeech("   "), "");
    assert.equal(plainTextForSpeech(""), "");
  });

  it("reads assistant-ui content arrays as well as parts", () => {
    assert.match(
      plainTextFromMessage({
        content: [{ type: "text", text: "Overnight markets were quiet." }],
      }),
      /Overnight markets/,
    );
    assert.match(
      plainTextFromMessage({
        parts: [{ type: "text", text: "Hello **there**" }],
      }),
      /Hello there/,
    );
    const readonlyParts = [
      { type: "text", text: "Readonly **parts**" },
    ] as const;
    assert.match(plainTextFromMessage({ parts: readonlyParts }), /Readonly parts/);
  });

  it("is honest when speech synthesis is missing", () => {
    assert.equal(speechSynthesisSupported(), false);
    assert.match(PLAYBACK_UNAVAILABLE_MESSAGE, /isn.t available/i);
    assert.doesNotMatch(PLAYBACK_UNAVAILABLE_MESSAGE, /Google|Eleven|OpenAI|vendor/i);
  });

  it("treats a silent speech engine as not started", () => {
    assert.equal(utteranceStarted(null), false);
    assert.equal(
      utteranceStarted({ speaking: false, pending: false, cancel() {}, speak() {} }),
      false,
    );
    assert.equal(
      utteranceStarted({ speaking: false, pending: true, cancel() {}, speak() {} }),
      true,
    );
  });
});
