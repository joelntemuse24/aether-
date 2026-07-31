import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { cookies } from "next/headers";
import { setGitHubCookie } from "@/lib/github-session";

const STATE_COOKIE = "aether.github.oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent("missing_code")}`,
    );
  }

  const jar = await cookies();
  const rawState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (!rawState) {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent("invalid_state")}`,
    );
  }

  let parsed: { state: string; userId: string };
  try {
    parsed = JSON.parse(rawState) as { state: string; userId: string };
  } catch {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent("invalid_state")}`,
    );
  }

  const expected = createHash("sha256").update(parsed.state).digest("hex");
  if (expected !== stateParam || !parsed.userId) {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent("state_mismatch")}`,
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID;
  const clientSecret =
    process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent("not_configured")}`,
    );
  }

  const redirectUri = `${origin}/api/github/callback`;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    console.error("[github/callback] token exchange failed", tokenRes.status, body);
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent("token_exchange")}`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokens.access_token) {
    console.error("[github/callback] no access_token", tokens.error, tokens.error_description);
    return NextResponse.redirect(
      `${origin}/?github_error=${encodeURIComponent(tokens.error || "no_access_token")}`,
    );
  }

  let login: string | undefined;
  let name: string | undefined;
  try {
    const infoRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Aether",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as {
        login?: string;
        name?: string | null;
      };
      login = info.login;
      name = info.name ?? undefined;
    }
  } catch {
    // non-critical
  }

  await setGitHubCookie({
    userId: parsed.userId,
    accessToken: tokens.access_token,
    login,
    name,
  });

  return NextResponse.redirect(`${origin}/?github_connected=1`);
}
