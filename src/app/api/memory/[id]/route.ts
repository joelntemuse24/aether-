import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { deleteMemory, writeMemory } from "@/lib/memory/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    title?: string;
    body?: string;
    importance?: string;
    tags?: string[];
  };
  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json(
      { error: "title and body are required" },
      { status: 400 },
    );
  }
  const memory = await writeMemory(gate.userId, {
    id,
    type: body.type,
    title: body.title.trim(),
    body: body.body.trim(),
    importance: body.importance,
    tags: body.tags,
  });
  return NextResponse.json({ memory });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  await deleteMemory(gate.userId, id);
  return NextResponse.json({ ok: true });
}
