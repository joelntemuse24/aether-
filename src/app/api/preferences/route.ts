import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import {
  getUserPreferences,
  saveUserPreferences,
} from "@/lib/preferences/store";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const prefs = await getUserPreferences(gate.userId);
  return NextResponse.json({
    toolApprovalMode: prefs.toolApprovalMode,
  });
}

export async function PUT(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    toolApprovalMode?: unknown;
  };
  const toolApprovalMode = parseToolApprovalMode(body.toolApprovalMode);
  const prefs = await saveUserPreferences(gate.userId, { toolApprovalMode });
  return NextResponse.json({
    toolApprovalMode: prefs.toolApprovalMode,
  });
}
