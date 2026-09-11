import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { getProject } from "@/lib/projects/store";
import {
  addProjectKnowledgeFile,
  deleteProjectKnowledgeFile,
  listProjectKnowledge,
} from "@/lib/projects/knowledge-store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function gateProject(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);
  if (!project) return null;
  return project;
}

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  if (!(await gateProject(gate.userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const files = await listProjectKnowledge(gate.userId, id);
  return NextResponse.json({
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      createdAt: f.createdAt,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  if (!(await gateProject(gate.userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  try {
    const saved = await addProjectKnowledgeFile(gate.userId, id, {
      filename: file.name,
      mime: file.type,
      data: await file.arrayBuffer(),
    });
    return NextResponse.json({
      file: {
        id: saved.id,
        filename: saved.filename,
        createdAt: saved.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  if (!(await gateProject(gate.userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "fileId required" }, { status: 400 });
  }
  await deleteProjectKnowledgeFile(gate.userId, id, fileId);
  return NextResponse.json({ ok: true });
}
