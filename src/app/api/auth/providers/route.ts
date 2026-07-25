import { NextResponse } from "next/server";

/**
 * Returns which OAuth / email providers are configured on the server.
 * Used by the sign-in page to hide unavailable buttons.
 */
export async function GET() {
  const google = Boolean(
    (process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID) &&
      (process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET),
  );
  const github = Boolean(
    (process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID) &&
      (process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET),
  );
  const apple = Boolean(
    (process.env.APPLE_ID || process.env.AUTH_APPLE_ID) &&
      (process.env.APPLE_SECRET || process.env.AUTH_APPLE_SECRET),
  );
  const email = true; // always shown; server validates Resend at send time

  return NextResponse.json({ google, github, apple, email });
}
