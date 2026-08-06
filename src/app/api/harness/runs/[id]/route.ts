import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAgentRunForUser,
  markAgentRunResumable,
} from "@/lib/harness/runs-store";

/**
 * GET — load a harness run (plan, status, events) for Agent UI / resume.
 * POST { action: "resume" } — mark the run acting again after a pause.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;
  if (!userId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing run id." }, { status: 400 });
  }
  const run = await getAgentRunForUser(userId, id);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json({ run });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;
  if (!userId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    note?: string;
  };
  if (body.action !== "resume") {
    return NextResponse.json(
      { error: "Unsupported action. Use action: resume." },
      { status: 400 },
    );
  }
  const existing = await getAgentRunForUser(userId, id);
  if (!existing) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  await markAgentRunResumable({
    id,
    userId,
    status: "acting",
    note: body.note,
  });
  const run = await getAgentRunForUser(userId, id);
  return NextResponse.json({ ok: true, run });
}
