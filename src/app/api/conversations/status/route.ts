import { NextResponse } from "next/server";
import { isCloudDbConfigured } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

/** Whether cloud history is available for this deployment + session. */
export async function GET() {
  const configured = isCloudDbConfigured();
  const session = await auth();
  const signedIn = !!(session?.user?.id || session?.user?.email);

  return NextResponse.json({
    configured,
    signedIn,
    cloud: configured && signedIn,
  });
}
