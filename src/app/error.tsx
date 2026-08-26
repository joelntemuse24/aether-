"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Without this, any uncaught render error in
 * production is an unrecoverable blank screen.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[aether] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--canvas)] px-6 text-center">
      <h1 className="font-serif text-2xl text-[var(--text)]">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-[var(--muted)]">
        An unexpected error interrupted Aether. Your conversations are safe —
        try again, or reload the page.
        {error.digest ? (
          <span className="mt-2 block text-[11px] text-[var(--muted-soft)]">
            Error reference: {error.digest}
          </span>
        ) : null}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] transition-colors hover:bg-[var(--accent-muted)]"
        >
          Reload Aether
        </button>
      </div>
    </div>
  );
}
