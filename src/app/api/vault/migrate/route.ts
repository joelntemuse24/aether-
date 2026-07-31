import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { createVaultNote, listVaultNotes } from "@/lib/vault/store";

export const runtime = "nodejs";

/**
 * Import browser-local Vault notes into the signed-in user's cloud store.
 * Skips notes whose title+content already exist. Always assigns fresh ids.
 */
export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as {
    notes?: Array<{ title?: string; content?: string }>;
  };

  const items = Array.isArray(body.notes) ? body.notes.slice(0, 200) : [];
  const existing = await listVaultNotes(gate.userId);
  const seen = new Set(
    existing.map((n) => `${n.title.trim()}\n${n.content.trim()}`),
  );

  let imported = 0;
  let skipped = 0;

  for (const item of items) {
    const title = item.title?.trim() || "Untitled note";
    const content = item.content?.trim() ?? "";
    if (!title && !content) {
      skipped += 1;
      continue;
    }
    const key = `${title}\n${content}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    try {
      await createVaultNote(gate.userId, { title, content });
      seen.add(key);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  return NextResponse.json({ imported, skipped, total: items.length });
}
