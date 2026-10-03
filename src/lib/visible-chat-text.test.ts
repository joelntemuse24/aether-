import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isHiddenToolMarkup,
  looksLikeRawToolMarkup,
  recoverToolCallsFromMarkup,
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
    assert.match(markdown, /preprocess/);
    assert.match(activity, /recoverToolCallsFromMarkup/);
  });
});
