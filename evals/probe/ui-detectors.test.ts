import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectUiFailures,
  fixtureUiSnapshot,
  isWelcomePhrase,
} from "./ui-detectors";

describe("probe UI detectors", () => {
  it("recognizes the wired welcome phrases", () => {
    assert.equal(isWelcomePhrase("Howzit?"), true);
    assert.equal(isWelcomePhrase("we uup"), true);
    assert.equal(isWelcomePhrase("in the trenches?"), true);
    assert.equal(isWelcomePhrase("Hello"), false);
  });

  it("passes a recovered thread with Worked for Ns", () => {
    assert.deepEqual(detectUiFailures(fixtureUiSnapshot()), []);
  });

  it("flags blank Howzit after send", () => {
    const vanished = detectUiFailures(
      fixtureUiSnapshot({
        welcomeVisible: true,
        welcomePhrase: "Howzit?",
        userMessageCount: 0,
        assistantVisibleText: "",
        sawWorkingDuringTurn: false,
        workedForVisible: false,
        timedOut: true,
        bodyText: "Howzit?",
      }),
    );
    assert.equal(vanished.some((f) => f.code === "blank_howzit"), true);

    const stuckWelcome = detectUiFailures(
      fixtureUiSnapshot({
        welcomeVisible: true,
        welcomePhrase: "Howzit?",
        userMessageCount: 1,
        assistantVisibleText: "",
        workedForVisible: false,
        bodyText: "Howzit?",
      }),
    );
    assert.equal(stuckWelcome.some((f) => f.code === "blank_howzit"), true);
  });

  it("flags duplicate Working strips", () => {
    const findings = detectUiFailures(
      fixtureUiSnapshot({ workingStripCount: 2, bodyText: "Working\nWorking" }),
    );
    assert.equal(findings.some((f) => f.code === "duplicate_working"), true);
  });

  it("flags raw DSML in visible chrome", () => {
    const dsml = '<|DSML| tool_search query="current time Dublin Ireland">';
    const findings = detectUiFailures(
      fixtureUiSnapshot({ assistantVisibleText: dsml, bodyText: dsml }),
    );
    assert.equal(findings.some((f) => f.code === "raw_tool_markup"), true);
  });

  it("flags a leaked Missing Authentication header in the thread", () => {
    const findings = detectUiFailures(
      fixtureUiSnapshot({
        assistantVisibleText: "Missing Authentication header",
        bodyText: "Worked for 5s\nMissing Authentication header",
      }),
    );
    assert.equal(findings.some((f) => f.code === "http_error"), true);
  });

  it("flags Application error / client exceptions", () => {
    const app = detectUiFailures(
      fixtureUiSnapshot({
        applicationErrorVisible: true,
        bodyText: "Application error: a client-side exception has occurred",
      }),
    );
    assert.equal(app.some((f) => f.code === "application_error"), true);

    const ex = detectUiFailures(
      fixtureUiSnapshot({ pageError: "TypeError: Cannot read properties of null" }),
    );
    assert.equal(ex.some((f) => f.code === "client_exception"), true);
  });

  it("flags stuck Stop after timeout", () => {
    const findings = detectUiFailures(
      fixtureUiSnapshot({
        stopVisible: true,
        sendVisible: false,
        timedOut: true,
        finished: false,
        assistantVisibleText: "",
        workedForVisible: false,
      }),
    );
    assert.equal(findings.some((f) => f.code === "stuck_stop"), true);
  });

  it("flags missing Worked for Ns after a Working turn", () => {
    const findings = detectUiFailures(
      fixtureUiSnapshot({
        sawWorkingDuringTurn: true,
        workedForVisible: false,
        finished: true,
        stopVisible: false,
        bodyText: "Hello",
      }),
    );
    assert.equal(findings.some((f) => f.code === "missing_worked_for"), true);
  });

  it("flags This step failed without recovery, but not a recovered answer", () => {
    const noRecovery = detectUiFailures(
      fixtureUiSnapshot({
        stepFailedVisible: true,
        assistantVisibleText: "",
        workedForVisible: false,
        sawWorkingDuringTurn: false,
        bodyText: "This step failed",
      }),
    );
    assert.equal(
      noRecovery.some((f) => f.code === "step_failed_no_recovery"),
      true,
    );

    const recovered = detectUiFailures(
      fixtureUiSnapshot({
        stepFailedVisible: true,
        assistantVisibleText: "Here is the deck anyway.",
        bodyText: "This step failed\nHere is the deck anyway.",
      }),
    );
    assert.equal(
      recovered.some((f) => f.code === "step_failed_no_recovery"),
      false,
    );
    assert.equal(recovered.some((f) => f.code === "step_failed"), true);
  });
});
