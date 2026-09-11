import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECT_KNOWLEDGE_TOKEN_CAP_CHARS,
  chunkText,
  extractPlainKnowledgeText,
  formatProjectKnowledgeBlock,
  isAllowedKnowledgeFile,
  projectKnowledgePromptMode,
  scoreChunk,
  searchKnowledgeChunks,
} from "./knowledge";

describe("project knowledge", () => {
  it("accepts pdf/docx/md/txt/csv and rejects other types", () => {
    assert.equal(isAllowedKnowledgeFile("brief.pdf"), true);
    assert.equal(isAllowedKnowledgeFile("notes.MD"), true);
    assert.equal(isAllowedKnowledgeFile("grid.csv", "text/csv"), true);
    assert.equal(isAllowedKnowledgeFile("deck.pptx"), false);
    assert.equal(isAllowedKnowledgeFile("photo.png"), false);
  });

  it("chunks long text with overlap and extracts utf-8 uploads", () => {
    const text = "alpha ".repeat(200);
    const chunks = chunkText(text, 40, 8);
    assert.ok(chunks.length > 1);
    assert.equal(chunks[0]?.index, 0);
    assert.ok((chunks[1]?.text.length ?? 0) > 0);
    const extracted = extractPlainKnowledgeText(
      Buffer.from("# Title\nHello project", "utf8"),
      "notes.md",
      "text/markdown",
    );
    assert.match(extracted, /Hello project/);
  });

  it("ranks chunks by query overlap", () => {
    const hits = searchKnowledgeChunks(
      [
        { fileId: "a", filename: "a.md", text: "Dublin investment operations hiring" },
        { fileId: "b", filename: "b.md", text: "Recipe for soda bread" },
        { fileId: "c", filename: "c.md", text: "Investment ops junior roles in Dublin" },
      ],
      "dublin investment ops",
      2,
    );
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.filename, "c.md");
    assert.ok((hits[0]?.score ?? 0) >= (hits[1]?.score ?? 0));
    assert.ok(scoreChunk("dublin ops", "Dublin investment operations") > 0);
  });

  it("stays in-prompt under the token cap and flips to RAG over it", () => {
    const small = [{ filename: "a.md", text: "Short brief." }];
    assert.equal(projectKnowledgePromptMode(small), "inline");
    const huge = [
      { filename: "big.md", text: "x".repeat(PROJECT_KNOWLEDGE_TOKEN_CAP_CHARS + 50) },
    ];
    assert.equal(projectKnowledgePromptMode(huge), "rag");
    const inline = formatProjectKnowledgeBlock({
      files: small,
      mode: "inline",
    });
    assert.match(inline, /a\.md/);
    assert.match(inline, /Short brief/);
    const rag = formatProjectKnowledgeBlock({
      files: huge,
      mode: "rag",
    });
    assert.match(rag, /project_knowledge_search/);
    assert.doesNotMatch(rag, /xxxx/);
  });
});
