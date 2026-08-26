import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  confirmationReplayPayload,
  peekConfirmation,
  resolveConfirmation,
  verifyConfirmationReplaySig,
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
  if (peek.userId && peek.userId !== userId) {
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
    payload?: unknown;
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
  const replay = confirmationReplayPayload(body.payload);

  if (!peek) {
    // Guest / other isolate: the row lived only in the chat process.
    // Replay the echoed payload so Approve still executes.
    if (!body.approved) {
      return NextResponse.json({
        ok: true,
        needs_confirmation: false,
        confirmation_id: confirmationId,
        approved: false,
        note: "User declined. Do not perform the action; offer an alternative.",
        execution: null,
      });
    }
    if (
      !replay ||
      !isAetherOwnedToolName(replay.tool) ||
      replay.tool === "request_confirmation"
    ) {
      return NextResponse.json(
        { error: "Confirmation expired or not found." },
        { status: 404 },
      );
    }
    // The payload must carry the HMAC issued when the card was created —
    // otherwise anyone could execute tools by inventing a payload.
    if (
      !body.payload ||
      typeof body.payload !== "object" ||
      !verifyConfirmationReplaySig({
        confirmationId,
        payload: body.payload as Record<string, unknown>,
        userId,
      })
    ) {
      return NextResponse.json(
        { error: "Confirmation could not be verified. Ask again in chat." },
        { status: 403 },
      );
    }
    const execution = await executeAetherTool({
      name: replay.tool,
      args: replay.args,
      ctx: {
        userId,
        conversationId: null,
        projectId: replay.projectId,
        approvalMode: parseToolApprovalMode("ask"),
        hasMemory: !!(userId && isCloudDbConfigured()),
        hasDrive: false,
        hasGitHub: false,
        skipGate: true,
      },
    });
    return NextResponse.json({
      ok: true,
      needs_confirmation: false,
      confirmation_id: confirmationId,
      approved: true,
      note: "User approved. You may proceed with the described action carefully.",
      execution,
      replayed: true,
    });
  }

  const result = await resolveConfirmation(confirmationId, body.approved, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  let execution: unknown = null;
  const payload =
    confirmationReplayPayload(peek.request.payload) ?? replay;
  if (
    result.approved &&
    payload &&
    isAetherOwnedToolName(payload.tool) &&
    payload.tool !== "request_confirmation"
  ) {
    execution = await executeAetherTool({
      name: payload.tool,
      args: payload.args,
      ctx: {
        userId,
        conversationId: peek.conversationId,
        projectId: payload.projectId,
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
