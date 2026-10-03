import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentModelProfile } from "./profiles";
import { agentSystemPrompt, agentToolGroup, providerToolDefinitions } from "./registry";
import {
  definitionsForAllowList,
  nativeToolNames,
  NATIVE_ACCOUNT_TOOL_NAMES,
  NATIVE_SANDBOX_TOOL_NAMES,
  NATIVE_WEB_TOOL_NAMES,
} from "./catalog";

describe("native tool catalog", () => {
  it("attaches web tools and the clock, and account tools only when asked", () => {
    const guest = nativeToolNames(false);
    assert.deepEqual(guest, [...NATIVE_WEB_TOOL_NAMES]);
    assert.equal(guest.includes("memory_write"), false);
    assert.equal(guest.includes("github_merge_pull_request"), false);
    const signedIn = nativeToolNames(true);
    for (const name of NATIVE_ACCOUNT_TOOL_NAMES) assert.equal(signedIn.includes(name), true);
    assert.equal(signedIn.includes("gmail_send"), false);
    assert.equal(signedIn.includes("github_merge_pull_request"), false);
    assert.equal(signedIn.includes("sandbox_exec"), false);
    const withSandbox = nativeToolNames(true, true);
    assert.deepEqual(withSandbox.slice(0, 6), [...NATIVE_WEB_TOOL_NAMES, ...NATIVE_SANDBOX_TOOL_NAMES]);
    assert.equal(withSandbox.at(-1), "github_list_issues");
    assert.equal(withSandbox.length, 16);
  });

  it("drops names this engine cannot run", () => {
    const definitions = definitionsForAllowList([
      "web_search",
      "gmail_send",
      "sandbox_exec",
      "memory_search",
    ]);
    assert.deepEqual(
      definitions.map((definition) => definition.name),
      ["web_search", "sandbox_exec", "memory_search"],
    );
    assert.equal(definitions[0]?.runsOn, "vm");
    assert.equal(definitions[1]?.runsOn, "vm");
    assert.equal(definitions[2]?.runsOn, "vercel");
    assert.equal(agentToolGroup("current_time"), "web");
  });

  it("names only the attached native tools", () => {
    const guest = definitionsForAllowList(nativeToolNames(false));
    const prompt = agentSystemPrompt({
      definitions: guest,
      unavailableGroups: ["account", "sandbox"],
      depth: "standard",
    });
    assert.match(prompt, /web_search/);
    assert.match(prompt, /current_time/);
    assert.match(prompt, /Account tools are unavailable/);
    assert.equal(prompt.includes("memory_search"), false);
    assert.equal(prompt.includes("gmail_send"), false);
  });

  it("keeps the hosted model under its tool cap", () => {
    const all = definitionsForAllowList(nativeToolNames(true));
    const luna = providerToolDefinitions(all, agentModelProfile("gpt-5.6-luna"));
    assert.equal(luna.length, all.length);
    assert.equal(luna.length <= 16, true);
    const withSandbox = definitionsForAllowList(nativeToolNames(true, true));
    const lunaSandbox = providerToolDefinitions(withSandbox, agentModelProfile("gpt-5.6-luna"));
    assert.equal(lunaSandbox.length, 16);
    assert.equal(lunaSandbox.some((tool) => tool.name === "sandbox_exec"), true);
    const gemini = providerToolDefinitions(withSandbox, agentModelProfile("google/gemini-2.5-pro"));
    assert.equal(gemini.length, 12);
    assert.equal(gemini.some((tool) => tool.name === "sandbox_exec"), true);
    assert.equal(gemini.some((tool) => tool.name === "drive_read"), true);
    assert.equal(gemini.some((tool) => tool.name === "github_get_repo"), false);
    const unknown = providerToolDefinitions(withSandbox, agentModelProfile("mystery-model"));
    assert.equal(unknown.length, 4);
    assert.equal(unknown.some((tool) => tool.name === "sandbox_exec"), false);
  });
});
