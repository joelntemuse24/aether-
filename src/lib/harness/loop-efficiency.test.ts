import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import {
  collectMessageText,
  collectSeedUnlockedToolNames,
} from "./loop-efficiency";

const GITHUB_TOOLS = [
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
];

describe("collectSeedUnlockedToolNames", () => {
  it("re-unlocks deferred tools already used in the thread", () => {
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
    assert.deepEqual(seeds, [
      TOOL_NAMES.githubGetRepo,
      TOOL_NAMES.githubListContents,
    ]);
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
