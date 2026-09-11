import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  NEW_CHAT_PATH,
  didUrlBecomeNewChat,
  parseThreadIdFromPath,
  planActiveThreadToUrl,
  planUrlToThread,
  nextUrlSyncLatches,
  shouldClearApplyingUrlThread,
  shouldClearPendingNewChat,
  shouldHoldEmptyWelcome,
  stickyCanonicalId,
  threadPath,
} from "./thread-url";

describe("thread path helpers", () => {
  it("detects a live navigation from /c/<id> to /", () => {
    assert.equal(didUrlBecomeNewChat("thread-old", null), true);
    assert.equal(didUrlBecomeNewChat(null, null), false);
    assert.equal(didUrlBecomeNewChat(null, "thread-new"), false);
    assert.equal(didUrlBecomeNewChat("thread-a", "thread-b"), false);
  });

  it("parses /c/<id> and treats / as a new chat", () => {
    assert.equal(parseThreadIdFromPath("/"), null);
    assert.equal(parseThreadIdFromPath("/c/thread-9"), "thread-9");
    assert.equal(parseThreadIdFromPath("/c/thread%2Fslash"), "thread/slash");
    assert.equal(threadPath("thread-9"), "/c/thread-9");
  });
});

describe("stickyCanonicalId", () => {
  it("recomputes when the list item key changes", () => {
    const next = stickyCanonicalId(
      { key: "item-a", id: "thread-a" },
      "item-b",
      null,
    );
    assert.deepEqual(next, { key: "item-b", id: null });
  });

  it("keeps the last id when a cloud refresh briefly drops remoteId", () => {
    const next = stickyCanonicalId(
      { key: "item-a", id: "thread-a" },
      "item-a",
      null,
    );
    assert.deepEqual(next, { key: "item-a", id: "thread-a" });
  });

  it("applies an upgrade from null to a remote id", () => {
    const next = stickyCanonicalId(
      { key: "item-a", id: null },
      "item-a",
      "thread-a",
    );
    assert.deepEqual(next, { key: "item-a", id: "thread-a" });
  });
});

describe("new chat must not write the previous /c/<id> back", () => {
  it("holds / while the runtime still reports the old thread", () => {
    const plan = planActiveThreadToUrl({
      urlThreadId: null,
      canonicalId: "thread-old",
      itemIsNew: false,
      pendingNewChat: true,
      applyingUrlThread: null,
    });
    assert.deepEqual(plan, { action: "write", path: NEW_CHAT_PATH });
  });

  it("does not treat “URL is already /” as permission to write the old id", () => {
    // #77 cleared the latch as soon as urlThreadId === null, then wrote
    // canonicalId (still the previous thread) — that is the bounce.
    const stillPending = !shouldClearPendingNewChat({
      pendingNewChat: true,
      itemIsNew: false,
    });
    assert.equal(stillPending, true);

    const plan = planActiveThreadToUrl({
      urlThreadId: null,
      canonicalId: "thread-old",
      itemIsNew: false,
      pendingNewChat: true,
      applyingUrlThread: null,
    });
    assert.notEqual(plan.action === "write" ? plan.path : "", "/c/thread-old");
  });

  it("resumes normal sync once the runtime reports a new empty chat", () => {
    assert.equal(
      shouldClearPendingNewChat({ pendingNewChat: true, itemIsNew: true }),
      true,
    );
    const plan = planActiveThreadToUrl({
      urlThreadId: null,
      canonicalId: null,
      itemIsNew: true,
      pendingNewChat: false,
      applyingUrlThread: null,
    });
    assert.deepEqual(plan, { action: "write", path: NEW_CHAT_PATH });
  });

  it("forces / if the sidebar has not finished the push yet", () => {
    const plan = planActiveThreadToUrl({
      urlThreadId: "thread-old",
      canonicalId: "thread-old",
      itemIsNew: false,
      pendingNewChat: true,
      applyingUrlThread: null,
    });
    assert.deepEqual(plan, { action: "write", path: NEW_CHAT_PATH });
  });
});

