import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_AGENT_TASK_ID,
  isTriggerChatConfigured,
  resolveChatTransportMode,
} from "./config";

describe("Trigger chat feature flag", () => {
  it("is off when secret and project id are missing", () => {
    assert.equal(isTriggerChatConfigured({}), false);
    assert.equal(isTriggerChatConfigured({ TRIGGER_SECRET_KEY: "tr_dev_x" }), false);
    assert.equal(isTriggerChatConfigured({ TRIGGER_PROJECT_ID: "proj_x" }), false);
    assert.equal(
      isTriggerChatConfigured({
        TRIGGER_SECRET_KEY: "   ",
        TRIGGER_PROJECT_ID: "proj_x",
      }),
      false,
    );
  });

  it("is on only when both TRIGGER_SECRET_KEY and TRIGGER_PROJECT_ID are set", () => {
    assert.equal(
      isTriggerChatConfigured({
        TRIGGER_SECRET_KEY: "tr_dev_x",
        TRIGGER_PROJECT_ID: "proj_x",
      }),
      true,
    );
  });

  it("selects durable transport when configured and request fallback otherwise", () => {
    assert.equal(resolveChatTransportMode({}), "request");
    assert.equal(
      resolveChatTransportMode({
        TRIGGER_SECRET_KEY: "tr_dev_x",
        TRIGGER_PROJECT_ID: "proj_x",
      }),
      "durable",
    );
  });

  it("uses a stable agent task id that is not a vendor brand in UI copy", () => {
    assert.equal(CHAT_AGENT_TASK_ID, "chat.agent");
    assert.doesNotMatch(CHAT_AGENT_TASK_ID, /trigger|vercel|hermes|buzz|railway|openrouter/i);
  });
});
