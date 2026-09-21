import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectToolEvidenceFromChunks,
  hasVisibleAssistantText,
  injectFallbackAnswerChunks,
  shouldForceTextStep,
  synthesizeFallbackAnswer,
} from "./final-answer";

describe("shouldForceTextStep", () => {
  it("disables tools on the last step so the turn cannot end on a tool call", () => {
    assert.equal(shouldForceTextStep({ stepNumber: 0, maxSteps: 2 }), false);
    assert.equal(shouldForceTextStep({ stepNumber: 1, maxSteps: 2 }), true);
    assert.equal(shouldForceTextStep({ stepNumber: 7, maxSteps: 8 }), true);
    assert.equal(shouldForceTextStep({ stepNumber: 15, maxSteps: 16 }), true);
  });

  it("still forces text when the budget is a single step", () => {
    assert.equal(shouldForceTextStep({ stepNumber: 0, maxSteps: 1 }), true);
  });
});

describe("hasVisibleAssistantText", () => {
  it("treats whitespace and raw DSML as empty", () => {
    assert.equal(hasVisibleAssistantText("  "), false);
    assert.equal(
      hasVisibleAssistantText(
        '<|DSML| tool_search query="current time Dublin"><|/DSML|>',
      ),
      false,
    );
    assert.equal(hasVisibleAssistantText("It's 15:02 in Dublin."), true);
  });
});

describe("synthesizeFallbackAnswer", () => {
  it("turns a current_time result into a spoken clock answer", () => {
    const text = synthesizeFallbackAnswer({
      userText: "What time is it in Dublin?",
      tools: [
        {
          name: "current_time",
          output: {
            ok: true,
            timeZone: "Europe/Dublin",
            local: "Monday, 21 September 2026 at 16:40:12 IST",
            iso: "2026-09-21T15:40:12.000Z",
            utc: "2026-09-21T15:40:12.000Z",
          },
        },
      ],
    });
    assert.match(text, /16:40/);
    assert.match(text, /Europe\/Dublin/);
    assert.doesNotMatch(text, /ZoneInfoNotFoundError/i);
  });

  it("quotes numeric search hits with cites and does not invent extra figures", () => {
    const text = synthesizeFallbackAnswer({
      userText: "How many people in Ireland work in an office vs hospitality",
      tools: [
        {
          name: "web_search",
          output: {
            ok: true,
            query: "Ireland employment by sector CSO",
            results: [
              {
                id: "1",
                title: "CSO Labour Force Survey",
                url: "https://www.cso.ie/lfs",
                snippet:
                  "Accommodation and food service activities employed 178,000 people in Q4 2025.",
              },
              {
                id: "2",
                title: "CSO employment by NACE",
                url: "https://www.cso.ie/nace",
                snippet:
                  "Professional, scientific and technical activities: 221,400. Information and communication: 148,200.",
              },
            ],
          },
        },
      ],
    });
    assert.match(text, /178,000/);
    assert.match(text, /221,400/);
    assert.match(text, /\[1\]/);
    assert.match(text, /\[2\]/);
    assert.match(text, /caveat|proxy|not an official|office/i);
    assert.doesNotMatch(text, /999,999/);
    assert.doesNotMatch(text, /I cannot|unable to (?:find|estimate)|no numeric/i);
  });

  it("refuses to invent a number when snippets have none", () => {
    const text = synthesizeFallbackAnswer({
      userText: "How many people in Ireland work in an office vs hospitality",
      tools: [
        {
          name: "web_search",
          output: {
            ok: true,
            query: "ireland office workers",
            results: [
              {
                id: "1",
                title: "A blog post",
                url: "https://example.com/jobs",
                snippet: "Many Irish workers now hybrid-commute some days.",
              },
            ],
          },
        },
      ],
    });
    assert.match(text, /\[1\]/);
    assert.doesNotMatch(text, /\d{2,}/);
    assert.match(text, /did(?:n't| not) include|no usable numeric|won't invent|will not invent/i);
  });
});

describe("injectFallbackAnswerChunks", () => {
  it("appends a clock answer before finish when the model emitted no prose", async () => {
    async function* emptyClockTurn() {
      yield {
        type: "tool-output-available",
        toolName: "current_time",
        output: {
          ok: true,
          timeZone: "Europe/Dublin",
          local: "Monday, 21 September 2026 at 09:05:00 IST",
        },
      };
      yield { type: "finish", finishReason: "stop" };
    }

    const out = [];
    for await (const chunk of injectFallbackAnswerChunks(emptyClockTurn(), {
      userText: "What time is it in Dublin?",
    })) {
      out.push(chunk);
    }
    const text = out
      .filter((c) => c.type === "text-delta" || c.type === "text")
      .map((c) => String(c.delta ?? c.text ?? ""))
      .join("");
    assert.match(text, /09:05/);
    assert.equal(out[out.length - 1]?.type, "finish");
    assert.ok(out.findIndex((c) => c.type === "text-delta") < out.length - 1);
  });

  it("does not overwrite a real model answer", async () => {
    async function* answered() {
      yield { type: "text-delta", id: "t", delta: "It's 10:00 in Dublin." };
      yield { type: "finish", finishReason: "stop" };
    }
    const out = [];
    for await (const chunk of injectFallbackAnswerChunks(answered(), {
      userText: "What time is it in Dublin?",
    })) {
      out.push(chunk);
    }
    assert.equal(out.filter((c) => c.type === "text-delta").length, 1);
    assert.equal(out[0]?.delta, "It's 10:00 in Dublin.");
  });
});

describe("collectToolEvidenceFromChunks", () => {
  it("reads tool-output-available and tool-result shapes", () => {
    const tools = collectToolEvidenceFromChunks([
      { type: "tool-output-available", toolName: "web_search", output: { ok: true } },
      { type: "tool-result", toolName: "current_time", result: { ok: true, local: "noon" } },
    ]);
    assert.equal(tools.length, 2);
    assert.equal(tools[0]?.name, "web_search");
    assert.equal(tools[1]?.name, "current_time");
  });
});

describe("wrapStreamTextWithFallbackAnswer", () => {
  it("returns a tee-able ReadableStream so Trigger head-start can split it", async () => {
    const { wrapStreamTextWithFallbackAnswer } = await import("./final-answer");
    const result = wrapStreamTextWithFallbackAnswer(
      {
        toUIMessageStream: async function* () {
          yield {
            type: "tool-output-available",
            toolName: "current_time",
            output: {
              ok: true,
              timeZone: "Europe/Dublin",
              local: "Monday at 11:04 IST",
            },
          };
          yield { type: "finish", finishReason: "stop" };
        },
      },
      { userText: "What time is it in Dublin?" },
    );
    const stream = result.toUIMessageStream() as ReadableStream;
    assert.equal(typeof stream.tee, "function");
    const [a] = stream.tee();
    const chunks: Array<Record<string, unknown>> = [];
    const reader = a.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Record<string, unknown>);
    }
    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => String(c.delta ?? c.text ?? ""))
      .join("");
    assert.match(text, /11:04/);
  });
});
