import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectorMentionAddendum,
  filterMentionOptions,
  insertAppMention,
  mentionQueryAtCaret,
  parseAppMentions,
} from "./app-mentions";

describe("parseAppMentions", () => {
  it("finds @Drive @GitHub @Gmail in composer text", () => {
    assert.deepEqual(
      parseAppMentions("Save the deck to @Drive and mail it via @Gmail"),
      ["drive", "gmail"],
    );
    assert.deepEqual(parseAppMentions("Look at @GitHub for the repo"), ["github"]);
    assert.deepEqual(parseAppMentions("@drive @GITHUB @gmail"), [
      "drive",
      "github",
      "gmail",
    ]);
  });

  it("ignores email addresses and unknown tokens", () => {
    assert.deepEqual(parseAppMentions("email me@Drive.com and @Slack"), []);
    assert.deepEqual(parseAppMentions("no mentions here"), []);
  });
});

describe("mentionQueryAtCaret", () => {
  it("detects an in-progress @ token", () => {
    assert.deepEqual(mentionQueryAtCaret("hello @Dr"), {
      query: "Dr",
      start: 6,
      end: 9,
    });
    assert.deepEqual(mentionQueryAtCaret("@"), {
      query: "",
      start: 0,
      end: 1,
    });
    assert.equal(mentionQueryAtCaret("hello Drive"), null);
  });
});

describe("filterMentionOptions / insertAppMention", () => {
  it("filters by prefix and inserts a token", () => {
    assert.deepEqual(
      filterMentionOptions("g").map((o) => o.id),
      ["github", "gmail"],
    );
    assert.deepEqual(filterMentionOptions("gi").map((o) => o.id), ["github"]);
    const inserted = insertAppMention("Save to @Dr", { ...filterMentionOptions("dr")[0]! });
    assert.equal(inserted.text, "Save to @Drive ");
  });
});

describe("connectorMentionAddendum", () => {
  it("forces the mentioned tool family when connected", () => {
    const text = connectorMentionAddendum(["drive", "gmail"], {
      hasDrive: true,
      hasGmail: true,
    });
    assert.match(text, /MUST use that tool family/);
    assert.match(text, /drive_upload/);
    assert.match(text, /gmail_create_draft/);
    assert.match(text, /never silent-send/);
    assert.doesNotMatch(text, /not connected/);
    assert.doesNotMatch(text, /OpenRouter|Buzz|Hermes/i);
  });

  it("does not pretend a disconnected app works", () => {
    const text = connectorMentionAddendum(["github"], { hasGitHub: false });
    assert.match(text, /not connected/i);
    assert.match(text, /github_\*/);
  });

  it("returns empty when there are no mentions", () => {
    assert.equal(connectorMentionAddendum([], { hasDrive: true }), "");
  });
});
