import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { budgetForDepth } from "./budgets";
import {
  PLAYBOOK_IDS,
  playbooksSystemAddendum,
  resolvePlaybooks,
} from "./playbooks";
import { shouldConfirmAetherTool } from "../hermes/tool-approval";

describe("four chat playbooks", () => {
  it("exposes exactly research, write-doc, slides, and sheet", () => {
    assert.deepEqual([...PLAYBOOK_IDS], ["research", "write-doc", "slides", "sheet"]);
  });

  it("loads research when the user asks to search or research", () => {
    const ids = resolvePlaybooks({
      text: "Search for anything and then recall the number.",
      intent: "chat",
    }).map((p) => p.id);
    assert.ok(ids.includes("research"));
    assert.equal(ids.includes("slides"), false);
  });

  it("loads write-doc for document drafts", () => {
    const ids = resolvePlaybooks({
      text: "Write a two-page briefing document on this.",
      intent: "write",
    }).map((p) => p.id);
    assert.ok(ids.includes("write-doc"));
  });

  it("loads slides for a deck / presentation", () => {
    const ids = resolvePlaybooks({
      text: "Make a 6-slide deck on the launch plan",
    }).map((p) => p.id);
    assert.ok(ids.includes("slides"));
  });

  it("loads sheet for a spreadsheet / table", () => {
    const ids = resolvePlaybooks({
      text: "Build a spreadsheet of Q3 costs",
    }).map((p) => p.id);
    assert.ok(ids.includes("sheet"));
  });

  it("stays empty for a tiny unrelated chat turn", () => {
    assert.deepEqual(resolvePlaybooks({ text: "Thanks", intent: "chat" }), []);
  });

  it("addendum names the playbook and the tools it should use", () => {
    const playbooks = resolvePlaybooks({
      text: "Research this, write a doc, make slides, and a sheet",
      intent: "research",
    });
    const block = playbooksSystemAddendum(playbooks);
    assert.match(block, /## Playbooks/);
    assert.match(block, /research/i);
    assert.match(block, /write-doc|document/i);
    assert.match(block, /slides/i);
    assert.match(block, /sheet/i);
    assert.match(block, /web_search/);
    assert.match(block, /create_artifact/);
  });

  it("returns empty addendum when no playbook applies", () => {
    assert.equal(playbooksSystemAddendum([]), "");
  });
});

describe("playbooks stay addenda — budgets and approval unchanged", () => {
  it("keeps shallow / standard / deep step budgets", () => {
    assert.equal(budgetForDepth("shallow").maxSteps, 2);
    assert.equal(budgetForDepth("standard").maxSteps, 8);
    assert.equal(budgetForDepth("deep").maxSteps, 16);
  });

  it("still confirms destructive connector writes in ask mode", () => {
    assert.equal(
      shouldConfirmAetherTool({
        name: "request_confirmation",
        mode: "ask",
      }),
      true,
    );
    assert.equal(
      shouldConfirmAetherTool({
        name: "browser_act",
        mode: "auto",
        args: { action: "submit" },
      }),
      true,
    );
  });
});

describe("chat route loads playbooks as system addenda", () => {
  it("imports resolvePlaybooks and injects the addendum", () => {
    const turn = readFileSync(new URL("../chat-turn.ts", import.meta.url), "utf8");
    assert.match(turn, /resolvePlaybooks/);
    assert.match(turn, /playbooksSystemAddendum/);
  });
});
