import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAetherTool } from "./aether-tools";
import type { AetherToolContext } from "./aether-tools";

function baseCtx(over: Partial<AetherToolContext> = {}): AetherToolContext {
  return {
    userId: "user-1",
    conversationId: "c1",
    projectId: null,
    approvalMode: "ask",
    hasMemory: true,
    hasDrive: true,
    hasGitHub: true,
    ...over,
  };
}

describe("executeAetherTool", () => {
  it("runs memory_search without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "memory_search",
      args: { query: "voice" },
      ctx: baseCtx({
        deps: {
          searchMemories: async () => [{ id: "m1", title: "Voice", body: "literary" }],
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    const payload = result as unknown as { results: unknown[] };
    assert.deepEqual(payload.results, [
      { id: "m1", title: "Voice", body: "literary" },
    ]);
  });

  it("returns a confirm card for memory_write in Ask and does not write", async () => {
    let wrote = false;
    const result = await executeAetherTool({
      name: "memory_write",
      args: { title: "Voice", body: "literary" },
      ctx: baseCtx({
        approvalMode: "ask",
        deps: {
          writeMemory: async () => {
            wrote = true;
            return { id: "m1", title: "Voice", body: "literary" };
          },
          createConfirmation: async (request, userId) => {
            assert.equal(request.payload?.tool, "memory_write");
            return {
              ok: true as const,
              needs_confirmation: true as const,
              confirmation_id: "conf-1",
              action: request.action,
              title: request.title,
              preview: request.preview,
              instruction: "wait",
              userId,
            };
          },
        },
      }),
    });
    assert.equal(wrote, false);
    assert.equal(result.needs_confirmation, true);
    const gated = result as unknown as {
      confirmation_id: string;
      payload?: { tool?: string };
    };
    assert.equal(gated.confirmation_id, "conf-1");
    assert.equal(gated.payload?.tool, "memory_write");
  });

  it("does not gate a durable-style artifact payload in Ask", async () => {
    const result = await executeAetherTool({
      name: "create_artifact",
      args: {
        action: "other_side_effect",
        kind: "document",
        title: "Launch brief",
        content: "# Launch brief\n\nReady to ship.",
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("durable artifact must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { title?: string }).title, "Launch brief");
  });

  it("creates an ordinary artifact in Ask without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "create_artifact",
      args: {
        kind: "data",
        title: "Q3 costs",
        content: "item,amount\nrent,1200",
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("create_artifact must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { title?: string }).title, "Q3 costs");
  });

  it("writes memory in Auto without a card", async () => {
    const result = await executeAetherTool({
      name: "memory_write",
      args: { title: "Voice", body: "literary" },
      ctx: baseCtx({
        approvalMode: "auto",
        deps: {
          writeMemory: async (userId, input) => ({
            id: "m1",
            userId,
            title: input.title,
            body: input.body,
          }),
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    const written = result as unknown as { memory: { title: string } };
    assert.equal(written.memory.title, "Voice");
  });

  it("still confirms destructive actions in Auto", async () => {
    const result = await executeAetherTool({
      name: "request_confirmation",
      args: {
        action: "delete_resource",
        title: "Delete",
        preview: "Gone forever",
      },
      ctx: baseCtx({
        approvalMode: "auto",
        deps: {
          createConfirmation: async (request) => ({
            ok: true as const,
            needs_confirmation: true as const,
            confirmation_id: "conf-2",
            action: request.action,
            title: request.title,
            preview: request.preview,
            instruction: "wait",
          }),
        },
      }),
    });
    assert.equal(result.needs_confirmation, true);
  });

  it("executes workspace tools without a confirmation card", async () => {
    const result = await executeAetherTool({
      name: "workspace_exec",
      args: { command: "printf hello", timeoutMs: 5000 },
      ctx: baseCtx({
        approvalMode: "ask",
        deps: {
          workspaceExec: async (identity, input) => {
            assert.equal(identity.userId, "user-1");
            assert.equal(identity.conversationId, "c1");
            assert.equal(input.command, "printf hello");
            return { ok: true, exitCode: 0, stdout: "hello", stderr: "", truncated: false, durationMs: 5 };
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { stdout?: string }).stdout, "hello");
  });

  it("returns an image confirmation card in Ask when image generation is not approved yet", async () => {
    let generated = false;
    const result = await executeAetherTool({
      name: "generate_image",
      args: { prompt: "a calm cream workspace" },
      ctx: baseCtx({
        approvalMode: "ask",
        deps: {
          generateImage: async () => {
            generated = true;
            return { ok: true as const, kind: "image" as const, title: "x", content: "y", mime: "image/png" };
          },
          createConfirmation: async (request) => ({
            ok: true as const,
            needs_confirmation: true as const,
            confirmation_id: "img-1",
            action: request.action,
            title: request.title,
            preview: request.preview,
            instruction: "wait",
          }),
        },
      }),
    });
    assert.equal(generated, false);
    assert.equal(result.needs_confirmation, true);
    assert.match(String(result.title), /image/i);
    assert.match(String(result.preview), /credits/i);
    assert.doesNotMatch(String(result.preview), /OpenRouter|Gemini|DALL/i);
  });

  it("persists generate_image after the user confirms spend", async () => {
    let generated = false;
    const result = await executeAetherTool({
      name: "generate_image",
      args: { prompt: "a calm cream workspace" },
      ctx: baseCtx({
        approvalMode: "ask",
        skipGate: true,
        deps: {
          generateImage: async () => {
            generated = true;
            return {
              ok: true as const,
              kind: "image" as const,
              title: "a calm cream workspace",
              content: "data:image/png;base64,aaa",
              mime: "image/png",
            };
          },
          saveArtifact: async () => ({ id: "art-img-1" }),
        },
      }),
    });
    assert.equal(generated, true);
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal(result.kind, "image");
    assert.equal(result.id, "art-img-1");
    assert.equal(result.persisted, true);
    assert.equal(result.content, "data:image/png;base64,aaa");
  });

  it("still confirms generate_image in Auto because it spends credits", async () => {
    let generated = false;
    const result = await executeAetherTool({
      name: "generate_image",
      args: { prompt: "spend" },
      ctx: baseCtx({
        approvalMode: "auto",
        deps: {
          generateImage: async () => {
            generated = true;
            return {
              ok: true as const,
              kind: "image" as const,
              title: "x",
              content: "y",
              mime: "image/png",
            };
          },
          createConfirmation: async (request) => ({
            ok: true as const,
            needs_confirmation: true as const,
            confirmation_id: "img-auto",
            action: request.action,
            title: request.title,
            preview: request.preview,
            instruction: "wait",
          }),
        },
      }),
    });
    assert.equal(generated, false);
    assert.equal(result.needs_confirmation, true);
  });

  it("keeps Drive/GitHub unavailable when the connector is off", async () => {
    const drive = await executeAetherTool({
      name: "drive_search",
      args: { query: "notes" },
      ctx: baseCtx({ hasDrive: false }),
    });
    assert.equal(drive.ok, false);
    assert.match(String((drive as { error?: string }).error), /not connected/i);

    const gh = await executeAetherTool({
      name: "github_read_file",
      args: { repo: "acme/app", path: "README.md" },
      ctx: baseCtx({ hasGitHub: false }),
    });
    assert.equal(gh.ok, false);
    assert.match(String((gh as { error?: string }).error), /not connected/i);
  });

  it("builds a real pptx via create_presentation without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "create_presentation",
      args: {
        title: "Ireland investment operations",
        slides: [
          { title: "Ireland investment operations", layout: "title" },
          { title: "Market", bullets: ["Fund admin in Dublin"] },
        ],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("create_presentation must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { kind?: string }).kind, "file");
    assert.match(String((result as { filename?: string }).filename), /\.pptx$/);
    assert.match(String((result as { content?: string }).content), /^data:.*base64,/);
    assert.equal((result as { persisted?: boolean }).persisted, false);
    assert.match(String((result as { hint?: string }).hint), /sign in/i);
  });

  it("persists a pptx for signed-in cloud users and returns a download path", async () => {
    let savedContent = "";
    const result = await executeAetherTool({
      name: "create_presentation",
      args: {
        title: "Dublin junior investment-ops",
        slides: [{ title: "Market", bullets: ["IFSC fund admin"] }],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: "user-1",
        deps: {
          saveArtifact: async (_userId, input) => {
            savedContent = input.content;
            assert.equal(input.kind, "file");
            assert.match(input.content, /^data:.*base64,/);
            return { id: "art-cloud-1" };
          },
          createConfirmation: async () => {
            throw new Error("create_presentation must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal((result as { persisted?: boolean }).persisted, true);
    assert.equal((result as { id?: string }).id, "art-cloud-1");
    assert.equal(
      (result as { downloadPath?: string }).downloadPath,
      "/api/artifacts/art-cloud-1/download",
    );
    assert.equal((result as { content?: string }).content, undefined);
    assert.match(savedContent, /^data:.*base64,/);
  });

  it("surfaces the office-file fallback when workspace_exec cannot start", async () => {
    const result = await executeAetherTool({
      name: "workspace_exec",
      args: { command: "pip install python-pptx" },
      ctx: baseCtx({
        deps: {
          workspaceExec: async () => ({
            ok: false,
            error:
              "The isolated workspace is unavailable. For a PowerPoint file use create_presentation; for Excel use create_spreadsheet. Do not substitute a markdown briefing when the user asked for a real file.",
          }),
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String((result as { error?: string }).error), /create_presentation/);
  });

  it("builds a real xlsx via create_spreadsheet without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "create_spreadsheet",
      args: {
        title: "Q3 costs",
        sheets: [
          {
            name: "Costs",
            headers: ["item", "amount"],
            rows: [
              ["rent", 1200],
              ["software", 80],
            ],
          },
        ],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("create_spreadsheet must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { kind?: string }).kind, "file");
    assert.match(String((result as { filename?: string }).filename), /\.xlsx$/);
    assert.match(String((result as { content?: string }).content), /^data:.*base64,/);
    assert.equal((result as { persisted?: boolean }).persisted, false);
    assert.match(String((result as { hint?: string }).hint), /sign in/i);
  });

  it("persists an xlsx for signed-in cloud users and returns a download path", async () => {
    const result = await executeAetherTool({
      name: "create_spreadsheet",
      args: {
        title: "Q3 costs",
        sheets: [{ headers: ["item"], rows: [["rent"]] }],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: "user-1",
        deps: {
          saveArtifact: async (_userId, input) => {
            assert.equal(input.kind, "file");
            assert.match(input.content, /^data:.*base64,/);
            return { id: "art-xlsx-1" };
          },
          createConfirmation: async () => {
            throw new Error("create_spreadsheet must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal((result as { persisted?: boolean }).persisted, true);
    assert.equal((result as { id?: string }).id, "art-xlsx-1");
    assert.equal(
      (result as { downloadPath?: string }).downloadPath,
      "/api/artifacts/art-xlsx-1/download",
    );
    assert.equal((result as { content?: string }).content, undefined);
  });

  it("builds a real docx via create_document without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "create_document",
      args: {
        title: "Q3 ops memo",
        paragraphs: ["Rent is the largest line item this quarter."],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("create_document must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { kind?: string }).kind, "file");
    assert.match(String((result as { filename?: string }).filename), /\.docx$/);
    assert.match(String((result as { content?: string }).content), /^data:.*base64,/);
    assert.equal((result as { persisted?: boolean }).persisted, false);
    assert.match(String((result as { hint?: string }).hint), /sign in/i);
  });

  it("persists a docx for signed-in cloud users and returns a download path", async () => {
    const result = await executeAetherTool({
      name: "create_document",
      args: {
        title: "Q3 ops memo",
        paragraphs: ["Rent is the largest line item."],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: "user-1",
        deps: {
          saveArtifact: async (_userId, input) => {
            assert.equal(input.kind, "file");
            assert.match(input.content, /^data:.*base64,/);
            return { id: "art-docx-1" };
          },
          createConfirmation: async () => {
            throw new Error("create_document must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal((result as { persisted?: boolean }).persisted, true);
    assert.equal((result as { id?: string }).id, "art-docx-1");
    assert.equal(
      (result as { downloadPath?: string }).downloadPath,
      "/api/artifacts/art-docx-1/download",
    );
    assert.equal((result as { content?: string }).content, undefined);
  });

  it("builds a real pdf via create_pdf without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "create_pdf",
      args: {
        title: "Q3 ops memo",
        paragraphs: ["Rent is the largest line item this quarter."],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("create_pdf must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { kind?: string }).kind, "file");
    assert.match(String((result as { filename?: string }).filename), /\.pdf$/);
    assert.match(String((result as { content?: string }).content), /^data:.*base64,/);
    assert.equal((result as { persisted?: boolean }).persisted, false);
    assert.match(String((result as { hint?: string }).hint), /sign in/i);
  });

  it("persists a pdf for signed-in cloud users and returns a download path", async () => {
    const result = await executeAetherTool({
      name: "create_pdf",
      args: {
        title: "Q3 ops memo",
        paragraphs: ["Rent is the largest line item."],
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: "user-1",
        deps: {
          saveArtifact: async (_userId, input) => {
            assert.equal(input.kind, "file");
            assert.match(input.content, /^data:.*base64,/);
            return { id: "art-pdf-1" };
          },
          createConfirmation: async () => {
            throw new Error("create_pdf must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal((result as { persisted?: boolean }).persisted, true);
    assert.equal((result as { id?: string }).id, "art-pdf-1");
    assert.equal(
      (result as { downloadPath?: string }).downloadPath,
      "/api/artifacts/art-pdf-1/download",
    );
    assert.equal((result as { content?: string }).content, undefined);
  });

  it("searches project knowledge without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "project_knowledge_search",
      args: { query: "dublin ops", projectId: "proj-1" },
      ctx: baseCtx({
        projectId: "proj-1",
        deps: {
          searchProjectKnowledge: async (userId, projectId, query) => {
            assert.equal(userId, "user-1");
            assert.equal(projectId, "proj-1");
            assert.equal(query, "dublin ops");
            return [
              { fileId: "f1", filename: "brief.md", text: "Dublin ops", score: 3 },
            ];
          },
          createConfirmation: async () => {
            throw new Error("project_knowledge_search must not pause");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    const payload = result as unknown as { results: unknown[] };
    assert.equal(payload.results.length, 1);
  });

  it("requires an active project for project_knowledge_search", async () => {
    const result = await executeAetherTool({
      name: "project_knowledge_search",
      args: { query: "hello" },
      ctx: baseCtx({
        projectId: null,
        deps: {
          searchProjectKnowledge: async () => {
            throw new Error("should not search without a project");
          },
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /project/i);
  });

  it("confirms drive_upload in Ask and Auto before writing", async () => {
    for (const mode of ["ask", "auto"] as const) {
      let uploaded = false;
      const result = await executeAetherTool({
        name: "drive_upload",
        args: {
          filename: "Q3-deck.pptx",
          content:
            "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEs=",
          folderId: "folder-1",
        },
        ctx: baseCtx({
          approvalMode: mode,
          hasDrive: true,
          deps: {
            driveUpload: async () => {
              uploaded = true;
              return { ok: true, fileId: "file-1", name: "Q3-deck.pptx" };
            },
            createConfirmation: async (request) => ({
              ok: true as const,
              needs_confirmation: true as const,
              confirmation_id: `drive-${mode}`,
              action: request.action,
              title: request.title,
              preview: request.preview,
              instruction: "wait",
            }),
          },
        }),
      });
      assert.equal(uploaded, false, mode);
      assert.equal(result.needs_confirmation, true, mode);
      assert.match(String(result.title), /Drive/i);
      assert.match(String(result.preview), /Q3-deck\.pptx/);
      assert.doesNotMatch(String(result.preview), /Google|OpenRouter/i);
    }
  });

  it("uploads to Drive after the user confirms", async () => {
    let uploaded = false;
    const result = await executeAetherTool({
      name: "drive_write",
      args: {
        filename: "costs.xlsx",
        workspacePath: "out/costs.xlsx",
        folderId: "folder-9",
      },
      ctx: baseCtx({
        approvalMode: "auto",
        skipGate: true,
        hasDrive: true,
        deps: {
          workspaceReadBinary: async (_id, input) => {
            assert.equal(input.path, "out/costs.xlsx");
            return { ok: true as const, buffer: Buffer.from("xlsx-bytes") };
          },
          driveUpload: async (_userId, input) => {
            uploaded = true;
            assert.equal(input.filename, "costs.xlsx");
            assert.equal(input.folderId, "folder-9");
            assert.equal(input.buffer.toString(), "xlsx-bytes");
            return {
              ok: true,
              fileId: "file-xlsx",
              name: "costs.xlsx",
              webViewLink: "https://drive.example/file-xlsx",
            };
          },
        },
      }),
    });
    assert.equal(uploaded, true);
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal(result.fileId, "file-xlsx");
  });

  it("does not silent-send gmail in Auto — confirm card first", async () => {
    const result = await executeAetherTool({
      name: "gmail_send",
      args: { to: "a@b.com", subject: "Hi", body: "Hello" },
      ctx: baseCtx({
        approvalMode: "auto",
        hasGmail: true,
        deps: {
          createConfirmation: async (request) => ({
            ok: true as const,
            needs_confirmation: true as const,
            confirmation_id: "mail-auto",
            action: request.action,
            title: request.title,
            preview: request.preview,
            instruction: "wait",
          }),
        },
      }),
    });
    assert.equal(result.needs_confirmation, true);
    assert.match(String(result.preview), /a@b\.com/);
  });

  it("always confirms schedule_create and does not register until approved", async () => {
    let registered = false;
    const result = await executeAetherTool({
      name: "schedule_create",
      args: {
        title: "Morning brief",
        prompt: "Summarize overnight notes",
        when: "every morning",
        delivery: "email",
      },
      ctx: baseCtx({
        approvalMode: "auto",
        deps: {
          registerSchedule: async () => {
            registered = true;
            return { ok: true as const, job: {} as never, fires: false };
          },
          createConfirmation: async (request) => ({
            ok: true as const,
            needs_confirmation: true as const,
            confirmation_id: "sched-1",
            action: request.action,
            title: request.title,
            preview: request.preview,
            instruction: "wait",
          }),
        },
      }),
    });
    assert.equal(registered, false);
    assert.equal(result.needs_confirmation, true);
    assert.match(String(result.preview), /Schedule|morning|confirm/i);
  });

  it("is honest when design files are not connected", async () => {
    const result = await executeAetherTool({
      name: "design_list",
      args: { query: "brand" },
      ctx: baseCtx({
        deps: {
          designList: async () => ({
            ok: false as const,
            error: "Design files are not connected.",
          }),
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /not connected/i);
    assert.doesNotMatch(String(result.error), /Figma/i);
  });

  it("never scrapes a social feed", async () => {
    const result = await executeAetherTool({
      name: "social_search",
      args: { query: "aether" },
      ctx: baseCtx({
        deps: {
          socialSearch: async () => ({
            ok: false as const,
            error: "Social feed search is unavailable without an official API key.",
          }),
        },
      }),
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /official API key/i);
  });
});
