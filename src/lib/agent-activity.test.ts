import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";
import {
  activityClockShouldRun,
  closeActivityClock,
  collectActivitySteps,
  collectWebSearchHits,
  compactLiveSteps,
  composerShouldShowStop,
  deriveAgentActivity,
  formatActivityElapsed,
  isWorkingClockLine,
  liveWorkOneLiner,
  looksLikeThinkingTheater,
  recalledActivityElapsed,
  resetActivityClock,
  shouldRevealActivityElapsed,
  shouldShowComposerActivity,
  sourceChipLabel,
  sourceTrayPills,
  syncActivityClock,
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
    assert.equal(view.liveLine, "Searching the web");
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
    assert.equal(empty.liveLine, "Thinking");
    assert.equal(empty.elapsedLabel, "5s");
    assert.equal(shouldRevealActivityElapsed(empty.elapsedSeconds), true);
    assert.doesNotMatch(JSON.stringify(empty), /search|Planning…|Mulling|Untangling|Working/i);

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
    assert.equal(tokensOnScreen.mode, "collapsed");
    assert.equal(tokensOnScreen.summaryLabel, "Thought for 5s");
    assert.equal(tokensOnScreen.liveLine, null);
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
    assert.equal(finishedTextOnly.summaryLabel, "Thought for 8s");
    assert.equal(finishedTextOnly.steps.length, 0);
  });

  it("does not vanish Working into a blank transcript after a short tool turn", () => {
    const vanished = deriveAgentActivity({
      messages: [{ id: "dublin-blank", role: "assistant", parts: [] }],
      isRunning: false,
      elapsedSeconds: 0,
    });
    assert.equal(vanished.visible, true);
    assert.equal(vanished.mode, "collapsed");
    assert.match(vanished.summaryLabel ?? "", /Thought for /);
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
    assert.deepEqual(
      compactLiveSteps(view).map((step) => step.label),
      ["Creating Grid"],
    );
    assert.equal(liveWorkOneLiner(view), "Creating Grid");
  });

  it("never paints a second Working line or stacked live theater", () => {
    const elapsed = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: true,
      elapsedSeconds: 4,
    });
    assert.equal(elapsed.liveLine, "Thinking");
    assert.equal(isWorkingClockLine(elapsed.liveLine), true);
    assert.equal(liveWorkOneLiner(elapsed), null);
    assert.equal(compactLiveSteps(elapsed).length, 0);

    const stacked = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "ireland unemployment" },
              result: { ok: true },
              status: { type: "complete" },
            },
            {
              type: "tool-call",
              toolName: "fetch_url",
              args: { url: "https://cso.ie" },
              status: { type: "running" },
            },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 9,
    });
    assert.equal(stacked.steps.length, 2);
    assert.equal(compactLiveSteps(stacked).length, 1);
    assert.equal(liveWorkOneLiner(stacked), "Reading cso.ie");
    assert.equal(looksLikeThinkingTheater(JSON.stringify(stacked)), false);
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
    assert.equal(view.summaryLabel, "Thought for 12s · Searched the web");
    assert.equal(view.elapsedSeconds, 12);
    assert.equal(view.steps.length, 1);
    assert.equal(view.steps[0]?.label, "Searched the web");
  });

  it("collapses a search with hits to the source count", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "dublin time" },
              result: {
                ok: true,
                results: [
                  { title: "Time", url: "https://time.is/Dublin" },
                  { title: "Wiki", url: "https://en.wikipedia.org/wiki/Dublin" },
                ],
              },
              status: { type: "complete" },
            },
            { type: "text", text: "It is afternoon in Dublin." },
          ],
        },
      ],
      isRunning: true,
      elapsedSeconds: 8,
    });
    assert.equal(view.mode, "collapsed");
    assert.equal(view.summaryLabel, "Thought for 8s · Searched the web · 2 sources");
    assert.equal(view.liveLine, null);
  });

  it("holds the elapsed counter until three seconds", () => {
    const early = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: true,
      elapsedSeconds: 2,
    });
    assert.equal(early.liveLine, "Thinking");
    assert.equal(early.elapsedLabel, null);
    assert.equal(shouldRevealActivityElapsed(2), false);
    const later = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: true,
      elapsedSeconds: 3,
    });
    assert.equal(later.elapsedLabel, "3s");
    assert.equal(later.lineKey, early.lineKey);
    assert.equal(shouldRevealActivityElapsed(3), true);
    assert.equal(looksLikeThinkingTheater("Thinking"), false);
    assert.equal(looksLikeThinkingTheater("Thinking…"), true);
  });

  it("collapses a search plus another tool to Searched the web", () => {
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
    assert.equal(
      view.summaryLabel,
      "Thought for 12s · Searched the web · Created table",
    );
    assert.equal(view.steps.length, 2);
    assert.equal(view.summaryLabel?.includes("\n"), false);
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
    assert.equal(a.liveLine, "Thinking");
    assert.equal(b.liveLine, "Thinking");
  });

  it("shows the gerund immediately — no empty first second, no fake steps", () => {
    const view = deriveAgentActivity({
      messages: [{ role: "assistant", parts: [] }],
      isRunning: true,
      elapsedSeconds: 0,
    });
    assert.equal(view.visible, true);
    assert.equal(view.mode, "elapsed");
    assert.equal(view.liveLine, "Thinking");
    assert.equal(view.elapsedLabel, null);
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
    assert.equal(view.liveLine, "Searching the web");
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
    assert.equal(liveWorkOneLiner(view), "Continuing 2/5");
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
    assert.equal(view.liveLine, "Searching the web");
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

  it("freezes the clock when the answer's first text token arrives", () => {
    const prose = [
      {
        role: "assistant" as const,
        id: "asst-answer",
        parts: [
          {
            type: "tool-web_search",
            args: { query: "central bank rate" },
            state: "output-available",
            result: { ok: true, results: [] },
          },
          { type: "text", text: "The rate is 2%." },
        ],
      },
    ];
    assert.equal(
      activityClockShouldRun({ isRunning: true, messages: prose }),
      false,
    );
    assert.equal(
      activityClockShouldRun({
        isRunning: true,
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "tool-web_search",
                args: { query: "central bank rate" },
                state: "input-available",
              },
              { type: "text", text: "The rate is 2%." },
            ],
          },
        ],
      }),
      true,
    );
    assert.equal(
      activityClockShouldRun({
        isRunning: true,
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "tool-web_search",
                args: { query: "central bank rate" },
                state: "input-available",
              },
            ],
          },
        ],
      }),
      true,
    );
    assert.equal(
      activityClockShouldRun({
        isRunning: true,
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "text",
                text: '<|DSML| tool_search query="time"><|/DSML| tool_search>',
              },
            ],
          },
        ],
      }),
      true,
    );

    resetActivityClock();
    mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
    try {
      syncActivityClock(true);
      mock.timers.tick(12_000);
      assert.equal(syncActivityClock(true), 12);
      assert.equal(
        activityClockShouldRun({ isRunning: true, messages: prose }),
        false,
      );
      const frozen = closeActivityClock("asst-answer");
      assert.equal(frozen, 12);
      mock.timers.tick(3_000);
      assert.equal(recalledActivityElapsed("asst-answer"), 12);
      assert.equal(syncActivityClock(false), 12);
      const view = deriveAgentActivity({
        messages: prose,
        isRunning: true,
        elapsedSeconds: recalledActivityElapsed("asst-answer"),
      });
      assert.equal(view.mode, "collapsed");
      assert.equal(
        view.summaryLabel,
        "Thought for 12s · Searched the web",
      );
    } finally {
      mock.timers.reset();
      resetActivityClock();
    }
  });

  it("names a web search in natural language and keeps the query off the live line", () => {
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
    assert.equal(view.liveLine, "Searching the web");
    assert.equal(view.elapsedLabel, "8s");
    assert.doesNotMatch(view.liveLine ?? "", /Dublin/);
    assert.equal(view.steps[0]?.label, "Searching the web");
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
    assert.equal(hits[0]?.snippet, "Ireland uses IST in summer.");
    const tagged = collectWebSearchHits([
      {
        type: "tool-call",
        toolName: "web_search",
        result: {
          results: [
            {
              title: "Funds",
              url: "https://example.com/funds",
              snippet: "<strong>This page</strong> &amp; more",
            },
          ],
        },
      },
    ]);
    assert.equal(tagged[0]?.snippet, "This page & more");
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

  it("treats raw DSML tool_search text as a real tool step, not visible prose", () => {
    const dsml =
      '<|DSML| tool_search query="current time Dublin Ireland"><|/DSML| tool_search>';
    const live = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: dsml }],
        },
      ],
      isRunning: true,
      elapsedSeconds: 3,
    });
    assert.equal(live.mode, "live");
    assert.equal(live.steps[0]?.toolName, "tool_search");
    assert.match(live.steps[0]?.label ?? "", /Looking up tools|Searching/i);
    assert.equal(live.elapsedLabel, "3s");
    assert.equal(live.liveLine, "Looking up tools");
    assert.doesNotMatch(JSON.stringify(live), /DSML|tool_search query=/);

    const done = deriveAgentActivity({
      messages: [
        {
          id: "a-dsml",
          role: "assistant",
          parts: [{ type: "text", text: dsml }],
        },
      ],
      isRunning: false,
      elapsedSeconds: 7,
    });
    assert.equal(done.mode, "collapsed");
    assert.equal(done.summaryLabel, "Looked up tools");
  });

  it("keeps Worked for Ns after the live clock is interrupted", () => {
    resetActivityClock();
    syncActivityClock(true);
    const seconds = closeActivityClock("asst-turn-1");
    assert.ok(seconds >= 1);
    assert.equal(recalledActivityElapsed("asst-turn-1"), seconds);
    const afterRemount = syncActivityClock(false);
    assert.equal(afterRemount, seconds);
    assert.equal(recalledActivityElapsed("new-id-after-remount"), seconds);
    const view = deriveAgentActivity({
      messages: [
        {
          id: "new-id-after-remount",
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              args: { query: "Ireland unemployment" },
              result: { ok: true },
              status: { type: "complete" },
            },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 0,
    });
    assert.equal(view.mode, "collapsed");
    assert.equal(view.elapsedSeconds, seconds);
    assert.equal(view.summaryLabel, "Searched the web");
    resetActivityClock();
  });

  it("collapses a failed Dublin-time tool turn instead of staying live", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          id: "a-dublin",
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              state: "output-available",
              output: {
                ok: true,
                results: [
                  { title: "Time and Date", url: "https://www.timeanddate.com" },
                ],
              },
            },
            {
              type: "tool-execute_python",
              state: "output-error",
              errorText: "Python failed",
              output: { ok: false, error: "Python failed" },
              isError: true,
            },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 31,
    });
    assert.equal(view.mode, "collapsed");
    assert.equal(
      view.summaryLabel,
      "Thought for 31s · Searched the web · Ran Python",
    );
    assert.equal(view.steps.every((step) => step.state === "complete"), true);
    assert.equal(
      activityClockShouldRun({
        isRunning: false,
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "tool-execute_python",
                state: "output-error",
                errorText: "Python failed",
                isError: true,
              },
            ],
          },
        ],
      }),
      false,
    );
  });

  it("unsticks Stop after a failed tool when the assistant row is no longer running", () => {
    const parts = [
      {
        type: "tool-execute_python",
        state: "output-error",
        errorText: "ZoneInfoNotFoundError: 'Europe/Dublin'",
        output: { ok: false, error: "ZoneInfoNotFoundError" },
        isError: true,
      },
    ];
    assert.equal(
      composerShouldShowStop({
        threadIsRunning: true,
        messageStatus: "incomplete",
        parts,
      }),
      false,
    );
    assert.equal(
      composerShouldShowStop({
        threadIsRunning: true,
        messageStatus: "running",
        parts: [
          {
            type: "tool-execute_python",
            state: "input-available",
          },
        ],
      }),
      true,
    );
  });

  it("hides the composer clock once an assistant message exists", () => {
    assert.equal(
      shouldShowComposerActivity({
        hasAssistantMessage: true,
        visible: true,
        mode: "live",
      }),
      false,
    );
    assert.equal(
      shouldShowComposerActivity({
        hasAssistantMessage: false,
        visible: true,
        mode: "live",
      }),
      true,
    );
    assert.equal(
      shouldShowComposerActivity({
        hasAssistantMessage: false,
        visible: true,
        mode: "collapsed",
      }),
      false,
    );
  });

  it("source chips survive missing titles", () => {
    assert.equal(sourceChipLabel({ title: undefined, url: "https://time.is" }), "time.is");
    assert.equal(sourceChipLabel({ title: undefined }), "");
  });

  it("keeps the source tray to three host pills", () => {
    const pills = sourceTrayPills([
      { url: "https://cso.ie/a" },
      { url: "https://www.cso.ie/b" },
      { url: "https://oecd.org/c" },
      { url: "https://example.com/d" },
      { title: "   " },
    ]);
    assert.equal(pills.length, 3);
    assert.equal(sourceChipLabel(pills[0]!), "cso.ie");
  });

  it("collects DSML tool_search from a text part", () => {
    const steps = collectActivitySteps(
      [
        {
          type: "text",
          text: '<|DSML| tool_search query="current time Dublin Ireland">',
        },
      ],
      true,
    );
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.toolName, "tool_search");
  });
});

