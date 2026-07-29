"use client";

import { useEffect, useRef, useState, type FC } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PanelRightOpenIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useArtifact, type Artifact } from "@/providers/artifact-provider";
import {
  TOOL_NAMES,
  getToolDisplay,
  type ArtifactKind,
  type CreateArtifactInput,
  type CreateArtifactOutput,
  type ExecutePythonInput,
  type ExecutePythonOutput,
  type WebSearchOutput,
} from "@/lib/tools";

/** Structural view of an assistant-ui enriched tool-call part. */
export type ToolPartLike = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  status?: { type?: string };
};

function partIsRunning(part: ToolPartLike): boolean {
  if (part.result !== undefined) return false;
  const t = part.status?.type;
  return t === "running" || t === "requires-action" || t === undefined;
}

const ICONS: Record<string, FC<{ className?: string }>> = {
  [TOOL_NAMES.executePython]: TerminalIcon,
  [TOOL_NAMES.webSearch]: SearchIcon,
  [TOOL_NAMES.createArtifact]: SparklesIcon,
};

const ToolShell: FC<{
  name: string;
  running: boolean;
  error?: boolean;
  subtitle?: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
  headerAction?: React.ReactNode;
}> = ({ name, running, error, subtitle, defaultOpen, children, headerAction }) => {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const display = getToolDisplay(name);
  const Icon = ICONS[name] ?? WrenchIcon;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] font-[family-name:var(--font-sans)] text-[13px]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md",
              error
                ? "bg-[var(--error-bg)] text-[var(--error-text)]"
                : "bg-[var(--elevated)] text-[var(--accent)]",
            )}
          >
            {running ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : error ? (
              <AlertTriangleIcon className="size-3.5" />
            ) : (
              <Icon className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium text-[var(--text)]">
              {running ? display.runningLabel : display.label}
            </span>
            {subtitle && (
              <span className="ml-2 truncate text-[var(--muted)]">
                {subtitle}
              </span>
            )}
          </span>
          {!running &&
            (error ? (
              <AlertTriangleIcon className="size-3.5 shrink-0 text-[var(--error-text)]" />
            ) : (
              <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
            ))}
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-[var(--muted)] transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {headerAction}
      </div>
      {open && children && (
        <div className="border-t border-[var(--border)] px-3 py-2.5">
          {children}
        </div>
      )}
    </div>
  );
};

const CodeSnippet: FC<{ code: string; label?: string }> = ({ code, label }) => (
  <div className="mt-1">
    {label && (
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-soft)]">
        {label}
      </div>
    )}
    <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--code-bg)] p-2.5 font-[family-name:var(--font-mono)] text-[12px] leading-relaxed text-[var(--text)]">
      <code>{code}</code>
    </pre>
  </div>
);

/* ─── Python ─── */

const PythonToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as Partial<ExecutePythonInput> | undefined;
  const output = part.result as ExecutePythonOutput | undefined;
  const error = output ? !output.ok : part.isError;

  return (
    <ToolShell
      name={TOOL_NAMES.executePython}
      running={running}
      error={error}
      subtitle={input?.description}
      defaultOpen={!!error}
    >
      {input?.code && <CodeSnippet code={input.code} label="Code" />}
      {output && (
        <div className="mt-2 space-y-2">
          {output.stdout?.trim() && (
            <CodeSnippet code={output.stdout.trimEnd()} label="Output" />
          )}
          {output.result !== undefined && output.result !== "" && (
            <CodeSnippet code={String(output.result)} label="Result" />
          )}
          {output.error && (
            <div className="rounded-lg bg-[var(--error-bg)] p-2.5 font-[family-name:var(--font-mono)] text-[12px] text-[var(--error-text)]">
              {output.error}
            </div>
          )}
          {output.durationMs !== undefined && (
            <div className="text-[11px] text-[var(--muted-soft)]">
              Finished in {output.durationMs} ms
            </div>
          )}
        </div>
      )}
    </ToolShell>
  );
};

/* ─── Web search ─── */

const WebSearchToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { query?: string } | undefined;
  const output = part.result as WebSearchOutput | undefined;
  const error = output ? !output.ok : part.isError;

  return (
    <ToolShell
      name={TOOL_NAMES.webSearch}
      running={running}
      error={error}
      subtitle={input?.query}
      defaultOpen={!running}
    >
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {output?.results && output.results.length > 0 && (
        <ul className="space-y-2.5">
          {output.results.map((r, i) => (
            <li key={i} className="text-[13px]">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                >
                  {r.title}
                  <ExternalLinkIcon className="size-3" />
                </a>
              ) : (
                <span className="font-medium text-[var(--text)]">{r.title}</span>
              )}
              <p className="mt-0.5 text-[var(--muted)]">{r.snippet}</p>
            </li>
          ))}
        </ul>
      )}
      {output?.source && (
        <div className="mt-2 text-[11px] text-[var(--muted-soft)]">
          Source: {output.source}
        </div>
      )}
    </ToolShell>
  );
};

/* ─── Create artifact ─── */

function guessImageMime(content: string): string | undefined {
  const m = content.match(/^data:([^;]+);/);
  if (m) return m[1];
  if (content.endsWith(".png")) return "image/png";
  if (content.endsWith(".svg")) return "image/svg+xml";
  if (content.match(/\.jpe?g$/)) return "image/jpeg";
  return undefined;
}

function toArtifact(id: string, input: CreateArtifactInput): Artifact {
  const kind = (input.kind ?? "code") as ArtifactKind;
  return {
    id,
    title: input.title || "Artifact",
    kind,
    language: input.language,
    code: input.content ?? "",
    mime: kind === "image" ? guessImageMime(input.content ?? "") : undefined,
  };
}

const CreateArtifactToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const { openArtifact, refreshSaved } = useArtifact();
  const running = partIsRunning(part);
  const input = part.args as Partial<CreateArtifactInput> | undefined;
  const result = part.result as CreateArtifactOutput | undefined;
  const complete =
    part.result !== undefined && !!input?.content && !!input?.title;
  const openedRef = useRef(false);

  const artifactId = result?.id || part.toolCallId;
  const artifact =
    input?.content && input?.title
      ? toArtifact(artifactId, input as CreateArtifactInput)
      : null;

  // Auto-open the panel once when the artifact is fully created.
  useEffect(() => {
    if (complete && artifact && !openedRef.current) {
      openedRef.current = true;
      openArtifact({
        ...artifact,
        persisted: !!result?.persisted,
      });
      if (result?.persisted) void refreshSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  return (
    <ToolShell
      name={TOOL_NAMES.createArtifact}
      running={running}
      subtitle={
        input?.title
          ? result?.persisted
            ? `${input.title} · saved`
            : input.title
          : undefined
      }
      headerAction={
        artifact ? (
          <button
            type="button"
            onClick={() => openArtifact(artifact)}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-2 py-1 text-[12px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover-overlay)]"
          >
            <PanelRightOpenIcon className="size-3.5" />
            Open
          </button>
        ) : undefined
      }
    >
      {input?.kind && (
        <div className="text-[12px] text-[var(--muted)]">
          {input.kind} artifact
          {input.language ? ` · ${input.language}` : ""}
        </div>
      )}
    </ToolShell>
  );
};

/* ─── Generic fallback ─── */

const GenericToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  return (
    <ToolShell
      name={part.toolName}
      running={running}
      error={part.isError}
      defaultOpen={false}
    >
      {part.argsText && <CodeSnippet code={part.argsText} label="Input" />}
      {part.result !== undefined && (
        <CodeSnippet
          code={JSON.stringify(part.result, null, 2)}
          label="Output"
        />
      )}
    </ToolShell>
  );
};

export const ToolCallPart: FC<{ part: ToolPartLike }> = ({ part }) => {
  switch (part.toolName) {
    case TOOL_NAMES.executePython:
      return <PythonToolCall part={part} />;
    case TOOL_NAMES.webSearch:
      return <WebSearchToolCall part={part} />;
    case TOOL_NAMES.createArtifact:
      return <CreateArtifactToolCall part={part} />;
    default:
      return <GenericToolCall part={part} />;
  }
};
