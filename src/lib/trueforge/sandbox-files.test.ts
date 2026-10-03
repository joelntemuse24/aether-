import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { filePreviewKind } from "@/lib/artifacts/file-card";
import { fileToolResult } from "@/lib/artifacts/file-result";
import { buildTrueForgeAgentSpec } from "./sessions";
import {
  isPanelSandboxPath,
  isPublishableSandboxPath,
  redactSandboxText,
  sandboxFileCards,
  sandboxFileName,
} from "./sandbox-files";
import { instructionsForAttachedTools, trueforgeInstructions } from "./instructions";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { playbooksSystemAddendum, resolvePlaybooks } from "@/lib/harness/playbooks";

const DECK =
  "/home/aether/.local/share/trueforge-aether/sandboxes/abc/abc/artifacts/irish_housing_crisis.pptx";
const SHEET =
  "/home/aether/.local/share/trueforge-aether/sandboxes/abc/abc/artifacts/cork_rent.xlsx";
const CHART =
  "/home/aether/.local/share/trueforge-aether/sandboxes/abc/abc/artifacts/rent_chart.png";

describe("sandbox file publishing", () => {
  it("hides the housing-deck path and keeps the file to download", () => {
    const text = [
      "The deck is ready.",
      "```sandbox_artifacts",
      `[Irish housing crisis](${DECK})`,
      `[Cork rent](${SHEET})`,
      `[Rent chart](${CHART})`,
      "```",
    ].join("\n");
    const fed = redactSandboxText(text);
    assert.equal(fed.held, "");
    assert.equal(fed.visible.includes("/home/"), false);
    assert.equal(fed.visible.includes("trueforge-aether"), false);
    assert.equal(fed.visible.includes("sandbox_artifacts"), false);
    assert.match(fed.visible, /The deck is ready/);
    assert.deepEqual(
      fed.refs.map((ref) => ref.path),
      [DECK, SHEET, CHART],
    );
    assert.equal(fed.refs[0]?.label, "Irish housing crisis");
    assert.equal(sandboxFileName(DECK), "irish_housing_crisis.pptx");
    assert.equal(isPublishableSandboxPath(DECK), true);
  });

  it("holds a fence that arrives in pieces", () => {
    const first = redactSandboxText("```sandbox_artif");
    assert.equal(first.visible, "");
    assert.match(first.held, /sandbox_artif/);
    const second = redactSandboxText(`${first.held}acts\n[Deck](${DECK})\n\`\`\`\n`);
    assert.equal(second.visible.includes(DECK), false);
    assert.equal(second.refs[0]?.path, DECK);
  });

  it("replays the probe as a file card with a working link", async () => {
    const bytes = Buffer.from("PK\u0003\u0004deck");
    const loaded: string[] = [];
    const chunks = await sandboxFileCards({
      refs: [
        { label: "Irish housing crisis", path: DECK },
        { label: "Cork rent", path: SHEET },
        { label: "Rent chart", path: CHART },
      ],
      load: async (filePath) => {
        loaded.push(filePath);
        return bytes;
      },
    });
    assert.deepEqual(loaded, [DECK, SHEET, CHART]);
    const outputs = chunks.filter((chunk) => chunk.type === "tool-output-available");
    assert.equal(outputs.length, 3);
    const deck = outputs[0]?.output as {
      kind?: string;
      filename?: string;
      content?: string;
      downloadPath?: string;
      hint?: string;
    };
    assert.equal(deck.kind, "file");
    assert.equal(deck.filename, "irish_housing_crisis.pptx");
    assert.match(deck.content ?? "", /^data:application\/vnd.openxmlformats-officedocument.presentationml.presentation;base64,/);
    assert.equal(deck.downloadPath, undefined);
    assert.match(deck.hint ?? "", /download/i);
    assert.equal(JSON.stringify(chunks).includes("/home/"), false);
    assert.equal(JSON.stringify(chunks).includes("trueforge"), false);
    const sheet = outputs[1]?.output as { filename?: string };
    const chart = outputs[2]?.output as { filename?: string };
    assert.equal(sheet.filename, "cork_rent.xlsx");
    assert.equal(chart.filename, "rent_chart.png");
    const inputs = chunks.filter((chunk) => chunk.type === "tool-input-available");
    assert.equal(
      filePreviewKind({
        kind: "file",
        filename: String((inputs[0]?.input as { language?: string } | undefined)?.language),
        mime: (outputs[0]?.output as { mime?: string }).mime,
      }),
      "pptx",
    );
    assert.equal(filePreviewKind({ kind: "file", filename: sheet.filename }), "xlsx");
    assert.equal(filePreviewKind({ kind: "file", filename: chart.filename }), "png");
    const toolUi = readFileSync(
      new URL("../../components/assistant-ui/tool-ui.tsx", import.meta.url),
      "utf8",
    );
    assert.match(toolUi, /FilePreviewCard/);
    assert.match(toolUi, /filePreviewKind/);
  });

  it("uses the saved download path when the file is kept on the account", async () => {
    const chunks = await sandboxFileCards({
      refs: [{ label: "Irish housing crisis", path: DECK }],
      load: async () => Buffer.from("deck"),
      persist: async () => ({ id: "art-deck", persisted: true }),
    });
    const output = chunks.find((chunk) => chunk.type === "tool-output-available")?.output as {
      downloadPath?: string;
      content?: string;
      persisted?: boolean;
    };
    assert.equal(output.persisted, true);
    assert.equal(output.downloadPath, "/api/artifacts/art-deck/download");
    assert.equal(output.content, undefined);
    const shaped = fileToolResult({
      title: "Irish housing crisis",
      filename: "irish_housing_crisis.pptx",
      mime: "application/octet-stream",
      bytes: 4,
      dataUrl: "data:application/octet-stream;base64,ZGVjaw==",
      saved: { id: "art-deck", persisted: true },
    });
    assert.equal(output.downloadPath, shaped.downloadPath);
  });

  it("tells every hosted model to use the sandbox instead of a missing presentation tool", () => {
    const deck = playbooksSystemAddendum(
      resolvePlaybooks({ text: "Build a 5-slide deck as a downloadable pptx" }),
    );
    const hosted = instructionsForAttachedTools(
      trueforgeInstructions(`${TOOLS_SYSTEM_PROMPT}\n\n${deck}`),
      ["web_search", "fetch_url", "browse_page"],
    );
    for (const modelName of ["buzz/gpt-5-6-luna", "anthropic/claude-haiku-4-5", "buzz/gpt-6-astra"]) {
      const spec = buildTrueForgeAgentSpec({
        modelName,
        instructions: hosted,
        mcp: { direct: "aether-chat", includeAccountTools: false },
        sandboxEnabled: true,
      });
      const instructions = spec.spec.instructions;
      assert.equal(instructions.includes("create_presentation"), false);
      assert.match(instructions, /sandbox_artifacts block/);
      assert.match(instructions, /Do not paste \/home paths/);
    }
  });
});

