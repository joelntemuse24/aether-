import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { conversationLabel } from "../conversation-title";
import { filePreviewKind } from "./file-card";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("artifact panel shell", () => {
  it("uses one untitled label in the header and the sidebar row", () => {
    assert.equal(conversationLabel(""), "New conversation");
    assert.equal(conversationLabel("New chat"), "New conversation");
    assert.equal(conversationLabel("  new chat  "), "New conversation");
    assert.equal(conversationLabel("Funds brief"), "Funds brief");
    const header = read("../../components/assistant-ui/thread-header.tsx");
    const sidebar = read("../../components/layout/sidebar.tsx");
    assert.match(header, /conversationLabel/);
    assert.match(sidebar, /conversationLabel/);
    assert.doesNotMatch(sidebar, /title \|\| "New chat"/);
  });

  it("opens Preview and Code in at most 350ms and uses a mobile sheet", () => {
    const panel = read("../../components/layout/artifact-panel.tsx");
    const shell = read("../../components/layout/app-shell.tsx");
    const css = read("../../app/globals.css");
    assert.match(panel, /Preview/);
    assert.match(panel, /Code/);
    assert.match(panel, /aether-artifact-panel/);
    assert.doesNotMatch(shell, /artifactOpen && "hidden lg:block"/);
    const duration = css.match(/\.aether-artifact-panel\s*\{[^}]*?(\d+)ms/);
    assert.ok(duration, "panel animation duration");
    assert.ok(Number(duration?.[1]) <= 350);
  });

  it("shows an in-chat card and downloadable file previews", () => {
    const toolUi = read("../../components/assistant-ui/tool-ui.tsx");
    assert.match(toolUi, /aether-artifact-card/);
    assert.match(toolUi, /aether-file-card/);
    assert.match(toolUi, /aether-file-card__download/);
    const create = toolUi.slice(toolUi.indexOf("const CreateArtifactToolCall"));
    assert.match(create, /stayOpen\n/);
    assert.doesNotMatch(
      create.slice(0, create.indexOf("ArtifactDraftCard")),
      /stayOpen=\{confirm\.needsConfirmation \|\| kindHint === "file"\}/,
    );
    assert.equal(filePreviewKind({ filename: "deck.pptx" }), "pptx");
    assert.equal(filePreviewKind({ filename: "book.xlsx" }), "xlsx");
    assert.equal(filePreviewKind({ mime: "application/pdf" }), "pdf");
    assert.equal(filePreviewKind({ filename: "chart.png" }), "png");
    assert.equal(filePreviewKind({ kind: "html" }), null);
  });
});
