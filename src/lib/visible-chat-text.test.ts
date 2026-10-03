import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  inlineTopLevelSvg,
  isHiddenToolMarkup,
  looksLikeRawToolMarkup,
  recoverToolCallsFromMarkup,
  sanitizeReasoningText,
  sanitizeVisibleAssistantText,
} from "./visible-chat-text";

const RAW_DSML =
  '<|DSML| tool_search query="current time Dublin Ireland"><|/DSML| tool_search>';

const RAW_DSML_SPACED =
  '< | DSML | tool_search query="current time Dublin Ireland"> </ | DSML | tool_search>';

describe("visible assistant text never dumps raw tool XML", () => {
  it("strips DSML tool_search markup and recovers the tool", () => {
    assert.equal(looksLikeRawToolMarkup(RAW_DSML), true);
    assert.equal(sanitizeVisibleAssistantText(RAW_DSML), "");
    assert.equal(isHiddenToolMarkup(RAW_DSML), true);
    const recovered = recoverToolCallsFromMarkup(RAW_DSML);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.toolName, "tool_search");
    assert.equal(recovered[0]?.args.query, "current time Dublin Ireland");
  });

  it("strips the spaced DSML dump seen on live Expert", () => {
    assert.equal(sanitizeVisibleAssistantText(RAW_DSML_SPACED), "");
    const recovered = recoverToolCallsFromMarkup(RAW_DSML_SPACED);
    assert.equal(recovered[0]?.toolName, "tool_search");
    assert.equal(recovered[0]?.args.query, "current time Dublin Ireland");
  });

  it("keeps real prose around markup", () => {
    const mixed = `It is 3pm in Dublin.\n${RAW_DSML}\nHave a good afternoon.`;
    const cleaned = sanitizeVisibleAssistantText(mixed);
    assert.match(cleaned, /It is 3pm in Dublin\./);
    assert.match(cleaned, /Have a good afternoon\./);
    assert.equal(cleaned.includes("DSML"), false);
    assert.equal(cleaned.includes("\n"), true);
    assert.equal(isHiddenToolMarkup(mixed), false);
  });

  it("treats whitespace-only text as empty", () => {
    assert.equal(sanitizeVisibleAssistantText("  \n "), "");
    assert.equal(sanitizeVisibleAssistantText("  "), "");
    assert.equal(sanitizeVisibleAssistantText("\n\n"), "");
  });

  it("keeps lists, blockquotes, and paragraphs", () => {
    const markdown = "- one\n- two\n\n> a quoted line\n\nFirst paragraph.\n\nSecond paragraph.";
    assert.equal(looksLikeRawToolMarkup(markdown), false);
    assert.equal(sanitizeVisibleAssistantText(markdown), markdown);
  });

  it("does not treat ordinary answers as markup", () => {
    const prose = "Ireland’s unemployment rate was 4.5% in Q4 2025.";
    assert.equal(looksLikeRawToolMarkup(prose), false);
    assert.equal(sanitizeVisibleAssistantText(prose), prose);
  });

  it("never throws on non-string preprocess input", () => {
    for (const value of [undefined, null, 12, { text: "x" }, ["<|DSML|"]]) {
      assert.equal(sanitizeVisibleAssistantText(value as never), "");
      assert.equal(looksLikeRawToolMarkup(value as never), false);
      assert.equal(isHiddenToolMarkup(value as never), false);
    }
  });
});

describe("reasoning summaries stay free of tool dumps", () => {
  it("drops DSML, system lines, and raw tool JSON", () => {
    assert.equal(sanitizeReasoningText(RAW_DSML), "");
    assert.equal(
      sanitizeReasoningText(
        'System: you are a hidden planner.\nCheck the clock. {"toolName":"current_time","arguments":{"tz":"Europe/Dublin"}}',
      ),
      "Check the clock.",
    );
    assert.equal(
      sanitizeReasoningText('{"toolName":"web_search","arguments":{"query":"x"}}'),
      "",
    );
    assert.equal(sanitizeReasoningText("Draft a short answer."), "Draft a short answer.");
  });
});

describe("visible-text wiring", () => {
  it("markdown preprocess and activity both use the sanitizer", () => {
    const markdown = readFileSync(
      new URL("../components/assistant-ui/markdown-text.tsx", import.meta.url),
      "utf8",
    );
    const activity = readFileSync(
      new URL("./agent-activity.ts", import.meta.url),
      "utf8",
    );
    assert.match(markdown, /sanitizeVisibleAssistantText/);
    assert.match(markdown, /inlineTopLevelSvg/);
    assert.match(markdown, /preprocess/);
    assert.match(activity, /recoverToolCallsFromMarkup/);
  });
});

describe("probe replay (r3 rendering leaks)", () => {
  it("strips closed and unclosed Sol thinking tags from the visible answer", () => {
    const closed = sanitizeVisibleAssistantText(
      "Answer starts <thinking>hidden musing about the plan</thinking> and ends here.",
    );
    assert.equal(closed.includes("thinking"), false);
    assert.equal(closed.includes("hidden musing"), false);
    assert.match(closed, /Answer starts/);
    assert.match(closed, /and ends here\./);
    const unclosed = sanitizeVisibleAssistantText(
      "Answer starts <thinking>still musing",
    );
    assert.equal(unclosed.includes("thinking"), false);
    assert.equal(unclosed.includes("musing"), false);
    assert.match(unclosed, /Answer starts/);
  });

  it("strips the Sol sandbox_artifacts closing-tag residue", () => {
    const cleaned = sanitizeVisibleAssistantText(
      "The sheet is ready.\n[/sandbox_artifacts]\nAnything else?",
    );
    assert.equal(cleaned.includes("sandbox_artifacts"), false);
    assert.match(cleaned, /The sheet is ready\./);
    assert.match(cleaned, /Anything else\?/);
  });

  it("separates reasoning headings that ran together as **A****B**", () => {
    const glued = sanitizeVisibleAssistantText("**Gather prices****Compute the split**");
    assert.equal(glued.includes("****"), false);
    assert.match(glued, /\*\*Gather prices\*\*\n\n\*\*Compute the split\*\*/);
    const plain = sanitizeVisibleAssistantText("**Gather prices**\n\n**Compute the split**");
    assert.equal(plain, "**Gather prices**\n\n**Compute the split**");
  });

  it("renders a bare top-level Sol svg as an inline image, code fences untouched", () => {
    const svg = '<svg width="100" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="40" fill="#cream"/></svg>';
    const inline = inlineTopLevelSvg(`Chart:\n${svg}\nDone.`);
    assert.equal(inline.includes("<svg"), false);
    assert.match(inline, /^Chart:\n!\[chart\]\(data:image\/svg\+xml;base64,/);
    const match = inline.match(/base64,([^)]+)\)/);
    assert.ok(match);
    const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
    assert.equal(decoded, svg);
    const fenced = inlineTopLevelSvg("```\n" + svg + "\n```");
    assert.equal(fenced.includes("data:image"), false);
  });
});
