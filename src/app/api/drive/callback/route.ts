import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { cookies } from "next/headers";
import { setDriveCookie } from "@/lib/drive-session";

const STATE_COOKIE = "aether.drive.oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("missing_code")}`,
    );
  }

  const jar = await cookies();
  const rawState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (!rawState) {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("invalid_state")}`,
    );
  }

  let parsed: { state: string; userId: string };
  try {
    parsed = JSON.parse(rawState) as { state: string; userId: string };
  } catch {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("invalid_state")}`,
    );
  }

  const expected = createHash("sha256").update(parsed.state).digest("hex");
  if (expected !== stateParam || !parsed.userId) {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("state_mismatch")}`,
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("not_configured")}`,
    );
  }

  const redirectUri = `${origin}/api/drive/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    console.error("[drive/callback] token exchange failed", tokenRes.status, body);
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("token_exchange")}`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokens.access_token) {
    return NextResponse.redirect(
      `${origin}/?drive_error=${encodeURIComponent("no_access_token")}`,
    );
  }

  // Fetch email for display
  let email: string | undefined;
  try {
    const infoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { email?: string };
      email = info.email;
    }
  } catch {
    // non-critical
  }

  // Prefer new refresh token; if Google omitted it (already granted), keep going
  // only when we have one — otherwise connection won't survive access token expiry.
  if (!tokens.refresh_token) {
    console.warn(
      "[drive/callback] No refresh_token returned. User may need to revoke app access and reconnect.",
    );
  }

  await setDriveCookie({
    userId: parsed.userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 - 60_000,
    email,
  });

  return NextResponse.redirect(`${origin}/?drive_connected=1`);
}
