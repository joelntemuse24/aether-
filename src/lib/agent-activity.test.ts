import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  activityClockShouldRun,
  collectWebSearchHits,
  deriveAgentActivity,
  formatActivityElapsed,
} from "./agent-activity";

describe("deriveAgentActivity — honesty", () => {
  it("does not invent a search line when no search tool ran", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Here is a quiet answer." }],
        },
      ],
      isRunning: true,
      elapsedSeconds: 4,
    });

    assert.equal(
      view.steps.some((s) => /search/i.test(s.label)),
      false,
    );
    assert.equal(
      view.steps.filter((s) => s.kind === "tool").length,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(view),
      /Thinking|Planning|Gathering context|Mulling|Untangling/i,
    );
  });

  it("shows a tool step when a tool part exists", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "aether cream ui" },
              status: { type: "running" },
            },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 3,
    });

    assert.equal(view.visible, true);
    assert.equal(view.mode, "live");
    assert.equal(view.liveLine, "Searching aether cream ui");
    assert.equal(view.steps.length, 1);
    assert.equal(view.steps[0]?.kind, "tool");
    assert.equal(view.steps[0]?.toolName, "web_search");
    assert.equal(view.steps[0]?.state, "running");
    assert.match(view.steps[0]?.label ?? "", /search/i);
    assert.doesNotMatch(view.steps[0]?.label ?? "", /Thinking|Planning/i);
  });

  it("treats AI SDK tool-* parts as real work", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-create_artifact",
              args: { kind: "data", title: "Q3 costs" },
              status: { type: "running" },
            },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 2,
    });

    assert.equal(view.steps.length, 1);
    assert.equal(view.steps[0]?.toolName, "create_artifact");
    assert.equal(view.steps[0]?.label, "Creating Q3 costs");
    assert.equal(view.liveLine, "Creating Q3 costs");
  });

  it("does not show a fake tool stack on an empty or token-only turn", () => {
    const empty = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: true,
      elapsedSeconds: 5,
    });
    assert.equal(empty.steps.filter((s) => s.kind === "tool").length, 0);
    assert.equal(empty.mode, "elapsed");
    assert.equal(empty.liveLine, "Working");
    assert.equal(empty.elapsedLabel, "Working for 5s");
    assert.doesNotMatch(JSON.stringify(empty), /search|Planning|Thinking|Mulling|Untangling/i);

    const tokensOnScreen = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Hello — here is the answer." }],
        },
      ],
      isRunning: true,
      elapsedSeconds: 5,
    });
    assert.equal(tokensOnScreen.visible, true);
    assert.equal(tokensOnScreen.mode, "elapsed");
    assert.equal(tokensOnScreen.elapsedLabel, "Working for 5s");
    assert.equal(tokensOnScreen.steps.length, 0);

    const finishedTextOnly = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Done." }],
        },
      ],
      isRunning: false,
      elapsedSeconds: 8,
    });
    assert.equal(finishedTextOnly.visible, true);
    assert.equal(finishedTextOnly.mode, "collapsed");
    assert.equal(finishedTextOnly.summaryLabel, "Worked for 8s");
    assert.equal(finishedTextOnly.steps.length, 0);
  });

  it("mutates one live line to the current real step, keeping others for collapse", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "x" },
              result: { ok: true, results: [] },
              status: { type: "complete" },
            },
            {
              type: "tool-call",
              toolName: "create_artifact",
              args: { kind: "data", title: "Grid" },
              status: { type: "running" },
            },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 9,
    });

    assert.equal(view.steps.length, 2);
    assert.equal(view.steps[0]?.state, "complete");
    assert.equal(view.steps[0]?.label, "Searched the web");
    assert.equal(view.steps[1]?.state, "running");
    assert.equal(view.steps[1]?.label, "Creating Grid");
    assert.equal(view.liveStepId, view.steps[1]?.id);
    assert.equal(view.liveLine, "Creating Grid");
    assert.equal(view.lineKey, view.steps[1]?.id);
    assert.doesNotMatch(view.liveLine ?? "", /Thinking|Planning/i);
  });

  it("collapses a single real step to that work plus elapsed seconds", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "x" },
              result: { ok: true },
              status: { type: "complete" },
            },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 12,
    });

    assert.equal(view.visible, true);
    assert.equal(view.mode, "collapsed");
    assert.equal(view.summaryLabel, "Worked for 12s");
    assert.equal(view.elapsedSeconds, 12);
    assert.equal(view.steps.length, 1);
    assert.equal(view.steps[0]?.label, "Searched the web");
  });

  it("collapses multiple real steps to Worked for Ns", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "x" },
              result: { ok: true },
              status: { type: "complete" },
            },
            {
              type: "tool-call",
              toolName: "create_artifact",
              args: { kind: "data", title: "Grid" },
              result: { ok: true },
              status: { type: "complete" },
            },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 12,
    });

    assert.equal(view.mode, "collapsed");
    assert.equal(view.summaryLabel, "Worked for 12s");
    assert.equal(view.steps.length, 2);
  });

  it("ignores classifying — no Planning costume", () => {
    const view = deriveAgentActivity({
      messages: [],
      isRunning: false,
      elapsedSeconds: 0,
      classifying: true,
    });
    assert.equal(view.visible, false);
    assert.doesNotMatch(JSON.stringify(view), /Planning|Thinking|Working/i);
  });

  it("keeps lineKey stable while elapsed seconds tick", () => {
    const base = {
      messages: [{ role: "assistant" as const, parts: [] }],
      isRunning: true,
    };
    const a = deriveAgentActivity({ ...base, elapsedSeconds: 4 });
    const b = deriveAgentActivity({ ...base, elapsedSeconds: 5 });
    assert.equal(a.lineKey, "elapsed");
    assert.equal(a.lineKey, b.lineKey);
    assert.equal(a.liveLine, "Working");
    assert.equal(b.liveLine, "Working");
  });

  it("shows the gerund immediately — no empty first second, no fake steps", () => {
    const view = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: true,
      elapsedSeconds: 0,
    });
    assert.equal(view.visible, true);
    assert.equal(view.mode, "elapsed");
    assert.equal(view.liveLine, "Working");
    assert.equal(view.steps.length, 0);
    assert.doesNotMatch(JSON.stringify(view), /Mulling|Untangling|Searching/i);
  });

  it("stays live when tools are still open after isRunning flips false", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              args: { query: "keep going" },
              state: "input-available",
            },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 61,
    });
    assert.equal(view.visible, true);
    assert.equal(view.mode, "live");
    assert.equal(view.liveLine, "Searching keep going");
    assert.equal(view.steps[0]?.state, "running");
  });

  it("shows a paused continue line when the run is waiting on the user", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Partial draft…" }],
        },
      ],
      isRunning: false,
      elapsedSeconds: 62,
      continuePhase: "needs-continue",
      continueSegment: 5,
      continueMax: 5,
    });
    assert.equal(view.visible, true);
    assert.match(view.liveLine ?? "", /Paused/);
    assert.match(view.elapsedLabel ?? "", /continue/i);
    assert.doesNotMatch(JSON.stringify(view), /Thinking|Planning|ChatGPT/i);
  });

  it("keeps Continuing visible even when the stream is not marked running", () => {
    const view = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: false,
      elapsedSeconds: 4,
      continuePhase: "continuing",
      continueSegment: 2,
      continueMax: 5,
    });
    assert.equal(view.visible, true);
    assert.equal(view.elapsedLabel, "Continuing 2/5");
    assert.equal(view.liveLine, "Continuing 2/5");
  });

  it("does not show Paused while the worker is still running", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              args: { query: "keep going" },
              state: "input-available",
            },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 61,
      continuePhase: "needs-continue",
    });
    assert.equal(view.mode, "live");
    assert.equal(view.liveLine, "Searching keep going");
    assert.doesNotMatch(view.liveLine ?? "", /Paused/);
  });

  it("keeps the elapsed clock ticking while tools are open and not paused", () => {
    const openTools = [
      {
        role: "assistant" as const,
        parts: [
          {
            type: "tool-web_search",
            args: { query: "keep going" },
            state: "input-available",
          },
        ],
      },
    ];
    assert.equal(
      activityClockShouldRun({
        isRunning: false,
        messages: openTools,
      }),
      true,
    );
    assert.equal(
      activityClockShouldRun({
        isRunning: false,
        continuePhase: "needs-continue",
        messages: openTools,
      }),
      false,
    );
    assert.equal(
      activityClockShouldRun({
        isRunning: true,
        continuePhase: "needs-continue",
        messages: openTools,
      }),
      true,
    );
  });

  it("uses the real search query on the live line", () => {
    const query = "Dublin's current time zone and daylight saving status";
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query },
              status: { type: "running" },
            },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 8,
    });
    assert.equal(view.mode, "live");
    assert.equal(view.liveLine, `Searching ${query}`);
    assert.equal(view.elapsedSeconds, 8);
  });

  it("collects web search hits for source cards, and nothing when no search ran", () => {
    assert.deepEqual(
      collectWebSearchHits([{ type: "text", text: "Hi" }]),
      [],
    );
    const hits = collectWebSearchHits([
      {
        type: "tool-call",
        toolName: "web_search",
        args: { query: "Dublin time zone" },
        result: {
          ok: true,
          results: [
            {
              title: "Time in Dublin",
              url: "https://example.com/dublin",
              snippet: "Ireland uses IST in summer.",
            },
          ],
        },
      },
    ]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.title, "Time in Dublin");
    assert.equal(hits[0]?.url, "https://example.com/dublin");
    assert.equal(hits[0]?.id, "1");
    const fetched = collectWebSearchHits([
      {
        type: "tool-fetch_url",
        result: {
          ok: true,
          title: "Central Bank",
          url: "https://www.centralbank.ie/funds",
        },
      },
    ]);
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0]?.id, "1");
    assert.equal(fetched[0]?.title, "Central Bank");
  });
});

