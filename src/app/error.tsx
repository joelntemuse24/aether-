"use client";

export default function ChatPageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="max-w-sm text-[16px] leading-relaxed text-[var(--text)]">
        Couldn’t load this chat. Your history is still here — try again.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] text-white"
      >
        Try again
      </button>
    </div>
  );
}
