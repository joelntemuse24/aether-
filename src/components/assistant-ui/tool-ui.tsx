"use client";

import { useEffect, useRef, useState, type FC } from "react";
import {
  AlertTriangleIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileIcon,
  GlobeIcon,
  FolderGit2Icon,
  HardDriveIcon,
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

/**
 * Best-effort extract of a JSON string field from partial tool argsText
 * while the model is still streaming the tool-call arguments.
 */
function extractPartialJsonString(
  argsText: string | undefined,
  key: string,
): string | undefined {
  if (!argsText) return undefined;
  const needle = `"${key}"`;
  const keyIdx = argsText.indexOf(needle);
  if (keyIdx < 0) return undefined;
  let i = keyIdx + needle.length;
  while (i < argsText.length && /[\s:]/.test(argsText[i]!)) i++;
  if (argsText[i] !== '"') return undefined;
  i++;
  let out = "";
  while (i < argsText.length) {
    const ch = argsText[i]!;
    if (ch === "\\") {
      const next = argsText[i + 1];
      if (next === undefined) break;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"' || next === "\\") out += next;
      else if (next === "u" && /^[0-9a-fA-F]{4}/.test(argsText.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(argsText.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  return out;
}

const ICONS: Record<string, FC<{ className?: string }>> = {
  [TOOL_NAMES.executePython]: TerminalIcon,
  [TOOL_NAMES.webSearch]: SearchIcon,
  [TOOL_NAMES.createArtifact]: SparklesIcon,
  [TOOL_NAMES.memorySearch]: BrainIcon,
  [TOOL_NAMES.memoryWrite]: BrainIcon,
  [TOOL_NAMES.driveSearch]: HardDriveIcon,
  [TOOL_NAMES.driveRead]: HardDriveIcon,
  [TOOL_NAMES.githubGetRepo]: FolderGit2Icon,
  [TOOL_NAMES.githubListContents]: FolderGit2Icon,
  [TOOL_NAMES.githubReadFile]: FolderGit2Icon,
  [TOOL_NAMES.fetchUrl]: GlobeIcon,
  [TOOL_NAMES.toolSearch]: WrenchIcon,
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

  // When a finished tool prefers to open (errors, useful results), sync once.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <div
      className={cn(
        "my-1.5 overflow-hidden rounded-lg bg-[var(--elevated)] font-[family-name:var(--font-sans)] text-[13px]",
        "transition-[opacity,transform] duration-200 ease-out",
        running ? "opacity-100" : "opacity-95",
      )}
    >
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
          {!!children && (
            <ChevronDownIcon
              className={cn(
                "size-4 shrink-0 text-[var(--muted)] transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          )}
        </button>
        {headerAction}
      </div>
      {open && children && (
        <div className="border-t border-[var(--border)] px-3 py-2.5 animate-[fadeIn_150ms_ease-out]">
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
  const code =
    typeof input?.code === "string"
      ? input.code
      : extractPartialJsonString(part.argsText, "code");
  const description =
    input?.description || extractPartialJsonString(part.argsText, "description");

  return (
    <ToolShell
      name={TOOL_NAMES.executePython}
      running={running}
      error={error}
      subtitle={description}
      defaultOpen={!!error || (running && !!code)}
    >
      {code && (
        <CodeSnippet code={code} label={running ? "Writing code…" : "Code"} />
      )}
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
  const resultCount = output?.results?.length ?? 0;
  const query =
    input?.query || extractPartialJsonString(part.argsText, "query");

  return (
    <ToolShell
      name={TOOL_NAMES.webSearch}
      running={running}
      error={error}
      subtitle={
        query
          ? resultCount > 0
            ? `${query} · ${resultCount} hit${resultCount === 1 ? "" : "s"}`
            : query
          : undefined
      }
      // Keep collapsed by default — research turns often fire several searches.
      defaultOpen={!!error || !!output?.warning}
    >
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {output?.warning && (
        <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--elevated)] p-2.5 text-[12px] text-[var(--muted)]">
          {output.warning}
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
      {!running && output?.ok && resultCount === 0 && !output.error && (
        <p className="text-[12px] text-[var(--muted)]">No results returned.</p>
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
  const { openArtifact, refreshSaved, artifact: openPanelArtifact, open } =
    useArtifact();
  const running = partIsRunning(part);
  const input = part.args as Partial<CreateArtifactInput> | undefined;
  const result = part.result as CreateArtifactOutput | undefined;
  const complete =
    part.result !== undefined && !!input?.content && !!input?.title;
  const openedRef = useRef(false);
  const lastSyncedLen = useRef(0);

  const streamingTitle =
    input?.title || extractPartialJsonString(part.argsText, "title");
  const kindHint =
    (input?.kind as string | undefined) ||
    extractPartialJsonString(part.argsText, "kind") ||
    part.argsText?.match(/"kind"\s*:\s*"(\w+)"/)?.[1];
  const streamingContent =
    typeof input?.content === "string"
      ? input.content
      : extractPartialJsonString(part.argsText, "content");
  const streamingLanguage =
    input?.language || extractPartialJsonString(part.argsText, "language");

  const artifactId = result?.id || part.toolCallId;
  const draft: Artifact | null =
    streamingTitle && streamingContent !== undefined
      ? toArtifact(artifactId, {
          title: streamingTitle,
          kind: (kindHint as ArtifactKind) || "code",
          language: streamingLanguage,
          content: streamingContent,
        })
      : null;

  const completeArtifact =
    complete && input?.content && input?.title
      ? toArtifact(artifactId, input as CreateArtifactInput)
      : null;
  const artifact = completeArtifact ?? draft;

  // Open early while writing; keep the panel in sync if the user left it open.
  useEffect(() => {
    if (!artifact) return;

    if (complete) {
      if (!openedRef.current || (open && openPanelArtifact?.id === artifact.id)) {
        openedRef.current = true;
        openArtifact({
          ...artifact,
          persisted: !!result?.persisted,
        });
      }
      if (result?.persisted) void refreshSaved();
      lastSyncedLen.current = artifact.code.length;
      return;
    }

    if (!running) return;
    // Wait for a little body so we don't flash an empty panel.
    if (artifact.code.length < 24) return;

    if (!openedRef.current) {
      openedRef.current = true;
      lastSyncedLen.current = artifact.code.length;
      openArtifact(artifact);
      return;
    }

    // Live-update only if the panel is still showing this draft.
    if (
      open &&
      openPanelArtifact?.id === artifact.id &&
      artifact.code.length !== lastSyncedLen.current
    ) {
      lastSyncedLen.current = artifact.code.length;
      openArtifact(artifact);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, complete, artifact?.code, artifact?.title, artifact?.id]);

  const previewLabel =
    kindHint === "document"
      ? "Writing"
      : kindHint === "code"
        ? "Coding"
        : "Building";
  const charHint =
    streamingContent !== undefined
      ? `${streamingContent.length.toLocaleString()} chars`
      : undefined;

  return (
    <ToolShell
      name={TOOL_NAMES.createArtifact}
      running={running}
      defaultOpen={running && !!streamingContent}
      subtitle={
        streamingTitle
          ? result?.persisted
            ? `${streamingTitle} · saved`
            : running
              ? `${streamingTitle}${charHint ? ` · ${charHint}` : ""}`
              : streamingTitle
          : kindHint
            ? `Creating ${kindHint}…`
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
      {(kindHint || streamingLanguage) && (
        <div className="text-[12px] text-[var(--muted)]">
          {kindHint ? `${kindHint} artifact` : "artifact"}
          {streamingLanguage ? ` · ${streamingLanguage}` : ""}
          {running && streamingContent !== undefined ? ` · ${previewLabel}…` : ""}
        </div>
      )}
      {streamingContent !== undefined && streamingContent.length > 0 && (
        <CodeSnippet
          code={streamingContent}
          label={running ? `${previewLabel}…` : "Content"}
        />
      )}
      {running && !streamingContent && part.argsText && (
        <CodeSnippet code={part.argsText} label="Arguments" />
      )}
    </ToolShell>
  );
};

/* ─── Memory ─── */

type MemoryRow = {
  id?: string;
  type?: string;
  title?: string;
  body?: string;
};

const MemorySearchToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { query?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    results?: MemoryRow[];
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const results = output?.results ?? [];

  return (
    <ToolShell
      name={TOOL_NAMES.memorySearch}
      running={running}
      error={error}
      subtitle={input?.query}
      defaultOpen={!running && results.length > 0}
    >
      {results.length === 0 && !running ? (
        <p className="text-[12px] text-[var(--muted)]">No memories matched.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((r, i) => (
            <li
              key={r.id || i}
              className="rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-medium text-[var(--text)]">
                  {r.title || "Memory"}
                </span>
                {r.type && (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted-soft)]">
                    {r.type}
                  </span>
                )}
              </div>
              {r.body && (
                <p className="mt-1 line-clamp-3 text-[12px] text-[var(--muted)]">
                  {r.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolShell>
  );
};

const MemoryWriteToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as {
    title?: string;
    type?: string;
    body?: string;
  } | undefined;
  const output = part.result as {
    ok?: boolean;
    memory?: MemoryRow;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const saved = output?.memory;

  return (
    <ToolShell
      name={TOOL_NAMES.memoryWrite}
      running={running}
      error={error}
      subtitle={input?.title || saved?.title}
      defaultOpen={!running && !!saved}
    >
      {(saved || input) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--text)]">
              {saved?.title || input?.title}
            </span>
            {(saved?.type || input?.type) && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted-soft)]">
                {saved?.type || input?.type}
              </span>
            )}
          </div>
          {(saved?.body || input?.body) && (
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {saved?.body || input?.body}
            </p>
          )}
        </div>
      )}
    </ToolShell>
  );
};

/* ─── Drive ─── */

type DriveFileRow = {
  id: string;
  name: string;
  mimeType?: string;
  isFolder?: boolean;
};

const DriveSearchToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { query?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    files?: DriveFileRow[];
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const files = output?.files ?? [];

  return (
    <ToolShell
      name={TOOL_NAMES.driveSearch}
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
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 text-[12px] text-[var(--text)]"
            >
              <FileIcon className="size-3.5 shrink-0 text-[var(--muted)]" />
              <span className="min-w-0 truncate font-medium">{f.name}</span>
              {f.isFolder && (
                <span className="shrink-0 text-[10px] text-[var(--muted-soft)]">
                  folder
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!running && !output?.error && files.length === 0 && (
        <p className="text-[12px] text-[var(--muted)]">No Drive files found.</p>
      )}
    </ToolShell>
  );
};

const DriveReadToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { fileId?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    name?: string;
    text?: string;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);

  return (
    <ToolShell
      name={TOOL_NAMES.driveRead}
      running={running}
      error={error}
      subtitle={output?.name || input?.fileId}
      defaultOpen={!running && !!output?.text}
    >
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {output?.text && (
        <CodeSnippet
          code={
            output.text.length > 4000
              ? `${output.text.slice(0, 4000)}…`
              : output.text
          }
          label={output.name || "File text"}
        />
      )}
    </ToolShell>
  );
};

/* ─── Fetch URL ─── */

/* ─── GitHub ─── */

const GitHubGetRepoToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { repo?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    repository?: {
      fullName?: string;
      description?: string | null;
      defaultBranch?: string;
      private?: boolean;
      language?: string | null;
      htmlUrl?: string;
    };
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const repo = output?.repository;

  return (
    <ToolShell
      name={TOOL_NAMES.githubGetRepo}
      running={running}
      error={error}
      subtitle={repo?.fullName || input?.repo}
      defaultOpen={!running && (!!repo || !!output?.error)}
    >
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {repo && (
        <div className="space-y-1.5 text-[12px] text-[var(--text)]">
          {repo.htmlUrl && (
            <a
              href={repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
            >
              {repo.fullName}
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
          {repo.description && (
            <p className="text-[var(--muted)]">{repo.description}</p>
          )}
          <p className="text-[11px] text-[var(--muted-soft)]">
            {[
              repo.private ? "private" : "public",
              repo.language,
              repo.defaultBranch ? `default ${repo.defaultBranch}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
    </ToolShell>
  );
};

const GitHubListContentsToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { repo?: string; path?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    path?: string;
    entries?: Array<{ name: string; path: string; type: string; size?: number }>;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const entries = output?.entries ?? [];
  const pathLabel = output?.path || input?.path || "/";

  return (
    <ToolShell
      name={TOOL_NAMES.githubListContents}
      running={running}
      error={error}
      subtitle={
        input?.repo
          ? `${input.repo}${pathLabel && pathLabel !== "/" ? ` · ${pathLabel}` : ""}`
          : pathLabel
      }
      defaultOpen={!running && (entries.length > 0 || !!output?.error)}
    >
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {entries.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-auto">
          {entries.map((e) => (
            <li
              key={e.path || e.name}
              className="flex items-center gap-2 text-[12px] text-[var(--text)]"
            >
              <FileIcon className="size-3.5 shrink-0 text-[var(--muted)]" />
              <span className="min-w-0 truncate font-medium">{e.name}</span>
              <span className="shrink-0 text-[10px] text-[var(--muted-soft)]">
                {e.type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ToolShell>
  );
};

const GitHubReadFileToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { repo?: string; path?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    name?: string;
    path?: string;
    text?: string;
    truncated?: boolean;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);

  return (
    <ToolShell
      name={TOOL_NAMES.githubReadFile}
      running={running}
      error={error}
      subtitle={output?.path || input?.path || input?.repo}
      defaultOpen={!running && (!!output?.text || !!output?.error)}
    >
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {output?.text && (
        <CodeSnippet
          code={
            output.text.length > 4000
              ? `${output.text.slice(0, 4000)}…`
              : output.text
          }
          label={
            output.truncated
              ? `${output.name || "File"} (truncated)`
              : output.name || "File"
          }
        />
      )}
    </ToolShell>
  );
};

const FetchUrlToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { url?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    title?: string;
    text?: string;
    url?: string;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const href = output?.url || input?.url;

  return (
    <ToolShell
      name={TOOL_NAMES.fetchUrl}
      running={running}
      error={error}
      subtitle={output?.title || href}
      defaultOpen={!running && (!!output?.text || !!output?.error)}
    >
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline"
        >
          {href}
          <ExternalLinkIcon className="size-3" />
        </a>
      )}
      {output?.error && (
        <div className="rounded-lg bg-[var(--error-bg)] p-2.5 text-[12px] text-[var(--error-text)]">
          {output.error}
        </div>
      )}
      {output?.text && (
        <p className="max-h-48 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--muted)]">
          {output.text.length > 2500
            ? `${output.text.slice(0, 2500)}…`
            : output.text}
        </p>
      )}
    </ToolShell>
  );
};

/* ─── Tool search (deferred discovery) ─── */

const ToolSearchToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const input = part.args as { query?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    query?: string;
    unlocked?: Array<{ name: string; description: string }>;
    note?: string;
  } | undefined;
  const unlocked = output?.unlocked ?? [];
  const error = part.isError || (output ? output.ok === false : false);

  return (
    <ToolShell
      name={TOOL_NAMES.toolSearch}
      running={running}
      error={error}
      subtitle={
        input?.query
          ? unlocked.length > 0
            ? `${input.query} · ${unlocked.length} unlocked`
            : input.query
          : undefined
      }
      defaultOpen={!running && unlocked.length > 0}
    >
      {output?.note && (
        <p className="mb-2 text-[12px] text-[var(--muted)]">{output.note}</p>
      )}
      {unlocked.length > 0 && (
        <ul className="space-y-1.5">
          {unlocked.map((t) => (
            <li key={t.name} className="text-[12px]">
              <span className="font-medium text-[var(--foreground)]">
                {t.name}
              </span>
              <span className="text-[var(--muted)]"> — {t.description}</span>
            </li>
          ))}
        </ul>
      )}
    </ToolShell>
  );
};

/* ─── Generic fallback ─── */

const GenericToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = partIsRunning(part);
  const hasArgs = !!part.argsText;
  return (
    <ToolShell
      name={part.toolName}
      running={running}
      error={part.isError}
      defaultOpen={running && hasArgs}
    >
      {part.argsText && (
        <CodeSnippet
          code={part.argsText}
          label={running ? "Calling…" : "Input"}
        />
      )}
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
    case TOOL_NAMES.memorySearch:
      return <MemorySearchToolCall part={part} />;
    case TOOL_NAMES.memoryWrite:
      return <MemoryWriteToolCall part={part} />;
    case TOOL_NAMES.driveSearch:
      return <DriveSearchToolCall part={part} />;
    case TOOL_NAMES.driveRead:
      return <DriveReadToolCall part={part} />;
    case TOOL_NAMES.githubGetRepo:
      return <GitHubGetRepoToolCall part={part} />;
    case TOOL_NAMES.githubListContents:
      return <GitHubListContentsToolCall part={part} />;
    case TOOL_NAMES.githubReadFile:
      return <GitHubReadFileToolCall part={part} />;
    case TOOL_NAMES.fetchUrl:
      return <FetchUrlToolCall part={part} />;
    case TOOL_NAMES.toolSearch:
      return <ToolSearchToolCall part={part} />;
    default:
      return <GenericToolCall part={part} />;
  }
};
