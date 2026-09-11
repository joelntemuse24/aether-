import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  scheduledRunMustConfirmBeforeSend,
  scheduledSendIsBlocked,
} from "./policy";

describe("scheduled confirm-before-send", () => {
  it("never auto-sends email or chat delivery", () => {
    for (const delivery of ["email", "inbox"] as const) {
      assert.equal(scheduledRunMustConfirmBeforeSend({ delivery }), true);
      assert.equal(
        scheduledSendIsBlocked({ delivery, sendConfirmed: false }),
        true,
      );
    }
  });

  it("still blocks send in Auto and after the schedule itself was created", () => {
    assert.equal(
      scheduledSendIsBlocked({
        delivery: "email",
        sendConfirmed: false,
        scheduleAlreadyApproved: true,
        mode: "auto",
      }),
      true,
    );
  });

  it("allows send only after an explicit per-run confirmation", () => {
    assert.equal(
      scheduledSendIsBlocked({
        delivery: "email",
        sendConfirmed: true,
      }),
      false,
    );
  });
});
