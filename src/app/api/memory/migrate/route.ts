import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { writeMemory } from "@/lib/memory/store";

export const runtime = "nodejs";

/**
 * Import browser-local memory records into the signed-in user's cloud store.
 * Always assigns fresh ids (local UUIDs are not reused) to avoid cross-user
 * collisions. Clients should only clear local storage when skipped === 0.
 */
export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as {
    memories?: Array<{
      type?: string;
      title?: string;
      body?: string;
      importance?: string;
      tags?: string[];
    }>;
  };

  const items = Array.isArray(body.memories) ? body.memories.slice(0, 200) : [];
  let imported = 0;
  let skipped = 0;

  for (const item of items) {
    if (!item.title?.trim() || !item.body?.trim()) {
      skipped += 1;
      continue;
    }
    try {
      await writeMemory(gate.userId, {
        type: item.type,
        title: item.title.trim(),
        body: item.body.trim(),
        importance: item.importance,
        tags: item.tags,
      });
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  return NextResponse.json({ imported, skipped, total: items.length });
}