describe("refresh / deep link must not flash a new chat URL", () => {
  it("holds /c/<id> while the constructor's new-thread is still active", () => {
    const plan = planActiveThreadToUrl({
      urlThreadId: "thread-saved",
      canonicalId: null,
      itemIsNew: true,
      pendingNewChat: false,
      applyingUrlThread: "thread-saved",
    });
    assert.deepEqual(plan, { action: "hold" });
  });

  it("does not end URL hydration until the runtime matches the deep link", () => {
    assert.equal(
      shouldClearApplyingUrlThread({
        applyingUrlThread: "thread-saved",
        canonicalId: null,
        urlThreadId: "thread-saved",
      }),
      false,
    );
    assert.equal(
      shouldClearApplyingUrlThread({
        applyingUrlThread: "thread-saved",
        canonicalId: "thread-saved",
        urlThreadId: "thread-saved",
      }),
      true,
    );
  });

  it("ends URL hydration when the user leaves for a new chat", () => {
    assert.equal(
      shouldClearApplyingUrlThread({
        applyingUrlThread: "thread-saved",
        canonicalId: "thread-saved",
        urlThreadId: null,
      }),
      true,
    );
  });

  it("writes /c/<id> after hydrate so refresh stays on the same thread", () => {
    const plan = planActiveThreadToUrl({
      urlThreadId: "thread-saved",
      canonicalId: "thread-saved",
      itemIsNew: false,
      pendingNewChat: false,
      applyingUrlThread: null,
    });
    assert.deepEqual(plan, { action: "write", path: "/c/thread-saved" });
  });
});

describe("URL → thread", () => {
  it("ignores a path we just wrote (avoid URL→state ping-pong)", () => {
    assert.equal(
      planUrlToThread({
        pathname: "/c/thread-9",
        urlThreadId: "thread-9",
        pendingPath: "/c/thread-9",
        pendingNewChat: false,
        itemIsNew: false,
      }),
      "ignore",
    );
  });

  it("switches to the URL thread on deep link / back", () => {
    assert.equal(
      planUrlToThread({
        pathname: "/c/thread-9",
        urlThreadId: "thread-9",
        pendingPath: null,
        pendingNewChat: false,
        itemIsNew: false,
      }),
      "switch-thread",
    );
  });

  it("does not remount when /c/:id is already the active thread", () => {
    assert.equal(
      planUrlToThread({
        pathname: "/c/thread-fast",
        urlThreadId: "thread-fast",
        pendingPath: null,
        pendingNewChat: false,
        itemIsNew: false,
        canonicalId: "thread-fast",
      }),
      "ignore",
    );
  });

  it("does not remount when the runtime is already a new empty chat", () => {
    assert.equal(
      planUrlToThread({
        pathname: "/",
        urlThreadId: null,
        pendingPath: "/",
        pendingNewChat: true,
        itemIsNew: true,
      }),
      "ignore",
    );
  });

  it("still switchToNewThread from / when the old thread is mounted", () => {
    assert.equal(
      planUrlToThread({
        pathname: "/",
        urlThreadId: null,
        pendingPath: "/",
        pendingNewChat: true,
        itemIsNew: false,
      }),
      "switch-new",
    );
  });

  it("starts a new chat for a user-driven / navigation", () => {
    assert.equal(
      planUrlToThread({
        pathname: "/",
        urlThreadId: null,
        pendingPath: null,
        pendingNewChat: false,
        itemIsNew: false,
      }),
      "switch-new",
    );
  });

  it("does not wipe a first send while /c/<id> is still in flight", () => {
    // initialize() flips itemIsNew→false while the URL is still `/`.
    // Treating that as switch-new blanks the guest turn.
    assert.equal(
      planUrlToThread({
        pathname: "/",
        urlThreadId: null,
        pendingPath: "/c/thread-new",
        pendingNewChat: false,
        itemIsNew: false,
      }),
      "ignore",
    );
    assert.equal(
      planUrlToThread({
        pathname: "/",
        urlThreadId: null,
        pendingPath: "/c/thread-new",
        pendingNewChat: true,
        itemIsNew: false,
      }),
      "ignore",
    );
  });
});

