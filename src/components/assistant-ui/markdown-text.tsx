"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { type FC, memo, useState } from "react";
import { CheckIcon, CopyIcon, PanelRightOpenIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { useArtifact } from "@/providers/artifact-provider";

const ARTIFACT_LANGS = new Set([
  "html",
  "htm",
  "jsx",
  "tsx",
  "javascript",
  "typescript",
  "js",
  "ts",
  "css",
  "python",
  "py",
  "react",
  "svg",
  "xml",
  "json",
  "md",
  "markdown",
  "sql",
  "bash",
  "sh",
  "shell",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
]);

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md prose-aether"
      components={defaultComponents}
      defer
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const { openArtifact } = useArtifact();
  const lang = (language || "text").toLowerCase();
  const canOpenArtifact =
    !!code && code.split("\n").length >= 8 && ARTIFACT_LANGS.has(lang);

  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  const onOpenArtifact = () => {
    if (!code) return;
    openArtifact({
      id: `${lang}-${code.slice(0, 24).replace(/\s/g, "")}`,
      title: language ? `${language} artifact` : "Code artifact",
      language: lang,
      code,
    });
  };

  return (
    <div className="mt-3 flex items-center justify-between rounded-t-xl border border-b-0 border-[var(--border)] bg-[var(--elevated)] px-3.5 py-1.5 text-xs">
      <span className="font-medium lowercase text-[var(--muted)]">
        {language || "code"}
      </span>
      <div className="flex items-center gap-0.5">
        {canOpenArtifact && (
          <TooltipIconButton
            tooltip="Open in panel"
            onClick={onOpenArtifact}
            className="size-6"
          >
            <PanelRightOpenIcon className="size-3.5" />
          </TooltipIconButton>
        )}
        <TooltipIconButton tooltip="Copy" onClick={onCopy} className="size-6">
          {!isCopied ? (
            <CopyIcon className="size-3.5" />
          ) : (
            <CheckIcon className="size-3.5 text-emerald-600" />
          )}
        </TooltipIconButton>
      </div>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 2000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = (value: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "mb-2 mt-5 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mb-2 mt-5 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "mb-1.5 mt-4 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "mb-1 mt-3.5 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn("my-3 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "text-[var(--accent)] underline underline-offset-2 hover:opacity-80",
        className,
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "my-3 border-s-2 border-[var(--border)] ps-4 text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "my-3 ms-5 list-disc marker:text-[var(--muted)] [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "my-3 ms-5 list-decimal marker:text-[var(--muted)] [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("my-4 border-[var(--border)]", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-3 w-full overflow-x-auto">
      <table
        className={cn(
          "w-full border-separate border-spacing-0 text-[0.95em]",
          className,
        )}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "bg-[var(--elevated)] px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "border-b border-s border-[var(--border)] px-3 py-1.5 text-start last:border-e",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr className={cn("m-0 p-0", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("leading-[1.65]", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "overflow-x-auto rounded-b-xl rounded-t-none border border-t-0 border-[var(--border)] bg-[#f7f4ed] p-3.5 font-[family-name:var(--font-geist-mono)] text-[13px] leading-relaxed text-[var(--text)]",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "rounded-md bg-[var(--elevated)] px-1.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
