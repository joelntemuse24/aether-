import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderChatMath } from "./render-math";
import { sanitizeVisibleAssistantText } from "./visible-chat-text";

describe("render chat math", () => {
  it("renders the Luna fee arithmetic instead of raw commands", () => {
    const leaked = "(0.48 \\times 2% of notional) and [ 1{,}476 \\times $0.0208 ]";
    const rendered = renderChatMath(leaked);
    assert.match(rendered, /0\.48 × 2% of notional/);
    assert.match(rendered, /1,476 × \$0\.0208/);
    assert.equal(rendered.includes("\\times"), false);
    assert.equal(rendered.includes("{,}"), false);
  });

  it("renders delimited math before markdown can strip the fences", () => {
    const delimited =
      "Edge \\(0.48 \\times 2\\%\\). Value \\[ 1{,}476 \\times \\$0.0208 \\].";
    const rendered = renderChatMath(delimited);
    assert.match(rendered, /Edge 0\.48 × 2%/);
    assert.match(rendered, /Value 1,476 × \$0\.0208/);
    assert.equal(rendered.includes("\\["), false);
    assert.equal(rendered.includes("\\("), false);
    assert.equal(sanitizeVisibleAssistantText(delimited).includes("\\times"), true);
  });

  it("leaves commands inside code fences", () => {
    const fenced = "```\n0.48 \\times 2\n```\nFee is \\(0.48 \\times 2\\%\\).";
    const rendered = renderChatMath(fenced);
    assert.match(rendered, /0\.48 \\times 2/);
    assert.match(rendered, /Fee is 0\.48 × 2%/);
  });
});
