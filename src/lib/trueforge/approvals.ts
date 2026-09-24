import { NextResponse } from "next/server";
import { trueforgeClient } from "./sessions";

type Pending = {
  sessionId: string;
  threadId: string;
  toolCallId: string;
};

const pending = new Map<string, Pending>();

export function rememberTrueForgeApproval(id: string, value: Pending) {
  pending.set(id, value);
}

export async function resumeTrueForgeApproval(
  confirmationId: string,
  approved: boolean,
): Promise<Response | null> {
  if (!confirmationId.startsWith("tf_")) return null;
  const row = pending.get(confirmationId);
  if (!row) {
    return NextResponse.json(
      { error: "Confirmation expired or not found." },
      { status: 404 },
    );
  }
  pending.delete(confirmationId);
  await trueforgeClient().sessions.createTurn(row.sessionId, {
    input: [
      {
        type: "user.tool_approval",
        threadId: row.threadId,
        toolCallId: row.toolCallId,
        approval: approved ? { status: "allow" } : { status: "deny" },
      },
    ],
  });
  return NextResponse.json({
    ok: true,
    approved,
    confirmation_id: confirmationId,
  });
}
