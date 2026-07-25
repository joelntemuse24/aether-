"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";

function VerifyInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing verification token.");
      return;
    }

    let cancelled = false;
    (async () => {
      const result = await signIn("email-magic", {
        token,
        redirect: false,
        callbackUrl: "/",
      });
      if (cancelled) return;
      if (result?.error) {
        setError("This link is invalid or has expired.");
        return;
      }
      router.replace(result?.url || "/");
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--canvas)] px-4 text-center">
        <p className="text-sm text-[var(--error-text)]">{error}</p>
        <Link
          href="/auth/signin"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--canvas)] text-[var(--muted)]">
      <Loader2Icon className="size-5 animate-spin" />
      <p className="text-sm">Signing you in…</p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] text-[var(--muted)]">
          <Loader2Icon className="size-5 animate-spin" />
        </div>
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
