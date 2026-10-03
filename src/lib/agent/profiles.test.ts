import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { modelProfile } from "@/lib/trueforge/providers";
import { agentModelProfile, agentProviderOptions } from "./profiles";

describe("agent model profiles", () => {
  it("sends GPT-5.6 effort none and refuses an empty Claude effort list", () => {
    const luna = agentModelProfile("buzz/gpt-5-6-luna");
    assert.equal(luna.family, "gpt");
    assert.equal(luna.reasoningEffortToSend, "none");
    assert.equal(luna.parallelToolCalls, true);
    assert.equal(luna.strictSchemas, true);
    assert.deepEqual(agentProviderOptions(luna), { openai: { reasoningEffort: "none" } });

    const claude = agentModelProfile("claude-sonnet-5");
    assert.equal(claude.family, "claude");
    assert.equal(claude.reasoningEfforts.length, 0);
    assert.equal(claude.reasoningEffortToSend, undefined);
    assert.equal(claude.reasoningEffortParam, null);
    assert.equal(agentProviderOptions(claude), undefined);
    assert.equal(JSON.stringify(agentProviderOptions(claude) ?? {}).includes("reasoning"), false);
    assert.equal(claude.maxOutputTokens, modelProfile("claude-sonnet-5").maxOutputTokens);
  });

  it("keeps unknown models sequential, non-strict, and small", () => {
    const unknown = agentModelProfile("mystery-model");
    assert.equal(unknown.family, "unknown");
    assert.equal(unknown.parallelToolCalls, false);
    assert.equal(unknown.strictSchemas, false);
    assert.ok(unknown.recommendedMaxTools <= 4);
    assert.equal(unknown.simplifySchemas, true);
    assert.equal(unknown.reasoningEffortToSend, undefined);
    assert.deepEqual(agentProviderOptions(unknown), { openai: { parallelToolCalls: false } });
  });

  it("marks DeepSeek as a DSML family and names the other vendors", () => {
    assert.equal(agentModelProfile("deepseek-chat").quirks.includes("leaked-dsml"), true);
    assert.equal(agentModelProfile("deepseek-chat").parallelToolCalls, false);
    assert.equal(agentModelProfile("google/gemini-2.5-pro").family, "gemini");
    assert.equal(agentModelProfile("moonshotai/kimi-k2").family, "kimi");
    assert.equal(agentModelProfile("qwen/qwen-2.5").family, "qwen");
    assert.equal(agentModelProfile("gpt-6-sol").reasoningEffortToSend, "low");
  });
});
