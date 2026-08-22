import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  peekConfirmation,
  resolveConfirmation,
} from "@/lib/harness/confirmation";
import { ensureConfirmationRepository } from "@/lib/harness/confirmation-store";
import { executeAetherTool, isAetherOwnedToolName } from "@/lib/hermes/aether-tools";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import { isCloudDbConfigured } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET ?id= — hydrate a confirm card after refresh.
 * POST { confirmationId, approved } — resolve a pending side-effect confirmation.
 */
export async function GET(req: Request) {
  ensureConfirmationRepository();
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email || null;
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const peek = await peekConfirmation(id);
  if (!peek) {
    return NextResponse.json(
      { error: "Confirmation expired or not found." },
      { status: 404 },
    );
  }
  if (peek.userId && userId && peek.userId !== userId) {
    return NextResponse.json(
      { error: "Confirmation belongs to another session." },
      { status: 403 },
    );
  }
  return NextResponse.json({
    confirmation_id: peek.id,
    status: peek.status,
    approved: peek.approved ?? null,
    request: peek.request,
  });
}

export async function POST(req: Request) {
  ensureConfirmationRepository();
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email || null;
  const body = (await req.json().catch(() => ({}))) as {
    confirmationId?: string;
    approved?: boolean;
  };
  const confirmationId =
    typeof body.confirmationId === "string" ? body.confirmationId.trim() : "";
  if (!confirmationId) {
    return NextResponse.json(
      { error: "confirmationId is required." },
      { status: 400 },
    );
  }
  if (typeof body.approved !== "boolean") {
    return NextResponse.json(
      { error: "approved must be true or false." },
      { status: 400 },
    );
  }

  const peek = await peekConfirmation(confirmationId);
  if (!peek) {
    return NextResponse.json(
      { error: "Confirmation expired or not found." },
      { status: 404 },
    );
  }

  const result = await resolveConfirmation(confirmationId, body.approved, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let execution: unknown = null;
  const payload = peek.request.payload as
    | { tool?: string; args?: unknown; projectId?: string | null }
    | undefined;
  if (
    result.approved &&
    payload?.tool &&
    isAetherOwnedToolName(payload.tool) &&
    payload.tool !== "request_confirmation"
  ) {
    execution = await executeAetherTool({
      name: payload.tool,
      args: payload.args ?? {},
      ctx: {
        userId,
        conversationId: peek.conversationId,
        projectId:
          typeof payload.projectId === "string" ? payload.projectId : null,
        runId: peek.runId,
        approvalMode: parseToolApprovalMode("ask"),
        hasMemory: !!(userId && isCloudDbConfigured()),
        hasDrive: false,
        hasGitHub: false,
        skipGate: true,
      },
    });
  }

  return NextResponse.json({
    ...result,
    request: peek.request,
    execution,
  });
}
