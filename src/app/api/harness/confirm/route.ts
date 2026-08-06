import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  peekConfirmation,
  resolveConfirmation,
} from "@/lib/harness/confirmation";

/**
 * POST { confirmationId, approved } — resolve a pending side-effect confirmation.
 * The model (or Agent UI) should continue only after the user approves.
 */
export async function POST(req: Request) {
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

  const peek = peekConfirmation(confirmationId);
  if (!peek) {
    return NextResponse.json(
      { error: "Confirmation expired or not found." },
      { status: 404 },
    );
  }

  const result = resolveConfirmation(confirmationId, body.approved, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ...result,
    request: peek.request,
  });
}
