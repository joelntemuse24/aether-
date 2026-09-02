import { NextResponse } from "next/server";
import { auth as triggerAuth } from "@trigger.dev/sdk";
import { isTriggerChatConfigured } from "@/lib/trigger/config";
import { publicTokenToJwt } from "@/lib/trigger/session-auth";

export const runtime = "nodejs";

/**
 * Thin: mint a session-scoped public access token for an existing chat.
 */
export async function POST(req: Request) {
  if (!isTriggerChatConfigured()) {
    return NextResponse.json(
      { error: "Durable chat is not configured." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { chatId?: string };
  const chatId =
    typeof body.chatId === "string"
      ? body.chatId.trim()
      : new URL(req.url).searchParams.get("chatId")?.trim() || "";
  if (!chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }

  const token = await triggerAuth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });

  console.info("[chat/mint-token]", { chatId });

  try {
    return new NextResponse(publicTokenToJwt(token), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Could not start chat." }, { status: 502 });
  }
}