const VM =
  "/home/aether/.local/share/trueforge-aether/sandboxes";

describe("probe replay (re-run and round-1 strings)", () => {
  it("publishes the Cork spreadsheet from the Sonnet P8 fenced block", () => {
    const text = [
      "Here it is:",
      "```sandbox_artifacts",
      "[Cork City Rent vs Inflation (xlsx)](/home/aether/.local/share/trueforge-aether/sandboxes/01m41kbvxrxkqgksr9nfjcpc44/01m41kd2fzvkast0qzhpz50ec4/cork_rent_vs_inflation.xlsx)",
      "```",
    ].join("\n");
    const fed = redactSandboxText(text);
    assert.equal(fed.visible.includes("/home/"), false);
    assert.equal(fed.visible.includes("sandbox_artifacts"), false);
    assert.match(fed.visible, /Here it is:/);
    assert.equal(fed.refs.length, 1);
    assert.equal(
      fed.refs[0]?.path,
      `${VM}/01m41kbvxrxkqgksr9nfjcpc44/01m41kd2fzvkast0qzhpz50ec4/cork_rent_vs_inflation.xlsx`,
    );
    assert.equal(fed.refs[0]?.label, "Cork City Rent vs Inflation (xlsx)");
  });

  it("keeps the Sol angle-bracket link and hides the VM path", () => {
    const path = `${VM}/01m41kbs5x2rk57emc4mx39km3/01m41kdt8zjq7rm/cork_rent_comparison.xlsx`;
    const fed = redactSandboxText(`Done. [Download the Cork rent comparison spreadsheet](<${path}>)`);
    assert.equal(fed.visible, "Done. Download the Cork rent comparison spreadsheet");
    assert.equal(fed.refs[0]?.path, path);
    assert.equal(fed.refs[0]?.label, "Download the Cork rent comparison spreadsheet");
  });

  it("keeps the Sol padded link and hides the VM path", () => {
    const path = `${VM}/01m41ksrsxfjtemqghxqyvcpfw/01m41kswx8rtkpc/irish_housing_crisis.pptx`;
    const fed = redactSandboxText(
      `[sDownload the Irish housing crisis deck]( ${path} )`,
    );
    assert.equal(fed.visible, "sDownload the Irish housing crisis deck");
    assert.equal(fed.refs[0]?.path, path);
    assert.equal(fed.refs[0]?.label, "sDownload the Irish housing crisis deck");
  });

  it("opens the Sonnet P4 calculator html as a panel artifact, not a download", async () => {
    const path = `${VM}/01m41kxcy8wqyjrcx2bzgbvmc9/01m41kxhz8q5w/mortgage_calculator_ireland.html`;
    const html = "<!DOCTYPE html><html><body>calculator</body></html>";
    const fed = redactSandboxText(
      `Here you go:\n\`\`\`sandbox_artifacts\n[🏡 Ireland Mortgage Calculator](${path})\n\`\`\``,
    );
    assert.equal(fed.visible.includes("/home/"), false);
    assert.equal(fed.visible.includes("sandbox_artifacts"), false);
    assert.equal(isPanelSandboxPath(path), true);
    const chunks = await sandboxFileCards({
      refs: fed.refs,
      load: async () => Buffer.from(html, "utf8"),
    });
    const input = chunks.find((chunk) => chunk.type === "tool-input-available");
    const output = chunks.find((chunk) => chunk.type === "tool-output-available")?.output as {
      kind?: string;
      content?: string;
      downloadPath?: string;
    };
    assert.equal((input?.input as { kind?: string }).kind, "html");
    assert.equal(output.kind, "html");
    assert.equal(output.content, html);
    assert.equal(output.downloadPath, undefined);
    assert.equal(JSON.stringify(chunks).includes("data:"), false);
    assert.equal(JSON.stringify(chunks).includes("/home/"), false);
  });

  it("recovers the Sol chart svg whose path dropped the sandbox subfolder", async () => {
    const dropped = `${VM}/01m41kmnnhkvjzf15ft86zez84/bitcoin_30d_chart.svg`;
    const loaded: string[] = [];
    const chunks = await sandboxFileCards({
      refs: [{ label: "Bitcoin 30-Day Chart", path: dropped }],
      load: async (filePath) => {
        loaded.push(filePath);
        return filePath === "bitcoin_30d_chart.svg"
          ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8")
          : null;
      },
    });
    assert.deepEqual(loaded, [dropped, "bitcoin_30d_chart.svg"]);
    const output = chunks.find((chunk) => chunk.type === "tool-output-available")?.output as {
      kind?: string;
      content?: string;
    };
    assert.equal(output.kind, "svg");
    assert.match(output.content ?? "", /^<svg/);
  });

  it("collects the round-1 unfenced header and its relative link across chunks", () => {
    const first = redactSandboxText("The deck is ready.\n[sandbox_artifacts]");
    assert.equal(first.visible.includes("sandbox_artifacts"), false);
    assert.match(first.held, /sandbox_artifacts/);
    const second = redactSandboxText(
      `${first.held}\n[Download the Irish housing crisis deck](irish_housing_crisis_5_slide_deck.pptx)`,
    );
    assert.equal(second.visible.includes("sandbox_artifacts"), false);
    const flushed = redactSandboxText(second.held, { flush: true });
    assert.equal(flushed.visible.includes("sandbox_artifacts"), false);
    assert.deepEqual(flushed.refs.map((ref) => ref.path), [
      "irish_housing_crisis_5_slide_deck.pptx",
    ]);
    assert.equal(flushed.visible.includes("irish_housing_crisis_5_slide_deck.pptx"), false);
  });

  it("leaves a relative link alone when no sandbox header opened a block", () => {
    const fed = redactSandboxText("See [the docs](README.md) for details.");
    assert.deepEqual(fed.refs, []);
    assert.equal(fed.visible, "See [the docs](README.md) for details.");
  });
});
