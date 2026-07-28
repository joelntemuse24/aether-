import { auth } from "@/auth";
import { isCloudDbConfigured } from "@/lib/db";

export async function requireCloudUser(): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }
> {
  if (!isCloudDbConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Cloud conversation storage is not configured.",
    };
  }

  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;
  if (!userId) {
    return { ok: false, status: 401, error: "Sign in to sync conversations." };
  }

  return { ok: true, userId };
}