describe("one step per tool call", () => {
  it("collapses a duplicated search and page into the single disclosure", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              toolName: "web_search",
              toolCallId: "search-1",
              state: "input-available",
              input: { query: "events in Dublin this weekend" },
            },
            {
              type: "tool-web_search",
              toolName: "web_search",
              toolCallId: "search-1",
              state: "output-available",
              input: { query: "events in Dublin this weekend" },
              output: { ok: true, results: [{ title: "Eventbrite", url: "https://www.eventbrite.ie/d/ireland--dublin/events/" }] },
            },
            {
              type: "tool-browse_page",
              toolName: "browse_page",
              toolCallId: "page-1",
              state: "output-available",
              input: { url: "https://www.eventbrite.ie/d/ireland--dublin/events/" },
              output: { ok: true, title: "Dublin events", url: "https://www.eventbrite.ie/d/ireland--dublin/events/" },
            },
            {
              type: "tool-call",
              toolName: "browse_page",
              toolCallId: "page-1",
              args: { url: "https://www.eventbrite.ie/d/ireland--dublin/events/" },
              result: { ok: true, title: "Dublin events", url: "https://www.eventbrite.ie/d/ireland--dublin/events/" },
              status: { type: "complete" },
            },
            { type: "text", text: "Saturday 3 and Sunday 4 October." },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 12,
    });

    assert.equal(view.mode, "collapsed");
    assert.equal(view.steps.filter((step) => step.toolName === "web_search").length, 1);
    assert.equal(view.steps.filter((step) => step.toolName === "browse_page").length, 1);
    assert.equal(view.steps.length, 2);
    assert.equal(view.summaryLabel?.includes("\n"), false);
    assert.match(view.summaryLabel ?? "", /Searched the web/);
    assert.match(view.summaryLabel ?? "", /eventbrite\.ie/);
  });
});

