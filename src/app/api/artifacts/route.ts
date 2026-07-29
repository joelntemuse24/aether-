import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  deleteArtifact,
  getArtifact,
  listArtifacts,
  saveArtifact,
} from "@/lib/artifacts/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const artifact = await getArtifact(gate.userId, id);
    if (!artifact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ artifact });
  }
  const artifacts = await listArtifacts(gate.userId);
  return NextResponse.json({ artifacts });
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    kind?: string;
    title?: string;
    language?: string;
    content?: string;
    projectId?: string;
    conversationId?: string;
  };
  if (!body.title?.trim() || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "title and content are required" },
      { status: 400 },
    );
  }
  try {
    const artifact = await saveArtifact(gate.userId, {
      id: body.id,
      kind: body.kind || "document",
      title: body.title.trim(),
      language: body.language,
      content: body.content,
      projectId: body.projectId,
      conversationId: body.conversationId,
    });
    return NextResponse.json({ artifact });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    const status = message.includes("another user") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await deleteArtifact(gate.userId, id);
  return NextResponse.json({ ok: true });
}
