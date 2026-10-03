import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browsePage, extractStructuredPage, githubRepoReadmeUrl, preparePublicPageFetch } from "./browse-page";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <title>Dublin Funds</title>
    <meta name="description" content="AIFMD overview for funds">
  </head>
  <body>
    <nav>Home About Contact</nav>
    <h1>Central Bank AIFMD</h1>
    <p>The Central Bank of Ireland authorises AIFMs under AIFMD.</p>
    <h2>Annual fees</h2>
    <p>Annual fund fees are published each year on the regulator site.</p>
    <a href="https://www.centralbank.ie/funds">Funds page</a>
    <footer>Copyright 2026</footer>
  </body>
</html>`;

describe("extractStructuredPage", () => {
  it("returns a structured extract instead of a raw innerText blob", () => {
    const page = extractStructuredPage({
      html: SAMPLE_HTML,
      url: "https://www.centralbank.ie/funds",
    });
    assert.equal(page.title, "Dublin Funds");
    assert.equal(page.description, "AIFMD overview for funds");
    assert.deepEqual(
      page.headings.map((h) => `${h.level}:${h.text}`),
      ["1:Central Bank AIFMD", "2:Annual fees"],
    );
    assert.ok(page.links.some((l) => l.href.includes("centralbank.ie/funds")));
    assert.ok(page.excerpts.some((e) => /authorises AIFMs/i.test(e)));
    assert.ok(page.excerpts.every((e) => !/Home About Contact/i.test(e)));
    assert.ok(typeof page.text === "string");
    assert.ok(!page.text.includes("<p>"));
  });

  it("focuses excerpts when instructions are provided", () => {
    const page = extractStructuredPage({
      html: SAMPLE_HTML,
      url: "https://www.centralbank.ie/funds",
      instructions: "What are the annual fees?",
    });
    assert.equal(page.instructions, "What are the annual fees?");
    assert.ok(page.focused);
    assert.match(page.focused, /Annual fund fees/i);
    assert.doesNotMatch(page.focused, /Home About Contact/);
  });
});

describe("browsePage SSRF", () => {
  it("blocks private and metadata IP literals before any fetch", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.8/admin",
      "http://localhost/secret",
    ]) {
      const result = await browsePage({ url, instructions: "extract title" });
      assert.equal(result.ok, false, url);
      assert.match(
        String(result.error),
        /not allowed|private|blocked/i,
        url,
      );
    }
  });

  it("blocks github.com only when GitHub tools are enabled", () => {
    const repo = "https://github.com/joelntemuse24/aether-";
    const blocked = preparePublicPageFetch(repo, { hasGitHub: true });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /github_get_repo/);
    const open = preparePublicPageFetch(repo, { hasGitHub: false });
    assert.equal(open.ok, true);
    if (open.ok) {
      assert.equal(
        open.url,
        "https://raw.githubusercontent.com/joelntemuse24/aether-/HEAD/README.md",
      );
    }
    assert.equal(githubRepoReadmeUrl("https://github.com/acme/widgets/blob/main/README.md"), null);
    const plain = preparePublicPageFetch("https://example.com/a");
    assert.equal(plain.ok && plain.url, "https://example.com/a");
  });
});
