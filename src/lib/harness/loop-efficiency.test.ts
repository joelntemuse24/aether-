import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import {
  collectMessageText,
  collectSeedUnlockedToolNames,
  expandDeferredSuites,
  rankDeferredTools,
} from "./loop-efficiency";

const GITHUB_TOOLS = [
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
];

const ALL_DEFERRED = [
  TOOL_NAMES.memorySearch,
  TOOL_NAMES.memoryWrite,
  TOOL_NAMES.projectKnowledgeSearch,
  TOOL_NAMES.driveSearch,
  TOOL_NAMES.driveRead,
  ...GITHUB_TOOLS,
];

describe("collectSeedUnlockedToolNames", () => {
  it("re-unlocks deferred tools already used in the thread (suite expanded)", () => {
    const seeds = collectSeedUnlockedToolNames({
      messages: [
        {
          role: "assistant",
          parts: [
            { type: `tool-${TOOL_NAMES.githubGetRepo}` },
            { type: `tool-${TOOL_NAMES.githubListContents}` },
          ],
        },
      ],
      availableToolNames: GITHUB_TOOLS,
      mentionsGitHubRepo: false,
    });
    // Sibling suite expansion includes github_read_file once any github_* was used.
    assert.deepEqual(seeds, [...GITHUB_TOOLS]);
  });

  it("soft-seeds memory tools from intent text", () => {
    const seeds = collectSeedUnlockedToolNames({
      messages: [],
      availableToolNames: ALL_DEFERRED,
      mentionsGitHubRepo: false,
      intentText: "Please remember my preference for short answers",
    });
    assert.ok(seeds.includes(TOOL_NAMES.memorySearch));
    assert.ok(seeds.includes(TOOL_NAMES.memoryWrite));
  });

  it("unlocks the GitHub suite when the thread mentions a repo", () => {
    const seeds = collectSeedUnlockedToolNames({
      messages: [],
      availableToolNames: [
        ...GITHUB_TOOLS,
        TOOL_NAMES.memorySearch,
        TOOL_NAMES.driveSearch,
      ],
      mentionsGitHubRepo: true,
    });
    assert.deepEqual(seeds, [...GITHUB_TOOLS]);
  });

  it("returns empty when nothing qualifies", () => {
    const seeds = collectSeedUnlockedToolNames({
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "Continue from where you left off." }],
        },
      ],
      availableToolNames: GITHUB_TOOLS,
      mentionsGitHubRepo: false,
    });
    assert.deepEqual(seeds, []);
  });
});

describe("collectMessageText", () => {
  it("joins text parts across messages", () => {
    const text = collectMessageText([
      { parts: [{ type: "text", text: "See https://github.com/a/b" }] },
      { parts: [{ type: "text", text: "Continue…" }] },
    ]);
    assert.match(text, /github\.com\/a\/b/);
    assert.match(text, /Continue/);
  });
});

describe("expandDeferredSuites", () => {
  it("unlocks sibling memory tools together", () => {
    const expanded = expandDeferredSuites(
      [TOOL_NAMES.memorySearch],
      ALL_DEFERRED,
    );
    assert.deepEqual(expanded, [
      TOOL_NAMES.memorySearch,
      TOOL_NAMES.memoryWrite,
      TOOL_NAMES.projectKnowledgeSearch,
    ]);
  });

  it("unlocks the full GitHub suite from one match", () => {
    const expanded = expandDeferredSuites(
      [TOOL_NAMES.githubReadFile],
      ALL_DEFERRED,
    );
    assert.deepEqual(expanded, [...GITHUB_TOOLS]);
  });
});

describe("rankDeferredTools", () => {
  it("matches memory keywords and expands the suite", () => {
    const ranked = rankDeferredTools(ALL_DEFERRED, "remember my preference");
    const names = ranked.map((r) => r.name);
    assert.ok(names.includes(TOOL_NAMES.memorySearch));
    assert.ok(names.includes(TOOL_NAMES.memoryWrite));
  });

  it("unlocks Drive write tools from an @Drive mention", () => {
    const seeds = collectSeedUnlockedToolNames({
      messages: [],
      availableToolNames: [
        ...ALL_DEFERRED,
        TOOL_NAMES.driveUpload,
        TOOL_NAMES.driveWrite,
        TOOL_NAMES.gmailSearch,
        TOOL_NAMES.gmailCreateDraft,
      ],
      mentionsGitHubRepo: false,
      intentText: "Save the deck to @Drive",
    });
    assert.ok(seeds.includes(TOOL_NAMES.driveSearch));
    assert.ok(seeds.includes(TOOL_NAMES.driveUpload));
    assert.ok(seeds.includes(TOOL_NAMES.driveWrite));
  });

  it("unlocks Gmail tools from an @Gmail mention", () => {
    const seeds = collectSeedUnlockedToolNames({
      messages: [],
      availableToolNames: [
        TOOL_NAMES.gmailSearch,
        TOOL_NAMES.gmailRead,
        TOOL_NAMES.gmailSend,
        TOOL_NAMES.gmailCreateDraft,
        TOOL_NAMES.driveSearch,
      ],
      mentionsGitHubRepo: false,
      intentText: "Draft a note in @Gmail",
    });
    assert.ok(seeds.includes(TOOL_NAMES.gmailSearch));
    assert.ok(seeds.includes(TOOL_NAMES.gmailCreateDraft));
    assert.equal(seeds.includes(TOOL_NAMES.driveSearch), false);
  });

  it("falls back to Drive suite on soft domain tokens", () => {
    const ranked = rankDeferredTools(ALL_DEFERRED, "google drive files");
    const names = ranked.map((r) => r.name);
    assert.ok(names.includes(TOOL_NAMES.driveSearch));
    assert.ok(names.includes(TOOL_NAMES.driveRead));
  });

  it("falls back to GitHub suite from repo-ish phrasing", () => {
    const ranked = rankDeferredTools(ALL_DEFERRED, "inspect this github repo");
    const names = ranked.map((r) => r.name);
    for (const t of GITHUB_TOOLS) {
      assert.ok(names.includes(t), `expected ${t}`);
    }
  });
});
