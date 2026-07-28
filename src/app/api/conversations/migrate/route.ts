import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import {
  migrateConversations,
  type FormatRepo,
} from "@/lib/conversations/store";

export const runtime = "nodejs";

/** Import browser-local conversations into the signed-in user's cloud store. */
export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as {
    items?: Array<{
      id: string;
      title?: string;
      status?: "regular" | "archived";
      custom?: Record<string, unknown>;
      repo?: FormatRepo;
    }>;
  };

  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }

  // Cap bulk import to protect the DB
  const items = body.items.slice(0, 100);
  const result = await migrateConversations(gate.userId, items);
  return NextResponse.json(result);
}
