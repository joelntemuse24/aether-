import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumeAetherToolFences,
  formatAetherToolResultsForModel,
  parseAetherToolFencePayload,
} from "./aether-tool-fence";

describe("aether tool fence parser", () => {
  it("extracts a complete fence and strips it from visible text", () => {
    const { visible, calls, rest } = consumeAetherToolFences(
      'Before\n[[aether_tool]]\n{"name":"memory_search","arguments":{"query":"voice"}}\n[[/aether_tool]]\nAfter',
    );
    assert.equal(visible, "Before\n\nAfter");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "memory_search");
    assert.deepEqual(calls[0].arguments, { query: "voice" });
    assert.equal(rest, "");
  });

  it("holds a partial fence until it closes", () => {
    const first = consumeAetherToolFences('Hello [[aether_tool]]\n{"name":"create_artifact"');
    assert.equal(first.visible, "Hello ");
    assert.equal(first.calls.length, 0);
    assert.match(first.rest, /\[\[aether_tool\]\]/);

    const second = consumeAetherToolFences(
      first.rest + ',"arguments":{"kind":"document","title":"Note","content":"Hi"}}\n[[/aether_tool]]!',
    );
    assert.equal(second.visible, "!");
    assert.equal(second.calls.length, 1);
    assert.equal(second.calls[0].name, "create_artifact");
  });

  it("rejects invalid payloads", () => {
    assert.equal(parseAetherToolFencePayload("not-json"), null);
    assert.equal(parseAetherToolFencePayload('{"arguments":{}}'), null);
  });

  it("formats executed results for the follow-up turn", () => {
    const text = formatAetherToolResultsForModel([
      {
        name: "memory_search",
        output: { ok: true, results: [{ title: "Voice" }] },
      },
    ]);
    assert.match(text, /memory_search/);
    assert.match(text, /Voice/);
    assert.doesNotMatch(text, /Hermes/);
  });
});
