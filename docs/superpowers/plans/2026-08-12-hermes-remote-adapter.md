# Hermes Remote Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin server-side Hermes proxy for hosted chat that preserves the browser UIMessage stream contract while Hermes owns the agent loop.

**Architecture:** When `HERMES_BASE_URL` + `HERMES_API_KEY` are set, hosted `/api/chat` builds the existing system/context blocks, converts UIMessages to OpenAI chat messages, streams Hermes `/v1/chat/completions`, and bridges SSE (including `hermes.tool.progress`) into AI SDK UIMessage chunks. BYOK keeps the existing `streamText` path.

**Tech Stack:** Next.js 15 App Router, AI SDK `createUIMessageStream` / `createUIMessageStreamResponse`, native `fetch` + SSE parse, Vitest-style node:test or existing test runner if present.

## Global Constraints

- Browser never receives `HERMES_API_KEY` or Hermes URL.
- Do not weaken `src/lib/connectors/url-safety.ts`.
- Preserve assistant-ui / `AssistantChatTransport` → `/api/chat` request shape.
- Hosted + Hermes only in Phase 1; BYOK unchanged.
- Hermes fork/deploy is documented, not vendored into this repo.

---

### Task 1: Hermes config + session headers

**Files:**
- Create: `src/lib/hermes/config.ts`
- Create: `src/lib/hermes/config.test.ts`
- Modify: `.env.example`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `isHermesConfigured()`, `getHermesConfig()`, `buildHermesSessionKey({ userId, conversationId })`, `normalizeHermesBaseUrl(url)`

- [ ] **Step 1: Write failing tests for config helpers**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHermesSessionKey,
  normalizeHermesBaseUrl,
} from "./config";

describe("hermes config", () => {
  it("normalizes base URL without trailing slash or /v1", () => {
    assert.equal(
      normalizeHermesBaseUrl("https://h.example/v1/"),
      "https://h.example",
    );
  });

  it("builds scoped session keys under 256 chars", () => {
    const key = buildHermesSessionKey({
      userId: "user-1",
      conversationId: "c1",
    });
    assert.equal(key, "aether:user:user-1");
    assert.ok(key.length <= 256);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/hermes/config.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: Implement config**

```ts
export type HermesConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export function normalizeHermesBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (u.endsWith("/v1")) u = u.slice(0, -3).replace(/\/+$/, "");
  return u;
}

export function isHermesConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const enabled = env.HERMES_ENABLED;
  if (enabled === "0" || enabled === "false") return false;
  const url = env.HERMES_BASE_URL?.trim();
  const key = env.HERMES_API_KEY?.trim();
  if (!url || !key) return false;
  if (enabled === "1" || enabled === "true") return true;
  return true; // URL+key implies enabled
}

export function getHermesConfig(
  env: NodeJS.ProcessEnv = process.env,
): HermesConfig | null {
  if (!isHermesConfigured(env)) return null;
  return {
    baseUrl: normalizeHermesBaseUrl(env.HERMES_BASE_URL!),
    apiKey: env.HERMES_API_KEY!.trim(),
    modelName: env.HERMES_MODEL_NAME?.trim() || "hermes-agent",
  };
}

export function buildHermesSessionKey(input: {
  userId: string | null;
  conversationId: string | null;
}): string {
  if (input.userId) {
    return `aether:user:${input.userId}`.slice(0, 256);
  }
  const conv = input.conversationId || "anon";
  return `aether:anon:${conv}`.slice(0, 256);
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/hermes/config.ts src/lib/hermes/config.test.ts .env.example AGENTS.md
git commit -m "feat(hermes): add remote gateway config helpers"
```

---

### Task 2: UIMessage → OpenAI chat messages

**Files:**
- Create: `src/lib/hermes/messages.ts`
- Create: `src/lib/hermes/messages.test.ts`

**Interfaces:**
- Consumes: AI SDK `UIMessage`
- Produces: `toOpenAIChatMessages(messages, system): OpenAIChatMessage[]`

- [ ] **Step 1: Write failing tests** for text-only, multimodal image, system prepend

- [ ] **Step 2: Implement converter** (skip tool UI parts; extract text; map image data URLs)

- [ ] **Step 3: Tests pass; commit**

```bash
git commit -m "feat(hermes): convert UIMessages to OpenAI chat messages"
```

---

### Task 3: SSE stream bridge

**Files:**
- Create: `src/lib/hermes/sse.ts` — parse OpenAI SSE + named events
- Create: `src/lib/hermes/stream-bridge.ts` — bridge into `createUIMessageStream`
- Create: `src/lib/hermes/stream-bridge.test.ts`

**Interfaces:**
- Produces: `bridgeHermesChatCompletionToUIMessageResponse(args): Response`
- Consumes: `ReadableStream<Uint8Array>` from Hermes fetch body

- [ ] **Step 1: Test parse of content deltas + `hermes.tool.progress` + `[DONE]`**

- [ ] **Step 2: Implement bridge writing `text-*` and `tool-*` with `providerExecuted: true`**

- [ ] **Step 3: Tests pass; commit**

```bash
git commit -m "feat(hermes): bridge OpenAI SSE to UIMessage stream"
```

---

### Task 4: Hermes client + chat route branch

**Files:**
- Create: `src/lib/hermes/client.ts`
- Create: `src/lib/hermes/proxy-chat.ts` — assemble request + return Response
- Modify: `src/app/api/chat/route.ts` — early branch after system assembly when Hermes + hosted

**Interfaces:**
- Produces: `proxyChatToHermes({...}): Promise<Response>`
- Consumes: config, messages converter, stream bridge

- [ ] **Step 1: Implement `streamHermesChatCompletions` fetch with abort + session headers**

- [ ] **Step 2: Wire `/api/chat`:** if `hosted && isHermesConfigured()` skip `streamText` tool loop and return `proxyChatToHermes(...)`

- [ ] **Step 3: Manual or mock integration test with canned SSE**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(hermes): proxy hosted /api/chat to remote Hermes"
```

---

### Task 5: Docs + deploy example

**Files:**
- Modify: `docs/TDD.md` (short section pointing at Hermes adapter)
- Create: `deploy/hermes/README.md` + `deploy/hermes/docker-compose.example.yml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Document env vars, tenancy headers, BYOK fallback**

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: Hermes remote backend operator guide"
```

---

### Task 6: Verification

- [ ] Run: `npx tsx --test src/lib/hermes/*.test.ts`
- [ ] Run: `npm run lint`
- [ ] Run: `npm run build` (if env allows)
- [ ] Push branch; open/update PR