describe("formatActivityElapsed", () => {
  it("uses seconds and minute form without inventing work", () => {
    assert.equal(formatActivityElapsed(4), "4s");
    assert.equal(formatActivityElapsed(75), "1m 15s");
  });
});

describe("thread / composer copy stays honest", () => {
  it("does not keep Thinking / Planning / Working costume strings", () => {
    const files = [
      new URL("../components/assistant-ui/thread.tsx", import.meta.url),
      new URL("../components/assistant-ui/thread-header.tsx", import.meta.url),
      new URL(
        "../components/assistant-ui/agent-status-strip.tsx",
        import.meta.url,
      ),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /Thinking…/, file.pathname);
      assert.doesNotMatch(src, /Planning…/, file.pathname);
      assert.doesNotMatch(src, /Working…/, file.pathname);
      assert.doesNotMatch(src, /Gathering context/, file.pathname);
      assert.doesNotMatch(src, /THINKING_PHRASES/, file.pathname);
    }
    const thread = readFileSync(
      new URL("../components/assistant-ui/thread.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      thread,
      /bg-\[var\(--text\)\] px-3 text-\[var\(--canvas\)\]/,
    );
    assert.match(thread, /aether-send-stop/);
    assert.match(thread, /aether-composer-dock/);
    const activity = readFileSync(
      new URL(
        "../components/assistant-ui/agent-status-strip.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(activity, /›/);
  });

  it("keeps Aether chrome: named transitions, no Grok ›, no GPT chips", () => {
    const css = readFileSync(
      new URL("../components/assistant-ui/agent-activity.css", import.meta.url),
      "utf8",
    );
    const toolUi = readFileSync(
      new URL("../components/assistant-ui/tool-ui.tsx", import.meta.url),
      "utf8",
    );
    const strip = readFileSync(
      new URL(
        "../components/assistant-ui/agent-status-strip.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const thread = readFileSync(
      new URL("../components/assistant-ui/thread.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(css, /›/);
    assert.doesNotMatch(css, /transition:\s*all/);
    assert.doesNotMatch(css, /Churning|ice-cream|pixel-grid/i);
    assert.match(css, /tabular-nums/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /transition-property:/);
    assert.match(css, /aether-inline-source/);
    assert.match(css, /aether-activity__spinner/);
    assert.match(css, /aether-composer-dock/);
    assert.match(css, /aether-activity__chip/);
    assert.match(toolUi, /aether-tool-trace/);
    assert.doesNotMatch(toolUi, /const ICONS/);
    assert.doesNotMatch(toolUi, /display\.runningLabel/);
    assert.doesNotMatch(toolUi, /Searching the web…/);
    assert.doesNotMatch(toolUi, /Mulling|Untangling/);
    assert.doesNotMatch(toolUi, /ToolApprovalToggle/);
    assert.match(strip, /aether-inline-source/);
    assert.match(strip, /aether-activity__chip/);
    assert.match(strip, /MessageSourceCards/);
    assert.match(thread, /MessageSourceCards/);
    assert.doesNotMatch(thread, /ToolApprovalToggle/);
    assert.doesNotMatch(strip, /Mulling|Untangling|Churning/);
    assert.match(strip, /Working for/);
    assert.match(strip, /aether-activity__steps/);
    assert.match(strip, /aether-activity__spinner/);
    assert.match(strip, /activityClockShouldRun/);
    assert.match(
      strip,
      /continuePhase:\s*continueStatus\.phase/,
    );
    assert.doesNotMatch(
      strip,
      /continuePhase:\s*isRunning \? continueStatus\.phase : "idle"/,
    );
  });
});
