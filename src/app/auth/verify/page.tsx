"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";

function safeCallbackUrl(raw: string | null): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

const VERIFY_TIMEOUT_MS = 20000;

function VerifyInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setError("This sign-in link is incomplete. Request a new link to continue.");
      return;
    }
    // Guard against React Strict Mode double-invoking effects.
    // Do not cancel the in-flight signIn — the first attempt must finish.
    if (started.current) return;
    started.current = true;

    // Never leave the spinner running forever on a stalled request.
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      setError("Sign-in is taking too long. Check your connection and try again.");
    }, VERIFY_TIMEOUT_MS);

    (async () => {
      try {
        const result = await signIn("email-magic", {
          token,
          redirect: false,
          callbackUrl,
        });
        settled = true;
        clearTimeout(timeout);
        if (!result || result.error) {
          setError(
            "This sign-in link is invalid or has expired. Request a new link to continue.",
          );
          return;
        }
        router.replace(result.url || callbackUrl || "/");
      } catch {
        settled = true;
        clearTimeout(timeout);
        setError("Could not complete sign-in. Check your connection and try again.");
      }
    })();
  }, [token, callbackUrl, router]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--canvas)] px-4 text-center">
        <p className="text-sm text-[var(--error-text)]">{error}</p>
        <Link
          href="/auth/signin"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Request a new link
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
