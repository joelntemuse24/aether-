import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  listMemories,
  searchMemories,
  writeMemory,
} from "@/lib/memory/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const memories = q
    ? await searchMemories(gate.userId, q, 20)
    : await listMemories(gate.userId);
  return NextResponse.json({ memories });
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
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
    id: body.id,
    type: body.type,
    title: body.title.trim(),
    body: body.body.trim(),
    importance: body.importance,
    tags: body.tags,
  });
  return NextResponse.json({ memory });
}
