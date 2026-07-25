import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidDriveAccessToken, readDriveCookie } from "@/lib/drive-session";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;

  if (!userId) {
    return NextResponse.json({ connected: false, authenticated: false });
  }

  const stored = await readDriveCookie();
  if (!stored || stored.userId !== userId) {
    return NextResponse.json({
      connected: false,
      authenticated: true,
      googleConfigured: Boolean(
        (process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID) &&
          (process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET),
      ),
    });
  }

  // Validate / refresh token
  const valid = await getValidDriveAccessToken(userId);
  if (!valid) {
    return NextResponse.json({
      connected: false,
      authenticated: true,
      googleConfigured: true,
    });
  }

  return NextResponse.json({
    connected: true,
    authenticated: true,
    email: valid.email || stored.email || null,
    googleConfigured: true,
  });
}
