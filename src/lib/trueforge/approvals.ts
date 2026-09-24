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
};

export function encodeTrueForgeApproval(value: TrueForgeApproval): string {
  return `tf_${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

export function decodeTrueForgeApproval(id: string): TrueForgeApproval | null {
  if (!id.startsWith("tf_")) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(id.slice(3), "base64url").toString("utf8"),
    ) as TrueForgeApproval;
    if (!parsed.sessionId || !parsed.threadId || !parsed.toolCallId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Resume a paused harness turn and return the assistant text for the thread. */
export async function resumeTrueForgeApproval(
  confirmationId: string,
  approved: boolean,
): Promise<Response | null> {
  const row = decodeTrueForgeApproval(confirmationId);
  if (!row) return null;
  const turn = await trueforgeClient().sessions.createTurnStream(row.sessionId, {
    input: [
      {
        type: "user.tool_approval",
        threadId: row.threadId,
        toolCallId: row.toolCallId,
        approval: approved ? { status: "allow" } : { status: "deny" },
      },
    ],
  });
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
    approved,
    status: approved ? "approved" : "declined",
    confirmation_id: confirmationId,
    assistantText,
  });
}
