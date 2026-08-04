"use client";

import { useEffect, useState, type FC } from "react";
import {
  BracesIcon,
  CodeIcon,
  FileTextIcon,
  ImageIcon,
  SparklesIcon,
} from "lucide-react";
import { useArtifact } from "@/providers/artifact-provider";
import { cn } from "@/lib/utils";

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-3";
  if (kind === "document") return <FileTextIcon className={cls} />;
  if (kind === "code") return <CodeIcon className={cls} />;
  if (kind === "data") return <BracesIcon className={cls} />;
  if (kind === "image" || kind === "svg") return <ImageIcon className={cls} />;
  return <SparklesIcon className={cls} />;
}

/**
 * Quiet locational hint while an artifact is drafting and the inspector is
 * closed — ported from the Figma Make DraftingPeek.
 */
export const ArtifactDraftingPeek: FC = () => {
  const { drafting, open, artifact, openArtifact } = useArtifact();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!drafting || open) {
      setVisible(false);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), 1500);
    return () => {
      window.clearTimeout(t);
      setVisible(false);
    };
  }, [drafting, open]);

  if (!visible || !drafting || open) return null;

  const charHint =
    typeof drafting.charCount === "number" && drafting.charCount > 0
      ? `${drafting.charCount.toLocaleString()} chars`
      : null;

  return (
    <>
      {/* Desktop — anchored to the right inspector rail */}
      <button
        type="button"
        onClick={() => {
          if (artifact) openArtifact(artifact);
        }}
        aria-label={`Open artifact: ${drafting.title}`}
        className={cn(
          "fixed right-4 z-30 hidden w-[13.5rem] cursor-pointer select-none flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--elevated-deep)] p-3.5 text-left shadow-lg lg:flex",
          "animate-[fadeIn_220ms_ease-out]",
        )}
        style={{ top: "calc(50% - 72px)" }}
      >
        <span className="inline-flex w-fit items-center gap-1 rounded-md bg-[var(--accent-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
          <KindIcon kind={drafting.kind} />
          {drafting.kind}
        </span>
        <span className="text-[12px] font-medium leading-snug text-[var(--text)]">
          {drafting.title}
        </span>
        <span className="text-[11px] text-[var(--muted)]">
          Drafting in the inspector →
          {charHint ? ` · ${charHint}` : ""}
        </span>
        <span
          className="relative h-[3px] overflow-hidden rounded-full bg-[var(--border)]"
          aria-hidden
        >
          <span className="absolute inset-y-0 left-0 w-1/2 animate-[aetherPeek_1.8s_ease-in-out_infinite] rounded-full bg-[var(--accent)]" />
        </span>
      </button>

      {/* Mobile — foreshadows the sheet */}
      <button
        type="button"
        onClick={() => {
          if (artifact) openArtifact(artifact);
        }}
        aria-label={`Open artifact: ${drafting.title}`}
        className={cn(
          "fixed inset-x-4 bottom-20 z-30 flex cursor-pointer select-none items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--elevated-deep)] px-3.5 py-3 text-left shadow-lg lg:hidden",
          "animate-[fadeIn_220ms_ease-out]",
        )}
      >
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
          <KindIcon kind={drafting.kind} />
          {drafting.kind}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[var(--text)]">
            {drafting.title}
          </span>
          <span className="block text-[11px] text-[var(--muted)]">
            Opening here →
          </span>
        </span>
      </button>
    </>
  );
};
