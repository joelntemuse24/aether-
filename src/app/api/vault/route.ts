import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  createVaultNote,
  listVaultNotes,
  upsertVaultNote,
} from "@/lib/vault/store";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const notes = await listVaultNotes(gate.userId);
  return NextResponse.json({ notes });
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    title?: string;
    content?: string;
  };
  const title = body.title?.trim() || "Untitled note";
  const content = body.content ?? "";

  // Upsert when id is provided so Save can create-or-update in one call.
  if (body.id?.trim()) {
    const note = await upsertVaultNote(gate.userId, {
      id: body.id.trim(),
      title,
      content,
    });
    return NextResponse.json({ note });
  }

  const note = await createVaultNote(gate.userId, { title, content });
  return NextResponse.json({ note });
}
