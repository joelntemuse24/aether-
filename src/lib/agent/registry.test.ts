import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { agentModelProfile } from "./profiles";
import {
  agentSystemPrompt,
  agentToolNeedsConfirmation,
  providerToolDefinitions,
  type AgentToolDefinition,
} from "./registry";

const search: AgentToolDefinition = {
  name: "web_search",
  description: "Search the public web.",
  inputSchema: z.object({ q: z.string().min(2) }),
  timeoutMs: 1000,
  risk: "read",
  runsOn: "vm",
  requiresAuth: false,
};

const memory: AgentToolDefinition = {
  name: "memory_write",
  description: "Save a memory.",
  inputSchema: z.object({ note: z.string() }),
  timeoutMs: 1000,
  risk: "write",
  runsOn: "vercel",
  requiresAuth: true,
};

describe("agent tool registry", () => {
  it("names only attached tools and adds one line per missing group", () => {
    const prompt = agentSystemPrompt({
      definitions: [search],
      unavailableGroups: ["account", "sandbox"],
      now: new Date("2026-01-02T15:04:05Z"),
      depth: "standard",
    });
    assert.match(prompt, /web_search/);
    assert.match(prompt, /Current time \(UTC\)/);
    assert.match(prompt, /Search before asserting current facts/);
    assert.match(prompt, /Account tools are unavailable this turn/);
    assert.match(prompt, /sandbox is unavailable this turn/i);
    assert.equal(prompt.includes("memory_search"), false);
    assert.equal(prompt.includes("fetch_url"), false);
    assert.equal(prompt.includes("sandbox_exec"), false);
    assert.match(prompt, /Search budget: 2/);
  });

  it("does not name tools when none are attached", () => {
    const prompt = agentSystemPrompt({ definitions: [], depth: "shallow" });
    assert.match(prompt, /No tools are attached/);
    assert.equal(prompt.includes("web_search"), false);
    assert.match(prompt, /Step budget: 2/);
  });

  it("simplifies unknown-model schemas and keeps GPT strict", () => {
    const defs = [search, memory, { ...search, name: "fetch_url" }, { ...search, name: "browse_page" }, { ...memory, name: "drive_read", risk: "read" as const }];
    const unknown = providerToolDefinitions(defs, agentModelProfile("mystery-model"));
    assert.equal(unknown.length, 4);
    assert.equal(unknown.some((tool) => tool.name === "drive_read"), false);
    assert.equal(unknown[0]?.strict, false);
    assert.equal(JSON.stringify(unknown[0]?.parameters).includes("minLength"), false);
    assert.equal(JSON.stringify(unknown[0]?.parameters).includes("$schema"), false);

    const gpt = providerToolDefinitions([search], agentModelProfile("gpt-5.6-luna"));
    assert.equal(gpt[0]?.strict, true);
    assert.equal(JSON.stringify(gpt[0]?.parameters).includes("minLength"), true);
  });

  it("confirms writes in Ask mode and reads without a card", () => {
    assert.equal(
      agentToolNeedsConfirmation({ name: "web_search", risk: "read", mode: "ask" }),
      false,
    );
    assert.equal(
      agentToolNeedsConfirmation({ name: "memory_write", risk: "write", mode: "ask" }),
      true,
    );
    assert.equal(
      agentToolNeedsConfirmation({ name: "memory_write", risk: "write", mode: "auto" }),
      false,
    );
    assert.equal(
      agentToolNeedsConfirmation({ name: "sandbox_exec", risk: "destructive", mode: "auto" }),
      true,
    );
    assert.equal(
      agentToolNeedsConfirmation({
        name: "memory_write",
        risk: "write",
        mode: "ask",
        skipGate: true,
      }),
      false,
    );
    assert.equal(
      agentToolNeedsConfirmation({
        name: "create_artifact",
        risk: "write",
        mode: "ask",
      }),
      false,
    );
  });
});
