import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearDriveCookie, readDriveCookie } from "@/lib/drive-session";

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const stored = await readDriveCookie();
  if (stored?.accessToken) {
    // Best-effort revoke
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.accessToken)}`,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
    } catch {
      // ignore
    }
  }

  await clearDriveCookie();
  return NextResponse.json({ ok: true });
}
