import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";

/** Repo access + identity for a useful one-click connector. */
const GITHUB_SCOPES = ["repo", "read:user"].join(" ");

const STATE_COOKIE = "aether.github.oauth_state";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id && !session?.user?.email) {
    const origin = new URL(req.url).origin;
    return NextResponse.redirect(
      `${origin}/auth/signin?callbackUrl=${encodeURIComponent("/?connect=github")}`,
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID;
  const clientSecret =
    process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
      },
      { status: 503 },
    );
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/github/callback`;
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
      maxAge: 600,
    },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_SCOPES,
    state: createHash("sha256").update(state).digest("hex"),
    allow_signup: "true",
  });

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  );
}
