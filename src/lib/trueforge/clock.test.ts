import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { agentSystemPrompt } from "@/lib/agent/registry";
import { buildTrueForgeAgentSpec } from "./sessions";
import { normalizeTimeZone, trueforgeClockLine, trueforgeInstructions } from "./instructions";

const NOW = new Date("2026-10-03T12:00:00Z");
const MODELS = ["buzz/gpt-5-6-luna", "anthropic/claude-haiku-4-5", "buzz/gpt-6-astra"] as const;

describe("hosted clock", () => {
  it("puts today's date and the user timezone on every picker model", () => {
    const clock = trueforgeClockLine(NOW, "America/New_York");
    assert.match(clock, /Today's date \(America\/New_York\): Saturday, 3 October 2026/);
    assert.match(clock, /User timezone \(America\/New_York\)/);
    assert.match(clock, /Current time \(UTC\)/);
    assert.match(clock, /Europe\/Dublin/);
    const instructions = trueforgeInstructions(TOOLS_SYSTEM_PROMPT, NOW, {
      timeZone: "America/New_York",
    });
    assert.equal(instructions.startsWith(clock), true);
    for (const modelName of MODELS) {
      const spec = buildTrueForgeAgentSpec({
        modelName,
        instructions,
        mcp: null,
        sandboxEnabled: false,
      });
      assert.equal(spec.spec.instructions, instructions);
      assert.equal(spec.spec.model.name, modelName);
    }
    const native = agentSystemPrompt({
      definitions: [],
      now: NOW,
      timeZone: "America/New_York",
      depth: "shallow",
    });
    assert.match(native, /Saturday, 3 October 2026/);
    assert.match(native, /America\/New_York/);
  });

  it("keeps Dublin when the browser zone is missing or invalid", () => {
    assert.equal(normalizeTimeZone("Not/AZone"), null);
    assert.equal(normalizeTimeZone("UTC; rm -rf"), null);
    assert.equal(normalizeTimeZone("../etc/passwd"), null);
    const clock = trueforgeClockLine(NOW, "Not/AZone");
    assert.match(clock, /Today's date \(Europe\/Dublin\): Saturday, 3 October 2026/);
    assert.equal(clock.includes("Not/AZone"), false);
    assert.match(clock, /Current time \(UTC\)/);
  });

  it("sends the browser timezone on the hosted turn", () => {
    const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
    const client = readFileSync(new URL("../../providers/runtime-provider.tsx", import.meta.url), "utf8");
    const stream = readFileSync(new URL("./chat-stream.ts", import.meta.url), "utf8");
    assert.match(client, /resolvedOptions\(\)\.timeZone/);
    assert.match(route, /body\.timeZone/);
    assert.match(stream, /timeZone: input\.timeZone/);
  });
});
