import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOSTED_IP_LIMIT,
  HOSTED_SESSION_LIMIT,
  anonDailyCap,
  browserSafeChatError,
  checkHostedTurn,
  clientIp,
  hostedSessionOwner,
  readOrCreateGuestId,
  redactLoggedError,
  resetHostedLimits,
} from "./hosted-limit";
import { toolContextKey } from "./tool-context";
import { trueforgeSessionCacheKey, warnMissingToolContextKey } from "./sessions";

describe("hosted chat limits", { concurrency: 1 }, () => {
  it("lets a guest send, then stops the next burst from the same IP", () => {
    resetHostedLimits();
    const now = 1_000;
    for (let i = 0; i < HOSTED_IP_LIMIT; i++) {
      const decision = checkHostedTurn({
        ip: "203.0.113.8",
        sessionKey: `guest:one\nchat-${i}`,
        anonymous: true,
        hasOpenRouterKey: false,
        now,
        dailyCap: 1_000,
      });
      assert.equal(decision.ok, true);
    }
    const blocked = checkHostedTurn({
      ip: "203.0.113.8",
      sessionKey: "guest:one\nother",
      anonymous: true,
      hasOpenRouterKey: false,
      now,
      dailyCap: 1_000,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.status, 429);
      assert.match(blocked.error, /network/);
      assert.match(blocked.requestId, /^[0-9a-f-]{36}$/);
      assert.equal(blocked.error.includes("203.0.113.8"), false);
    }
  });

  it("caps one chat without blocking a different chat on the same IP", () => {
    resetHostedLimits();
    const now = 5_000;
    for (let i = 0; i < HOSTED_SESSION_LIMIT; i++) {
      assert.equal(
        checkHostedTurn({
          ip: "198.51.100.4",
          sessionKey: "guest:a\nchat-a",
          anonymous: false,
          hasOpenRouterKey: false,
          now,
          dailyCap: 1_000,
        }).ok,
        true,
      );
    }
    const same = checkHostedTurn({
      ip: "198.51.100.4",
      sessionKey: "guest:a\nchat-a",
      anonymous: false,
      hasOpenRouterKey: false,
      now,
      dailyCap: 1_000,
    });
    assert.equal(same.ok, false);
    const other = checkHostedTurn({
      ip: "198.51.100.4",
      sessionKey: "guest:a\nchat-b",
      anonymous: false,
      hasOpenRouterKey: false,
      now,
      dailyCap: 1_000,
    });
    assert.equal(other.ok, true);
  });

  it("does not spend the anonymous daily cap when the user sent an OpenRouter key", () => {
    resetHostedLimits();
    const now = 9_000;
    const capped = checkHostedTurn({
      ip: "192.0.2.9",
      sessionKey: "guest:anon\nchat",
      anonymous: true,
      hasOpenRouterKey: false,
      now,
      dailyCap: 1,
    });
    assert.equal(capped.ok, true);
    const second = checkHostedTurn({
      ip: "192.0.2.9",
      sessionKey: "guest:anon\nchat",
      anonymous: true,
      hasOpenRouterKey: false,
      now,
      dailyCap: 1,
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.error, /daily/);
    const exempt = checkHostedTurn({
      ip: "192.0.2.9",
      sessionKey: "guest:anon\nchat",
      anonymous: true,
      hasOpenRouterKey: true,
      now,
      dailyCap: 1,
    });
    assert.equal(exempt.ok, true);
    assert.equal(
      anonDailyCap({ AETHER_HOSTED_ANON_DAILY_CAP: "40" } as unknown as NodeJS.ProcessEnv),
      40,
    );
  });

  it("scopes a session to the signed-in user or the guest cookie", () => {
    assert.equal(hostedSessionOwner({ userId: "user-1", guestId: "g" }), "user:user-1");
    assert.equal(hostedSessionOwner({ userId: null, guestId: "guest-9" }), "guest:guest-9");
    assert.notEqual(
      trueforgeSessionCacheKey("user:user-1", "chat"),
      trueforgeSessionCacheKey("guest:guest-9", "chat"),
    );
    const created = readOrCreateGuestId(null);
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.match(created.setCookie ?? "", /aether\.guest=/);
    assert.equal(readOrCreateGuestId(`aether.guest=${created.id}`).setCookie, null);
    assert.equal(clientIp({ headers: { get: (name) => (name === "x-forwarded-for" ? "203.0.113.1, 10.0.0.1" : null) } }), "203.0.113.1");
  });

  it("hides raw provider errors and does not reuse the VM transport token in production", () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      const safe = browserSafeChatError(new Error("upstream said sk-or-secret and Bearer abcdef"));
      assert.equal(safe.error, "The request failed. Try again.");
      assert.equal(safe.error.includes("sk-or-secret"), false);
      assert.match(safe.requestId, /^[0-9a-f-]{36}$/);
      assert.match(logged.join("\n"), /\[redacted\]/);
      assert.equal(logged.join("\n").includes("sk-or-secret"), false);
      assert.equal(redactLoggedError("Bearer tok"), "Bearer [redacted]");
      const env = {
        NODE_ENV: "production",
        AETHER_TRUEFORGE_TOKEN: "vm-token",
        AETHER_TOOL_CONTEXT_KEY: "vercel-only",
      } as NodeJS.ProcessEnv;
      assert.equal(toolContextKey(env), "vercel-only");
      delete env.AETHER_TOOL_CONTEXT_KEY;
      assert.equal(toolContextKey(env), "");
      assert.equal(
        toolContextKey({ NODE_ENV: "development", AETHER_TRUEFORGE_TOKEN: "vm-token" } as NodeJS.ProcessEnv),
        "vm-token",
      );
      const missing = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
      assert.equal(warnMissingToolContextKey(missing), true);
      assert.equal(warnMissingToolContextKey(missing), true);
      assert.equal(logged.filter((line) => line.includes("AETHER_TOOL_CONTEXT_KEY")).length, 1);
      assert.match(logged.join("\n"), /Vercel only/);
      assert.match(logged.join("\n"), /not on the VM/);
    } finally {
      console.error = original;
    }
  });
});
