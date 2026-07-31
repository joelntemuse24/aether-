import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  deleteVaultNote,
  getVaultNote,
  updateVaultNote,
} from "@/lib/vault/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const note = await getVaultNote(gate.userId, id);
  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ note });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    content?: string;
  };
  const note = await updateVaultNote(gate.userId, id, body);
  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ note });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  await deleteVaultNote(gate.userId, id);
  return NextResponse.json({ ok: true });
}
