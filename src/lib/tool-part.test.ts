import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { safeStringifyToolResult, toToolPartLike } from "./tool-part";

describe("toToolPartLike — persisted failed tools never throw", () => {
  it("maps AI SDK tool-execute_python error parts", () => {
    const part = toToolPartLike({
      type: "tool-execute_python",
      toolCallId: "py-1",
      state: "output-error",
      input: { code: "print(1)" },
      output: { ok: false, error: "boom" },
      errorText: "boom",
    });
    assert.ok(part);
    assert.equal(part?.toolName, "execute_python");
    assert.equal(part?.isError, true);
    assert.deepEqual(part?.args, { code: "print(1)" });
    assert.deepEqual(part?.result, { ok: false, error: "boom" });
  });

  it("returns null for text and empty junk", () => {
    assert.equal(toToolPartLike(null), null);
    assert.equal(toToolPartLike({ type: "text", text: "hi" }), null);
    assert.equal(toToolPartLike(undefined), null);
  });

  it("stringifies circular tool results without throwing", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    assert.match(safeStringifyToolResult(circular), /unavailable|result/i);
  });
});

describe("failed-tool render wiring", () => {
  it("thread maps tool-* parts and wraps the assistant body", () => {
    const thread = readFileSync(
      new URL("../components/assistant-ui/thread.tsx", import.meta.url),
      "utf8",
    );
    assert.match(thread, /toToolPartLike/);
    assert.match(thread, /ChatRenderErrorBoundary/);
    const strip = readFileSync(
      new URL(
        "../components/assistant-ui/agent-status-strip.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(strip, /shouldShowComposerActivity/);
    assert.match(strip, /sourceChipLabel/);
    const appError = readFileSync(
      new URL("../app/error.tsx", import.meta.url),
      "utf8",
    );
    assert.match(appError, /Couldn.t load this chat|try again/i);
    assert.doesNotMatch(appError, /OpenRouter|Buzz|Vercel/);
  });
});
