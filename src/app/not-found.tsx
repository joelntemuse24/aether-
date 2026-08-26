import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--canvas)] px-6 text-center">
      <h1 className="font-serif text-2xl text-[var(--text)]">Page not found</h1>
      <p className="max-w-md text-sm leading-relaxed text-[var(--muted)]">
        That page doesn&apos;t exist. Head back to your conversations.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        Back to Aether
      </Link>
    </div>
  );
}