describe("latches arm from the live URL during render", () => {
  it("arms new-chat when Back lands on / while the runtime still has a thread", () => {
    const next = nextUrlSyncLatches({
      urlThreadId: null,
      canonicalId: "thread-old",
      itemIsNew: false,
      pendingNewChat: false,
      applyingUrlThread: null,
      urlBecameNewChat: true,
    });
    assert.equal(next.pendingNewChat, true);
    const plan = planActiveThreadToUrl({
      urlThreadId: null,
      canonicalId: "thread-old",
      itemIsNew: false,
      pendingNewChat: next.pendingNewChat,
      applyingUrlThread: next.applyingUrlThread,
    });
    assert.deepEqual(plan, { action: "write", path: NEW_CHAT_PATH });
  });

  it("does not treat first-send /c/ write as a new-chat bounce", () => {
    const next = nextUrlSyncLatches({
      urlThreadId: null,
      canonicalId: "thread-new",
      itemIsNew: false,
      pendingNewChat: false,
      applyingUrlThread: null,
      urlBecameNewChat: false,
    });
    assert.equal(next.pendingNewChat, false);
    const plan = planActiveThreadToUrl({
      urlThreadId: null,
      canonicalId: "thread-new",
      itemIsNew: false,
      pendingNewChat: next.pendingNewChat,
      applyingUrlThread: next.applyingUrlThread,
    });
    assert.deepEqual(plan, { action: "write", path: "/c/thread-new" });
  });

  it("holds the deep-link id when Back/forward changes /c/ before the runtime", () => {
    const next = nextUrlSyncLatches({
      urlThreadId: "thread-b",
      canonicalId: "thread-a",
      itemIsNew: false,
      pendingNewChat: false,
      applyingUrlThread: null,
      urlBecameNewChat: false,
    });
    assert.equal(next.applyingUrlThread, "thread-b");
    const plan = planActiveThreadToUrl({
      urlThreadId: "thread-b",
      canonicalId: "thread-a",
      itemIsNew: false,
      pendingNewChat: next.pendingNewChat,
      applyingUrlThread: next.applyingUrlThread,
    });
    assert.deepEqual(plan, { action: "hold" });
  });
});

describe("welcome hold follows the live URL, not the boot URL", () => {
  it("never holds Welcome on a new chat at /", () => {
    assert.equal(
      shouldHoldEmptyWelcome({ hasMessages: false, urlThreadId: null }),
      false,
    );
  });

  it("holds Welcome on /c/<id> until messages arrive (refresh)", () => {
    assert.equal(
      shouldHoldEmptyWelcome({
        hasMessages: false,
        urlThreadId: "thread-saved",
      }),
      true,
    );
  });

  it("releases as soon as messages are present", () => {
    assert.equal(
      shouldHoldEmptyWelcome({
        hasMessages: true,
        urlThreadId: "thread-saved",
      }),
      false,
    );
  });
});

describe("sync wiring stays fire-and-forget for first send", () => {
  const sync = readFileSync(
    new URL("../components/thread-url-sync.tsx", import.meta.url),
    "utf8",
  );
  const thread = readFileSync(
    new URL("../components/assistant-ui/thread.tsx", import.meta.url),
    "utf8",
  );

  it("ThreadUrlSync uses the planner instead of the inverted #77 latch", () => {
    assert.match(sync, /planActiveThreadToUrl/);
    assert.match(sync, /nextUrlSyncLatches/);
    assert.doesNotMatch(
      sync,
      /if \(urlThreadId === null\) \{\s*pendingNewChat\.current = false;/,
    );
  });

  it("holds Howzit while a first-send draft is still in flight on /c/:id", () => {
    assert.equal(
      shouldHoldEmptyWelcome({
        hasMessages: false,
        urlThreadId: "thread-fast",
        hasInFlightDraft: true,
      }),
      true,
    );
    assert.equal(
      shouldHoldEmptyWelcome({
        hasMessages: true,
        urlThreadId: "thread-fast",
        hasInFlightDraft: true,
      }),
      false,
    );
  });

  it("welcome hold reads the live pathname, not a boot-time snapshot", () => {
    const emptyState = thread.slice(
      thread.indexOf("function useThreadEmptyState"),
      thread.indexOf("export const Thread"),
    );
    assert.match(emptyState, /shouldHoldEmptyWelcome/);
    assert.match(emptyState, /usePathname/);
    assert.doesNotMatch(emptyState, /useState\(\(\) => readThreadIdFromLocation/);
  });

  it("sidebar New conversation switches the runtime, not only the URL", () => {
    const sidebar = readFileSync(
      new URL("../components/layout/sidebar.tsx", import.meta.url),
      "utf8",
    );
    const go = sidebar.slice(
      sidebar.indexOf("const goNewChat"),
      sidebar.indexOf("const openVault"),
    );
    assert.match(go, /switchToNewThread\(\)/);
    assert.match(go, /beginNewChatSession\(\)/);
    assert.match(go, /router\.push\(NEW_CHAT_PATH\)/);
  });

  it("composer send still does not await router navigation", () => {
    const sendFn = thread.slice(
      thread.indexOf("const sendWithHarness"),
      thread.indexOf("const onClarifySubmit"),
    );
    assert.doesNotMatch(sendFn, /router\.(push|replace)/);
    assert.doesNotMatch(sendFn, /await aui\.threadListItem\(\)\.initialize\(\)/);
  });
});
