import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  getMessageRepo,
  saveMessageRepo,
  type FormatRepo,
} from "@/lib/conversations/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const repo = await getMessageRepo(gate.userId, id);
  return NextResponse.json({ repo });
}

export async function PUT(req: Request, ctx: Ctx) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { repo?: FormatRepo };
  if (!body.repo || !Array.isArray(body.repo.entries)) {
    return NextResponse.json({ error: "repo is required" }, { status: 400 });
  }

  try {
    await saveMessageRepo(gate.userId, id, {
      headId: body.repo.headId ?? null,
      entries: body.repo.entries,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[conversation messages PUT]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 },
    );
  }
}
