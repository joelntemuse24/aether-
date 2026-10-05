import { NextResponse } from "next/server";
import { trueforgeClient } from "./sessions";
import {
  chunksForTrueForgeEvent,
  closeTrueForgeUi,
  createTrueForgeUiState,
} from "./ui-chunks";

export type TrueForgeApproval = {
  sessionId: string;
  threadId: string;
  toolCallId: string;
  kind?: "approval" | "response";
};

export function encodeTrueForgeApproval(value: TrueForgeApproval): string {
  return `tf_${Buffer.from(JSON.stringify({ ...value, kind: value.kind ?? "approval" }), "utf8").toString("base64url")}`;
}

export function decodeTrueForgeApproval(id: string): TrueForgeApproval | null {
  if (!id.startsWith("tf_")) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(id.slice(3), "base64url").toString("utf8"),
    ) as TrueForgeApproval;
    if (![parsed.sessionId, parsed.threadId, parsed.toolCallId].every((value) => typeof value === "string" && value)) return null;
    if (parsed.kind !== undefined && parsed.kind !== "approval" && parsed.kind !== "response") return null;
    return { ...parsed, kind: parsed.kind ?? "approval" };
  } catch {
    return null;
  }
}

/** Resume a paused harness turn and return the assistant text for the thread. */
export async function resumeTrueForgeApproval(
  confirmationId: string,
  approved: boolean,
): Promise<Response | null> {
  return resumeTrueForgePause(confirmationId, { approved });
}

export async function resumeTrueForgeToolResponse(
  confirmationId: string,
  content: string,
): Promise<Response | null> {
  return resumeTrueForgePause(confirmationId, { content });
}

/** Shared turn input builder also lets unit tests verify the wire protocol. */
export function trueForgeResumeInput(row: TrueForgeApproval, decision: { approved: boolean } | { content: string }) {
  return {
    input: ["content" in decision
      ? { type: "user.tool_response" as const, threadId: row.threadId, toolCallId: row.toolCallId, content: decision.content }
      : { type: "user.tool_approval" as const, threadId: row.threadId, toolCallId: row.toolCallId, approval: { status: decision.approved ? "allow" as const : "deny" as const } }],
  };
}

async function resumeTrueForgePause(confirmationId: string, decision: { approved: boolean } | { content: string }): Promise<Response | null> {
  const row = decodeTrueForgeApproval(confirmationId);
  if (!row) return null;
  const turn = await trueforgeClient().sessions.createTurnStream(row.sessionId, trueForgeResumeInput(row, decision));
  const state = createTrueForgeUiState();
  let assistantText = "";
  let failed = false;
  for await (const event of turn) {
    for (const chunk of chunksForTrueForgeEvent(
      event as unknown as { type?: string; [key: string]: unknown },
      state,
    )) {
      if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
        assistantText += chunk.delta;
      }
      if (chunk.type === "error") failed = true;
    }
  }
  closeTrueForgeUi(state);
  if (failed && !assistantText.trim()) {
    return NextResponse.json(
      { error: "The harness could not resume this step." },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...("content" in decision
      ? { status: "responded", needs_response: false }
      : { approved: decision.approved, status: decision.approved ? "approved" : "declined" }),
    confirmation_id: confirmationId,
    assistantText,
  });
}