describe("formatActivityElapsed", () => {
  it("uses seconds and minute form without inventing work", () => {
    assert.equal(formatActivityElapsed(4), "4s");
    assert.equal(formatActivityElapsed(75), "1m 15s");
  });
});

describe("one disclosure per finished turn", () => {
  it("collapses a time tool to a single Checked the time line", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: "The user wants Dublin local time.",
            },
            {
              type: "tool-call",
              toolName: "current_time",
              args: { timezone: "Europe/Dublin" },
              result: { ok: true, time: "17:27" },
              status: { type: "complete" },
            },
            { type: "text", text: "It is 5:27 PM in Dublin." },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 4,
    });

    assert.equal(view.mode, "collapsed");
    assert.equal(view.summaryLabel, "Checked the time");
    assert.equal(view.steps.length, 1);
    assert.equal(view.reasoning, "The user wants Dublin local time.");
    assert.equal(view.summaryLabel?.includes("Dublin local time"), false);
    assert.equal(view.summaryLabel?.includes("\n"), false);
    assert.doesNotMatch(JSON.stringify(view.summaryLabel), /"time"|17:27/);
  });

  it("joins search and fetch into one headline and keeps both steps", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "web_search",
              args: { query: "Central Bank of Ireland funds" },
              result: {
                ok: true,
                results: [
                  {
                    title: "Funds",
                    url: "https://www.centralbank.ie/news",
                  },
                ],
              },
              status: { type: "complete" },
            },
            {
              type: "tool-call",
              toolName: "fetch_url",
              args: { url: "https://www.centralbank.ie/funds" },
              result: {
                ok: true,
                title: "Funds",
                url: "https://www.centralbank.ie/funds",
                text: "A long page body that must stay out of the headline.",
              },
              status: { type: "complete" },
            },
            { type: "text", text: "The funds page is up." },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 4,
    });

    assert.equal(view.mode, "collapsed");
    assert.equal(
      view.summaryLabel,
      "Thought for 4s · Searched the web · 2 sources · Read centralbank.ie",
    );
    assert.equal(view.steps.length, 2);
    assert.equal(view.steps[0]?.toolName, "web_search");
    assert.equal(view.steps[0]?.query, "Central Bank of Ireland funds");
    assert.equal(view.steps[1]?.toolName, "fetch_url");
    assert.equal(view.steps[1]?.site, "centralbank.ie");
    assert.equal(view.reasoning, null);
    assert.equal(view.summaryLabel?.includes("\n"), false);
    assert.equal(view.summaryLabel?.includes("long page body"), false);
  });

  it("keeps a python run inside the step and out of the headline", () => {
    const view = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolName: "execute_python",
              args: { code: "print(1 + 1)\n" },
              result: { ok: true, stdout: "2\n" },
              status: { type: "complete" },
            },
            { type: "text", text: "The result is 2." },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 5,
    });

    assert.equal(view.summaryLabel, "Ran Python");
    assert.equal(view.steps[0]?.code, "print(1 + 1)");
    assert.equal(JSON.stringify(view).includes('"stdout"'), false);
  });

  it("strips DSML, system text, and raw tool JSON from reasoning", () => {
    const dumped = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: '<|DSML| tool_search query="x"><|/DSML| tool_search> {"toolName":"current_time","arguments":{"tz":"Europe/Dublin"}}',
            },
            { type: "text", text: "Done." },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 4,
    });
    assert.equal(dumped.reasoning, null);
    assert.doesNotMatch(JSON.stringify(dumped), /DSML|toolName|Europe\/Dublin/);

    const mixed = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: 'System: you are a hidden planner.\nCheck the clock. {"toolName":"current_time","arguments":{"tz":"Europe/Dublin"}}',
            },
            { type: "text", text: "It is evening." },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 4,
    });
    assert.equal(mixed.summaryLabel, "Thought for 4s");
    assert.equal(mixed.reasoning, "Check the clock.");
    assert.equal(mixed.summaryLabel?.includes("Check the clock"), false);
    assert.equal(JSON.stringify(mixed.reasoning).includes("toolName"), false);
    assert.equal(JSON.stringify(mixed.reasoning).includes("System:"), false);
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
    assert.match(thread, /composerShouldShowStop/);
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
    assert.match(css, /aether-activity__glyph/);
    assert.match(css, /aether-shimmer|aether-activity__label/);
    assert.match(css, /var\(--motion-ease\)/);
    assert.match(css, /var\(--motion-base\)/);
    assert.match(css, /aether-composer-dock/);
    assert.match(css, /aether-activity__chip/);
    assert.match(css, /flex-wrap:\s*nowrap/);
    assert.match(css, /aether-source-tray__hosts/);
    assert.doesNotMatch(css, /translateY\(3px\)/);
    assert.match(toolUi, /aether-tool-trace/);
    assert.doesNotMatch(toolUi, /aether-tool-trace__summary/);
    assert.doesNotMatch(toolUi, /toolTraceNoun/);
    assert.doesNotMatch(toolUi, /const ICONS/);
    assert.doesNotMatch(toolUi, /display\.runningLabel/);
    assert.doesNotMatch(toolUi, /Searching the web…/);
    assert.doesNotMatch(toolUi, /Mulling|Untangling/);
    assert.doesNotMatch(toolUi, /ToolApprovalToggle/);
    assert.match(strip, /aether-inline-source/);
    assert.match(strip, /aether-source-tray__pill/);
    assert.match(strip, /aether-activity__steps/);
    assert.match(strip, /compactLiveSteps/);
    assert.match(strip, /liveWorkOneLiner/);
    assert.match(strip, /MessageSourceCards/);
    assert.match(strip, /data-activity-slot="pending"/);
    assert.match(strip, /data-activity-slot="message"/);
    assert.match(thread, /MessageSourceCards/);
    assert.match(thread, /AgentStatusStrip/);
    assert.doesNotMatch(thread, /<AgentStatusStrip \/>\s*\n\s*\{pending &&/);
    assert.match(thread, /aether-composer-dock/);
    assert.doesNotMatch(thread, /ToolApprovalToggle/);
    assert.doesNotMatch(strip, /Mulling|Untangling|Churning/);
    assert.match(strip, /shouldRevealActivityElapsed/);
    assert.match(strip, /aether-activity__glyph/);
    assert.match(strip, /aether-activity__label/);
    assert.doesNotMatch(strip, /Working for/);
    assert.match(strip, /aria-live="polite"/);
    assert.match(strip, /aria-expanded/);
    assert.match(strip, /aria-controls/);
    assert.match(strip, /aether-activity__reasoning/);
    assert.match(strip, /step\.query/);
    assert.match(strip, /step\.site/);
    assert.match(strip, /step\.code/);
    assert.match(thread, /type === "reasoning"/);
    const assistantMessage = thread.slice(
      thread.indexOf("const AssistantMessage"),
      thread.indexOf("const AssistantActionBar"),
    );
    assert.match(assistantMessage, /isLast/);
    assert.match(assistantMessage, /md:group-hover\/message:opacity-100/);
    assert.doesNotMatch(
      assistantMessage,
      /opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover\/message:opacity-100/,
    );
    const userMessage = thread.slice(
      thread.indexOf("const UserMessage"),
      thread.indexOf("const UserActionBar"),
    );
    assert.match(
      userMessage,
      /md:opacity-0 md:group-hover\/message:opacity-100/,
    );
    assert.match(strip, /activityClockShouldRun/);
    assert.match(strip, /shouldShowComposerActivity/);
    assert.match(strip, /sourceChipLabel/);
    assert.match(
      strip,
      /continuePhase:\s*continueStatus\.phase/,
    );
    assert.doesNotMatch(
      strip,
      /continuePhase:\s*isRunning \? continueStatus\.phase : "idle"/,
    );
  });

  it("freshens the thread: measure, bubble, composer, sources, title, scroll", () => {
    const thread = readFileSync(
      new URL("../components/assistant-ui/thread.tsx", import.meta.url),
      "utf8",
    );
    const header = readFileSync(
      new URL("../components/assistant-ui/thread-header.tsx", import.meta.url),
      "utf8",
    );
    const sidebar = readFileSync(
      new URL("../components/layout/sidebar.tsx", import.meta.url),
      "utf8",
    );
    const css = readFileSync(
      new URL("../components/assistant-ui/agent-activity.css", import.meta.url),
      "utf8",
    );
    const markdown = readFileSync(
      new URL("../components/assistant-ui/markdown-text.tsx", import.meta.url),
      "utf8",
    );
    const strip = readFileSync(
      new URL(
        "../components/assistant-ui/agent-status-strip.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(thread, /42rem/);
    assert.match(thread, /aether-user-bubble/);
    assert.match(thread, /aether-composer/);
    assert.match(thread, /aether-thread-enter/);
    assert.match(thread, /aether-scroll-bottom/);
    assert.match(thread, /aether-action-row/);
    assert.match(header, /aether-title-enter/);
    assert.doesNotMatch(header, /font-sc/);
    const recent = sidebar.slice(
      Math.max(0, sidebar.indexOf("Recent") - 220),
      sidebar.indexOf("Recent"),
    );
    assert.doesNotMatch(recent, /uppercase/);
    assert.match(strip, /aether-pages-pill/);
    assert.match(strip, /Web results/);
    assert.match(strip, /sourcePagesLabel/);
    assert.match(readFileSync(new URL("./agent-activity.ts", import.meta.url), "utf8"), /pages/);
    assert.doesNotMatch(strip, /aether-source-card/);
    assert.match(css, /aether-pages-pill/);
    assert.match(css, /aether-web-results/);
    assert.match(markdown, /aether-cite/);
    assert.match(markdown, /title=/);
  });

  it("ends a cut-off exec instead of freezing Running exec", () => {
    const messages = [
      {
        role: "assistant" as const,
        parts: [
          { type: "text" as const, text: "The first trials finished." },
          {
            type: "tool-exec",
            toolName: "exec",
            state: "input-available",
            args: { command: "python sim.py" },
          },
        ],
      },
    ];
    const running = deriveAgentActivity({
      messages,
      isRunning: true,
      elapsedSeconds: 300,
    });
    assert.equal(running.liveLine, "Running exec");
    assert.equal(formatActivityElapsed(running.elapsedSeconds), "5m 00s");
    const stopped = deriveAgentActivity({
      messages,
      isRunning: false,
      elapsedSeconds: 300,
    });
    assert.notEqual(stopped.liveLine, "Running exec");
    assert.equal(
      stopped.steps.some((step) => step.label === "Running exec"),
      false,
    );
    assert.equal(
      stopped.steps.some((step) => step.label === "Exec stopped"),
      true,
    );
    assert.equal(
      activityClockShouldRun({ isRunning: false, messages }),
      false,
    );
    const timedOut = deriveAgentActivity({
      messages: [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "The first trials finished." },
            {
              type: "tool-exec",
              toolName: "exec",
              state: "output-available",
              output: { ok: false, error: "The command timed out. Try a smaller step." },
            },
          ],
        },
      ],
      isRunning: false,
      elapsedSeconds: 300,
    });
    assert.equal(
      timedOut.steps.some((step) => step.label === "Exec stopped"),
      true,
    );
    assert.notEqual(timedOut.mode, "live");
  });
});
