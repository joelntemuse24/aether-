import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChatResponseBody } from "./stream";

describe("probe stream parser", () => {
  it("joins UIMessage text-delta frames into visible prose", () => {
    const body = [
      'data: {"type":"start","messageId":"m1"}',
      'data: {"type":"text-delta","id":"t1","delta":"Hello "}',
      'data: {"type":"text-delta","id":"t1","delta":"Dublin."}',
      'data: {"type":"finish"}',
      "",
    ].join("\n\n");
    const parsed = parseChatResponseBody(body);
    assert.equal(parsed.visibleText, "Hello Dublin.");
    assert.equal(parsed.finished, true);
    assert.ok(parsed.eventTypes.includes("text-delta"));
  });

  it("keeps raw DSML in rawText so detectors can see it", () => {
    const dsml = '<|DSML| tool_search query="current time Dublin Ireland">';
    const body = `data: {"type":"text-delta","delta":${JSON.stringify(dsml)}}\n\n`;
    const parsed = parseChatResponseBody(body);
    assert.match(parsed.rawText, /DSML/);
    assert.equal(parsed.visibleText.includes("DSML"), false);
  });

  it("keeps stream error frames out of visible prose", () => {
    const body = [
      'data: {"type":"error","errorText":"Missing Authentication header"}',
      'data: {"type":"finish"}',
      "",
    ].join("\n\n");
    const parsed = parseChatResponseBody(body);
    assert.equal(parsed.visibleText, "");
    assert.equal(parsed.errorText, "Missing Authentication header");
    assert.equal(parsed.finished, true);
  });

  it("parses a JSON error body from /api/chat", () => {
    const parsed = parseChatResponseBody(
      JSON.stringify({ error: "Hosted chat is not configured." }),
    );
    assert.equal(parsed.errorText, "Hosted chat is not configured.");
  });
});
