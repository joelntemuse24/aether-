import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { TOOL_NAMES } from "./tools";
import {
  mergeStoredThreadWithIncoming,
  resolveChatMessages,
} from "./chat-history-merge";
import { prepareOutgoingChatMessages } from "./chat-transcript";
import { ensureDurableToolStubs } from "./chat-tool-transcript";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantText(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function toolPart(input: {
  name: string;
  toolCallId: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}): Record<string, unknown> {
  return {
    type: `tool-${input.name}`,
    toolCallId: input.toolCallId,
    state: input.state ?? "output-available",
    input: input.input ?? {},
    output: input.output,
  };
}

function assistantWithSearch(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: "I searched, then noted your number." },
      toolPart({
        name: TOOL_NAMES.webSearch,
        toolCallId: "search-1",
        input: { query: "anything" },
        output: {
          ok: true,
          query: "anything",
          results: [{ title: "Example", snippet: "A hit", url: "https://example.com" }],
        },
      }),
    ],
  } as UIMessage;
}

function assistantWithArtifact(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: "Drafted the brief." },
      toolPart({
        name: TOOL_NAMES.createArtifact,
        toolCallId: "art-1",
        input: {
          kind: "document",
          title: "Brief on 17",
          content: "# Favourite number\n\n17",
        },
        output: {
          ok: true,
          kind: "document",
          title: "Brief on 17",
          id: "art-local-1",
          content: "# Favourite number\n\n17",
        },
      }),
    ],
  } as UIMessage;
}

function installLocalStorage() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: { localStorage: typeof localStorage; dispatchEvent: (event?: Event) => boolean };
  };
  const previous = globalWithWindow.window;
  globalWithWindow.window = {
    localStorage,
    dispatchEvent: () => true,
  };
  return () => {
    if (previous === undefined) {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = previous;
    }
  };
}

function hasToolNamed(messages: UIMessage[], name: string): boolean {
  return messages.some((message) =>
    (message.parts ?? []).some(
      (part) => part.type === `tool-${name}` && "output" in part && part.output != null,
    ),
  );
}

function threadHasText(messages: UIMessage[], needle: string): boolean {
  return messages.some((message) =>
    (message.parts ?? []).some(
      (part) => part.type === "text" && "text" in part && part.text.includes(needle),
    ),
  );
}

describe("durable tool transcript", () => {
  it("keeps a completed web_search stub when incoming same-id assistant is text-only", () => {
    const stored = [
      user("u1", "My favourite number is 17."),
      assistantWithSearch("a1"),
    ];
    const incoming = [
      user("u1", "My favourite number is 17."),
      assistantText("a1", "I searched, then noted your number."),
      user("u2", "Search for anything and then recall the number."),
    ];
    const outgoing = prepareOutgoingChatMessages({ stored, live: incoming });
    assert.equal(threadHasText(outgoing, "17"), true);
    assert.equal(hasToolNamed(outgoing, TOOL_NAMES.webSearch), true);
    const a1 = outgoing.find((m) => m.id === "a1");
    assert.ok(a1);
    const search = a1.parts.find((p) => p.type === `tool-${TOOL_NAMES.webSearch}`);
    assert.ok(search && "output" in search && search.output);
  });

  it("server merge also keeps stored tool stubs over a stripped incoming copy", () => {
    const stored = [
      user("u1", "My favourite number is 17."),
      assistantWithSearch("a1"),
    ];
    const incoming = [
      user("u1", "My favourite number is 17."),
      assistantText("a1", "I searched, then noted your number."),
      user("u2", "What number?"),
    ];
    const merged = resolveChatMessages({
      conversationId: "thread-17",
      incoming,
      stored,
    });
    assert.equal(threadHasText(merged, "17"), true);
    assert.equal(hasToolNamed(merged, TOOL_NAMES.webSearch), true);
  });

  it("promotes an incomplete tool call to a durable stub the next turn can see", () => {
    const incomplete = {
      id: "a-stream",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "Searching…" },
        toolPart({
          name: TOOL_NAMES.fetchUrl,
          toolCallId: "fetch-1",
          state: "input-streaming",
          input: { url: "https://example.com" },
        }),
      ],
    } as UIMessage;
    const durable = ensureDurableToolStubs([incomplete]);
    const fetch = durable[0]?.parts.find((p) => p.type === `tool-${TOOL_NAMES.fetchUrl}`);
    assert.ok(fetch);
    assert.equal(
      fetch && "state" in fetch ? fetch.state : "",
      "output-available",
    );
    assert.ok(fetch && "output" in fetch && fetch.output != null);
    assert.ok(fetch && "toolCallId" in fetch && fetch.toolCallId === "fetch-1");
  });

  it("convertToModelMessages sees tool-call + result after stubs are made durable", async () => {
    const messages = ensureDurableToolStubs([
      user("u1", "My favourite number is 17."),
      assistantWithSearch("a1"),
      user("u2", "What number?"),
    ]);
    const model = await convertToModelMessages(messages);
    const flat = JSON.stringify(model);
    assert.match(flat, /17/);
    assert.match(flat, /web_search/);
    assert.match(flat, /tool-call|tool-result/);
  });
});

