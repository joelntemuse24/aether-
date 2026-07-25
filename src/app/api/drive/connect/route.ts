import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";

const DRIVE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

const STATE_COOKIE = "aether.drive.oauth_state";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id && !session?.user?.email) {
    const origin = new URL(req.url).origin;
    return NextResponse.redirect(
      `${origin}/auth/signin?callbackUrl=${encodeURIComponent("/settings?connect=drive")}`,
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      },
      { status: 503 },
    );
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/drive/callback`;
  const state = randomBytes(24).toString("hex");
  const userId = session.user.id || session.user.email || "";

  const jar = await cookies();
  jar.set(
    STATE_COOKIE,
    JSON.stringify({ state, userId }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // 10 minutes
    },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: createHash("sha256").update(state).digest("hex"),
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
