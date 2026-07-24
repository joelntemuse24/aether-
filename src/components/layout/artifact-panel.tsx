"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, XIcon, Code2Icon } from "lucide-react";
import { useArtifact } from "@/providers/artifact-provider";
import { cn } from "@/lib/utils";

export function ArtifactPanel() {
  const { artifact, open, closeArtifact } = useArtifact();
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"code" | "preview">("code");

  useEffect(() => {
    setCopied(false);
    setTab("code");
  }, [artifact?.id]);

  if (!open || !artifact) return null;

  const canPreview =
    artifact.language === "html" ||
    artifact.language === "htm" ||
    artifact.language === "svg";

  const onCopy = async () => {
    await navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside
      className={cn(
        "flex h-full w-full max-w-[min(100%,28rem)] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]",
        "animate-[slideIn_180ms_ease-out]",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Code2Icon className="size-4 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--text)]">
              {artifact.title}
            </div>
            <div className="text-[11px] lowercase text-[var(--muted-soft)]">
              {artifact.language}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCopy}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
            aria-label="Copy code"
            title="Copy"
          >
            {copied ? (
              <CheckIcon className="size-4 text-emerald-600" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={closeArtifact}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
            aria-label="Close panel"
            title="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      {canPreview && (
        <div className="flex gap-1 border-b border-[var(--border)] px-3 py-1.5">
          {(["code", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "bg-[var(--elevated)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "preview" && canPreview ? (
          <iframe
            title="Artifact preview"
            sandbox="allow-scripts"
            srcDoc={artifact.code}
            className="h-full min-h-[20rem] w-full border-0 bg-white"
          />
        ) : (
          <pre className="h-full overflow-auto p-4 font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed text-[var(--text)]">
            <code>{artifact.code}</code>
          </pre>
        )}
      </div>
    </aside>
  );
}