describe("tool transcript persist / reload", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("search then recall 17: reload still sends 17 and the web_search stub", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    const id = "thread-search-17";
    persistThreadUIMessages(id, [
      user("u1", "My favourite number is 17."),
      assistantWithSearch("a1"),
    ]);

    const reloaded = loadThreadUIMessages(id);
    const outgoing = prepareOutgoingChatMessages({
      stored: reloaded,
      live: [user("u2", "Search for anything and then recall the number.")],
    });

    assert.equal(threadHasText(outgoing, "17"), true);
    assert.equal(hasToolNamed(outgoing, TOOL_NAMES.webSearch), true);
    assert.equal(outgoing[outgoing.length - 1]?.id, "u2");
  });

  it("create_artifact from a turn is still on the thread after refresh", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    persistThreadUIMessages("thread-art", [
      user("u1", "Write a short brief and save it."),
      assistantWithArtifact("a1"),
    ]);

    const reloaded = loadThreadUIMessages("thread-art");
    assert.equal(hasToolNamed(reloaded, TOOL_NAMES.createArtifact), true);
    const art = reloaded
      .flatMap((m) => m.parts)
      .find((p) => p.type === `tool-${TOOL_NAMES.createArtifact}`);
    assert.ok(art && "output" in art);
    const output = art && "output" in art ? (art.output as { title?: string }) : {};
    assert.equal(output.title, "Brief on 17");
  });

  it("persist writes a durable stub for an interrupted GitHub tool call", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    persistThreadUIMessages("thread-gh", [
      user("u1", "Read the repo readme"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Opening the repo…" },
          toolPart({
            name: TOOL_NAMES.githubReadFile,
            toolCallId: "gh-1",
            state: "input-available",
            input: { repo: "acme/app", path: "README.md" },
          }),
        ],
      } as UIMessage,
    ]);
    const reloaded = loadThreadUIMessages("thread-gh");
    const gh = reloaded
      .flatMap((m) => m.parts)
      .find((p) => p.type === `tool-${TOOL_NAMES.githubReadFile}`);
    assert.ok(gh);
    assert.equal(gh && "state" in gh ? gh.state : "", "output-available");
    assert.ok(gh && "output" in gh && gh.output != null);
  });
});

describe("mergeStoredThreadWithIncoming tool richness", () => {
  it("does not discard stored Drive tool output when incoming is longer but stripped", () => {
    const stored: UIMessage[] = [
      user("u1", "Find the budget file"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Found it." },
          toolPart({
            name: TOOL_NAMES.driveSearch,
            toolCallId: "drv-1",
            input: { query: "budget" },
            output: { ok: true, files: [{ id: "file-1", name: "Budget" }] },
          }),
        ],
      } as UIMessage,
    ];
    const incoming = [
      user("u1", "Find the budget file"),
      assistantText("a1", "Found it."),
      user("u2", "Open it"),
    ];
    const result = mergeStoredThreadWithIncoming(stored, incoming);
    assert.equal(hasToolNamed(result.messages, TOOL_NAMES.driveSearch), true);
  });
});
