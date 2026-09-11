import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  CLOUD_PERSIST_MIN_GAP_MS,
  createLatestWriteGate,
  fingerprintFormatRepo,
  shouldHydrateThreadMessages,
  shouldPersistMessagesImmediately,
} from "./conversation-persist";

describe("conversation persist policy", () => {
  it("does not PUT immediately on every streamed tool-complete token", () => {
    assert.equal(
      shouldPersistMessagesImmediately({
        status: "streaming",
        lastRole: "assistant",
      }),
      false,
    );
    assert.equal(
      shouldPersistMessagesImmediately({
        status: "submitted",
        lastRole: "assistant",
      }),
      false,
    );
  });

  it("flushes immediately for a new user message and when the turn ends", () => {
    assert.equal(
      shouldPersistMessagesImmediately({
        status: "streaming",
        lastRole: "user",
      }),
      true,
    );
    assert.equal(
      shouldPersistMessagesImmediately({ status: "ready", lastRole: "assistant" }),
      true,
    );
    assert.equal(
      shouldPersistMessagesImmediately({ status: "error", lastRole: "assistant" }),
      true,
    );
  });

  it("does not hydrate a live stream from a cloud GET", () => {
    assert.equal(
      shouldHydrateThreadMessages({ status: "streaming", switched: false }),
      false,
    );
    assert.equal(
      shouldHydrateThreadMessages({ status: "submitted", switched: false }),
      false,
    );
    assert.equal(
      shouldHydrateThreadMessages({ status: "ready", switched: false }),
      true,
    );
    assert.equal(
      shouldHydrateThreadMessages({ status: "streaming", switched: true }),
      true,
    );
  });
});

describe("latest-wins cloud persist gate", () => {
  it("collapses a burst of writes into one in-flight PUT of the latest repo", async () => {
    const writes: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = createLatestWriteGate<{ n: number }>((v) => String(v.n), {
      gapMs: 0,
    });

    const first = gate.enqueue("t1", { n: 1 }, async (_id, value) => {
      writes.push(`start:${value.n}`);
      await blocked;
      writes.push(`end:${value.n}`);
    });

    const rest = [
      gate.enqueue("t1", { n: 2 }, async (_id, value) => {
        writes.push(`start:${value.n}`);
      }),
      gate.enqueue("t1", { n: 3 }, async (_id, value) => {
        writes.push(`start:${value.n}`);
      }),
      gate.enqueue("t1", { n: 4 }, async (_id, value) => {
        writes.push(`start:${value.n}`);
      }),
    ];

    assert.equal(gate.inflightCount(), 1);
    assert.equal(gate.pendingCount("t1"), 1);

    release();
    await Promise.all([first, ...rest]);

    assert.equal(writes[0], "start:1");
    assert.ok(writes.includes("start:4"));
    assert.equal(writes.some((w) => w === "start:2" || w === "start:3"), false);

    await gate.enqueue("t1", { n: 5 }, async (_id, value) => {
      writes.push(`start:${value.n}`);
    });
    assert.ok(writes.includes("start:5"));
    gate.reset();
  });

  it("skips a PUT when the fingerprint matches the last successful write", async () => {
    let calls = 0;
    const gate = createLatestWriteGate<{ n: number }>((v) => String(v.n), {
      gapMs: 0,
    });
    const write = async () => {
      calls += 1;
    };
    await gate.enqueue("t1", { n: 1 }, write);
    await gate.enqueue("t1", { n: 1 }, write);
    assert.equal(calls, 1);
    gate.reset();
  });

  it("fingerprints repos by length and tail, not the full JSON body", () => {
    const print = fingerprintFormatRepo({
      headId: "a2",
      entries: [
        { id: "a1", parent_id: null, format: "ai-sdk/v6", content: { role: "user" } },
        {
          id: "a2",
          parent_id: "a1",
          format: "ai-sdk/v6",
          content: { role: "assistant", parts: [] },
        },
      ],
    });
    assert.match(print, /^2:a2:a2:/);
    assert.ok(CLOUD_PERSIST_MIN_GAP_MS >= 1_000);
  });
});

describe("runtime persist wiring", () => {
  it("does not immediate-persist on hasCompletedToolResult during a stream", () => {
    const runtime = readFileSync(
      new URL("../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    assert.match(runtime, /shouldPersistMessagesImmediately/);
    assert.match(runtime, /shouldHydrateThreadMessages/);
    const persistEffect = runtime.slice(
      runtime.indexOf("Persist the full linear transcript"),
      runtime.indexOf("Flush on tab close"),
    );
    assert.doesNotMatch(persistEffect, /hasCompletedToolResult\(last\)/);
  });

  it("coalesces cloud PUTs in the shared client, not per caller", () => {
    const client = readFileSync(
      new URL("./conversations/cloud-client.ts", import.meta.url),
      "utf8",
    );
    assert.match(client, /createLatestWriteGate/);
    assert.match(client, /cloudPersistGate/);
  });
});
