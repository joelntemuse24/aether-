import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyInlineCitations,
  assignCitationIds,
  collectSourceCitations,
  splitTextWithCitations,
} from "./citations";

describe("assignCitationIds", () => {
  it("numbers web_search hits as 1-based ids", () => {
    const numbered = assignCitationIds([
      { title: "IDA Ireland", snippet: "Funds", url: "https://idaireland.com/funds" },
      { title: "CBI", snippet: "AIFMD", url: "https://www.centralbank.ie/funds" },
    ]);
    assert.equal(numbered[0]?.id, "1");
    assert.equal(numbered[1]?.id, "2");
  });
});

describe("collectSourceCitations", () => {
  it("collects web_search and fetch_url results with citation ids", () => {
    const sources = collectSourceCitations([
      {
        type: "tool-call",
        toolName: "web_search",
        result: {
          results: [
            {
              id: "1",
              title: "IDA Ireland",
              url: "https://idaireland.com/funds",
            },
          ],
        },
      },
      {
        type: "tool-call",
        toolName: "fetch_url",
        result: {
          ok: true,
          id: "2",
          title: "Central Bank AIFMD",
          url: "https://www.centralbank.ie/regulation/industry-market-sectors/funds",
        },
      },
    ]);
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.id, "1");
    assert.equal(sources[1]?.id, "2");
    assert.equal(sources[1]?.url?.includes("centralbank"), true);
  });
});

describe("inline citation rendering", () => {
  it("turns [1] into a markdown link that keeps the citation id", () => {
    const sources = [
      { id: "1", title: "IDA Ireland", url: "https://idaireland.com/funds" },
    ];
    const md = applyInlineCitations(
      "Dublin remains a funds hub [1].",
      sources,
    );
    assert.match(md, /\[1\]\(https:\/\/idaireland\.com\/funds\)/);
  });

  it("splits text nodes so [2] becomes a link node", () => {
    const nodes = splitTextWithCitations("Headcount grew [2] in 2026.", [
      { id: "2", title: "CBI", url: "https://www.centralbank.ie/funds" },
    ]);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0]?.type, "text");
    assert.equal(nodes[1]?.type, "link");
    assert.equal(nodes[1]?.url, "https://www.centralbank.ie/funds");
    assert.equal(nodes[1]?.children?.[0]?.value, "2");
  });
});
