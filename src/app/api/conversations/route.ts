import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  createConversation,
  listConversations,
} from "@/lib/conversations/store";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const threads = await listConversations(gate.userId);
  return NextResponse.json({ threads });
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    title?: string;
    status?: "regular" | "archived";
    custom?: Record<string, unknown>;
  };

  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const thread = await createConversation(gate.userId, {
      id,
      title: body.title,
      status: body.status,
      custom: body.custom,
    });
    return NextResponse.json({ thread });
  } catch (err) {
    console.error("[conversations POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 },
    );
  }
}
