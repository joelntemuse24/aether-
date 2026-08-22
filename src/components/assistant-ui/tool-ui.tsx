"use client";

import { useEffect, useRef, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
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
import { ToolApprovalToggle } from "@/components/assistant-ui/tool-approval-toggle";
import { confirmActionCopy } from "@/lib/hermes/confirm-copy";
import { useArtifact, type Artifact } from "@/providers/artifact-provider";
import "@/components/assistant-ui/tool-approval.css";
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

/**
 * Running only while the thread is live. Rehydrated history often has
 * `status: undefined` without a result — treating that as running made refresh
 * spin, expand, and thrash the artifact panel.
 */
function partIsRunning(part: ToolPartLike, threadIsRunning: boolean): boolean {
  if (part.result !== undefined) return false;
  const t = part.status?.type;
  if (t === "complete" || t === "incomplete" || t === "cancelled") return false;
  if (t === "running" || t === "requires-action") return true;
  // No explicit status: only animate if the conversation is actively generating.
  return threadIsRunning;
}

function usePartRunning(part: ToolPartLike): boolean {
  const threadIsRunning = useAuiState((s) => s.thread.isRunning);
  return partIsRunning(part, threadIsRunning);
}

type ConfirmExecution = {
  ok?: boolean;
  kind?: string;
  title?: string;
  content?: string;
  language?: string;
  id?: string;
  persisted?: boolean;
};

/** Shared confirm / Cancel + Ask|Auto chrome. Talks only to /api/harness/confirm. */
function ConfirmCardActions({
  confirmationId,
  active,
  payload,
  onApprovedExecution,
}: {
  confirmationId?: string;
  active: boolean;
  payload?: Record<string, unknown>;
  onApprovedExecution?: (execution: ConfirmExecution) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<"approved" | "declined" | null>(
    null,
  );
  const [expired, setExpired] = useState(false);
  const payloadAction =
    payload && typeof payload.args === "object" && payload.args
      ? (payload.args as { action?: unknown }).action
      : payload?.action;
  const copy = confirmActionCopy({
    tool: typeof payload?.tool === "string" ? payload.tool : undefined,
    action: typeof payloadAction === "string" ? payloadAction : undefined,
  });

  useEffect(() => {
    if (!confirmationId) return;
    let cancelled = false;
    void fetch(`/api/harness/confirm?id=${encodeURIComponent(confirmationId)}`)
      .then(async (res) => {
        // 404 is normal for a just-created guest card in another isolate.
        // Keep the confirm / Cancel actions; POST records the decision or shows expired.
        if (!res.ok) return null;
        return res.json() as Promise<{ status?: string }>;
      })
      .then((data) => {
        if (cancelled || !data?.status) return;
        if (data.status === "approved") setResolved("approved");
        if (data.status === "declined") setResolved("declined");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [confirmationId]);

  const resolve = async (approved: boolean) => {
    if (!confirmationId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/harness/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationId,
          approved,
          ...(payload ? { payload } : {}),
        }),
      });
      if (!res.ok) {
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail:
              res.status === 404 ? copy.expired : copy.failedNotice,
          }),
        );
        if (res.status === 404) setExpired(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        execution?: ConfirmExecution;
      };
      setResolved(approved ? "approved" : "declined");
      if (approved && data.execution) onApprovedExecution?.(data.execution);
      window.dispatchEvent(
        new CustomEvent("aether:notice", {
          detail: approved ? copy.approvedNotice : copy.cancelledNotice,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!active || !confirmationId) return null;
  if (expired && !resolved) {
    return (
      <p className="aether-confirm-actions__status" role="status">
        {copy.expired}
      </p>
    );
  }
  if (resolved) {
    return (
      <p className="aether-confirm-actions__status" role="status">
        {resolved === "approved" ? copy.approvedStatus : copy.cancelledStatus}
      </p>
    );
  }
  return (
    <div className="aether-confirm-actions">
      <button
        type="button"
        disabled={busy}
        onClick={() => void resolve(true)}
        data-destructive={copy.destructive ? "true" : undefined}
        className="aether-confirm-actions__btn aether-confirm-actions__confirm"
      >
        {copy.confirm}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void resolve(false)}
        className="aether-confirm-actions__btn aether-confirm-actions__cancel"
      >
        {copy.cancel}
      </button>
      <ToolApprovalToggle />
    </div>
  );
}

function replayPayloadForPart(
  part: ToolPartLike,
  fromResult?: Record<string, unknown>,
): Record<string, unknown> {
  if (fromResult && typeof fromResult.tool === "string") return fromResult;
  return {
    tool: part.toolName,
    args: (part.args as Record<string, unknown>) ?? {},
    projectId: null,
  };
}

function confirmationFromResult(result: unknown): {
  needsConfirmation: boolean;
  confirmationId?: string;
  payload?: Record<string, unknown>;
} {
  if (!result || typeof result !== "object") {
    return { needsConfirmation: false };
  }
  const rec = result as {
    needs_confirmation?: boolean;
    confirmation_id?: string;
    payload?: Record<string, unknown>;
  };
  const confirmationId = rec.confirmation_id;
  return {
    needsConfirmation: !!rec.needs_confirmation && !!confirmationId,
    confirmationId,
    payload:
      rec.payload && typeof rec.payload === "object" ? rec.payload : undefined,
  };
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
  [TOOL_NAMES.verifyChecklist]: CheckIcon,
  [TOOL_NAMES.requestConfirmation]: AlertTriangleIcon,
  [TOOL_NAMES.browserNavigate]: GlobeIcon,
  [TOOL_NAMES.browserAct]: GlobeIcon,
};

const ToolShell: FC<{
  name: string;
  running: boolean;
  error?: boolean;
  subtitle?: string;
  children?: React.ReactNode;
  headerAction?: React.ReactNode;
  /**
   * When true, expand while the tool is still constructing (streaming args /
   * body). Collapses again when the run finishes so traces stay quiet.
   */
  expandWhileRunning?: boolean;
  /** Keep the body open (pending approval). Wins over the post-run collapse. */
  stayOpen?: boolean;
}> = ({
  name,
  running,
  error,
  subtitle,
  children,
  headerAction,
  expandWhileRunning,
  stayOpen,
}) => {
  // Collapsed by default; progressive construction can open while running.
  const [open, setOpen] = useState(false);
  const userToggled = useRef(false);
  const display = getToolDisplay(name);
  const Icon = ICONS[name] ?? WrenchIcon;
  const hasBody = !!children;

  useEffect(() => {
    if (userToggled.current) return;
    if (stayOpen && hasBody) {
      setOpen(true);
      return;
    }
    if (expandWhileRunning && running && hasBody) {
      setOpen(true);
    } else if (expandWhileRunning && !running) {
      setOpen(false);
    }
  }, [expandWhileRunning, running, hasBody, stayOpen]);

  return (
    <div
      className={cn(
        // Thin chip — not a heavy engineering card.
        "my-0.5 overflow-hidden rounded-md font-[family-name:var(--font-sans)] text-[12px]",
        "transition-opacity duration-150 ease-out",
        running
          ? "bg-[color-mix(in_oklab,var(--elevated)_70%,transparent)]"
          : "bg-transparent",
      )}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-0.5">
        <button
          type="button"
          onClick={() => {
            userToggled.current = true;
            setOpen((v) => !v);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              error
                ? "text-[var(--error-text)]"
                : running
                  ? "text-[var(--accent)]"
                  : "text-[var(--muted-soft)]",
            )}
          >
            {running ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : error ? (
              <AlertTriangleIcon className="size-3" />
            ) : (
              <Icon className="size-3 opacity-80" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span
              className={cn(
                running ? "text-[var(--text-secondary)]" : "text-[var(--muted)]",
              )}
            >
              {running ? display.runningLabel : display.label}
            </span>
            {subtitle && (
              <span className="ml-1.5 text-[var(--muted-soft)]">
                {subtitle}
              </span>
            )}
          </span>
          {!running && !error && (
            <CheckIcon className="size-3 shrink-0 text-[var(--muted-soft)] opacity-60" />
          )}
          {!!children && (
            <ChevronDownIcon
              className={cn(
                "size-3 shrink-0 text-[var(--muted-soft)] transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          )}
        </button>
        {headerAction}
      </div>
      {open && children && (
        <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">
          {children}
        </div>
      )}
    </div>
  );
};

const CodeSnippet: FC<{ code: string; label?: string }> = ({ code, label }) => (
  <div className="mt-0.5">
    {label && (
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-soft)]">
        {label}
      </div>
    )}
    <pre className="max-h-40 overflow-auto rounded-md bg-[var(--code-bg)] p-2 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--text)]">
      <code>{code}</code>
    </pre>
  </div>
);

/* ─── Python ─── */

const PythonToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = usePartRunning(part);
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
      expandWhileRunning={!!code}
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
  const running = usePartRunning(part);
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
  const {
    openArtifact,
    refreshSaved,
    rememberSessionArtifact,
    artifact: openPanelArtifact,
    open,
  } = useArtifact();
  const running = usePartRunning(part);
  const threadRunning = useAuiState((s) => s.thread.isRunning);
  const input = part.args as Partial<CreateArtifactInput> | undefined;
  const result = part.result as
    | (CreateArtifactOutput & {
        content?: string;
        needs_confirmation?: boolean;
        confirmation_id?: string;
      })
    | undefined;
  const confirm = confirmationFromResult(result);
  const bodyContent =
    (typeof input?.content === "string" && input.content) ||
    (typeof result?.content === "string" ? result.content : undefined) ||
    extractPartialJsonString(part.argsText, "content");
  const bodyTitle =
    input?.title ||
    result?.title ||
    extractPartialJsonString(part.argsText, "title");
  const complete =
    part.result !== undefined &&
    !!bodyContent &&
    !!bodyTitle &&
    !confirm.needsConfirmation;
  const openedRef = useRef(false);
  const lastSyncedLen = useRef(0);
  /** True if this mount saw a live generation — used to open on complete without rehydrate pop. */
  const sawLiveRef = useRef(false);

  useEffect(() => {
    if (running || threadRunning) sawLiveRef.current = true;
  }, [running, threadRunning]);

  const streamingTitle = bodyTitle;
  const kindHint =
    (input?.kind as string | undefined) ||
    (result?.kind as string | undefined) ||
    extractPartialJsonString(part.argsText, "kind") ||
    part.argsText?.match(/"kind"\s*:\s*"(\w+)"/)?.[1];
  const streamingContent = bodyContent;
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
    complete && bodyContent && bodyTitle
      ? toArtifact(artifactId, {
          kind: (kindHint as ArtifactKind) || "document",
          title: bodyTitle,
          language: streamingLanguage,
          content: bodyContent,
        })
      : null;
  const artifact = completeArtifact ?? draft;

  // Open while writing; also open once on live complete (batch tools often skip
  // streaming args). Never auto-open historical tools after refresh.
  useEffect(() => {
    if (!artifact) return;

    if (complete) {
      const payload = {
        ...artifact,
        persisted: !!result?.persisted,
      };
      if (sawLiveRef.current && !openedRef.current) {
        openedRef.current = true;
        openArtifact(payload);
        rememberSessionArtifact(payload);
        if (result?.persisted) void refreshSaved();
      } else if (
        openedRef.current &&
        open &&
        openPanelArtifact?.id === artifact.id
      ) {
        openArtifact(payload);
        rememberSessionArtifact(payload);
      } else if (sawLiveRef.current && result?.persisted) {
        rememberSessionArtifact(payload);
        void refreshSaved();
      }
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

  const hasConstructingBody =
    running &&
    ((streamingContent !== undefined && streamingContent.length > 0) ||
      !!part.argsText);

  return (
    <ToolShell
      name={TOOL_NAMES.createArtifact}
      running={running}
      expandWhileRunning={hasConstructingBody}
      stayOpen={confirm.needsConfirmation}
      subtitle={
        streamingTitle
          ? result?.persisted
            ? `${streamingTitle} · saved`
            : running
              ? `${streamingTitle}${charHint ? ` · ${charHint}` : ""}`
              : streamingTitle
          : kindHint
            ? `Creating ${kindHint}…`
            : running
              ? "Preparing…"
              : undefined
      }
      headerAction={
        artifact ? (
          <button
            type="button"
            onClick={() => openArtifact(artifact)}
            className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          >
            <PanelRightOpenIcon className="size-3" />
            Open
          </button>
        ) : undefined
      }
    >
      {(kindHint || streamingLanguage || running) && (
        <div className="text-[11px] text-[var(--muted)]">
          {kindHint ? `${kindHint} artifact` : "artifact"}
          {streamingLanguage ? ` · ${streamingLanguage}` : ""}
          {running && streamingContent !== undefined
            ? ` · ${previewLabel}…${charHint ? ` ${charHint}` : ""}`
            : running
              ? " · starting…"
              : ""}
        </div>
      )}
      {streamingContent !== undefined && streamingContent.length > 0 && (
        <CodeSnippet
          code={
            streamingContent.length > 6000
              ? `${streamingContent.slice(0, 6000)}…`
              : streamingContent
          }
          label={running ? `${previewLabel}…` : "Content"}
        />
      )}
      {running && !streamingContent && part.argsText && (
        <CodeSnippet
          code={
            part.argsText.length > 2000
              ? `${part.argsText.slice(0, 2000)}…`
              : part.argsText
          }
          label="Writing…"
        />
      )}
      <ConfirmCardActions
        confirmationId={confirm.confirmationId}
        active={confirm.needsConfirmation}
        payload={replayPayloadForPart(part, confirm.payload)}
        onApprovedExecution={(execution) => {
          if (!execution?.title || !execution.content) return;
          const payload = toArtifact(execution.id || part.toolCallId, {
            kind: (execution.kind as ArtifactKind) || "document",
            title: execution.title,
            language: execution.language,
            content: execution.content,
          });
          const next = { ...payload, persisted: !!execution.persisted };
          openArtifact(next);
          rememberSessionArtifact(next);
          if (execution.persisted) void refreshSaved();
        }}
      />
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
  const running = usePartRunning(part);
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
  const running = usePartRunning(part);
  const input = part.args as {
    title?: string;
    type?: string;
    body?: string;
  } | undefined;
  const output = part.result as {
    ok?: boolean;
    memory?: MemoryRow;
    needs_confirmation?: boolean;
    confirmation_id?: string;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const saved = output?.memory;
  const confirm = confirmationFromResult(output);

  return (
    <ToolShell
      name={TOOL_NAMES.memoryWrite}
      running={running}
      error={error}
      subtitle={input?.title || saved?.title}
      stayOpen={confirm.needsConfirmation}
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
      <ConfirmCardActions
        confirmationId={confirm.confirmationId}
        active={confirm.needsConfirmation}
        payload={replayPayloadForPart(part, confirm.payload)}
      />
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
  const running = usePartRunning(part);
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
  const running = usePartRunning(part);
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
  const running = usePartRunning(part);
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
  const running = usePartRunning(part);
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
  const running = usePartRunning(part);
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
  const path =
    output?.path ||
    input?.path ||
    extractPartialJsonString(part.argsText, "path");
  const repo =
    input?.repo || extractPartialJsonString(part.argsText, "repo");

  return (
    <ToolShell
      name={TOOL_NAMES.githubReadFile}
      running={running}
      error={error}
      expandWhileRunning={running && !!(path || repo || part.argsText)}
      subtitle={path || repo}
    >
      {running && (path || repo) && !output?.text && (
        <p className="text-[12px] text-[var(--muted)]">
          {repo ? `${repo}` : ""}
          {repo && path ? " · " : ""}
          {path ? path : "Resolving path…"}
        </p>
      )}
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
  const running = usePartRunning(part);
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
  const running = usePartRunning(part);
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

/* ─── Verify ─── */

const VerifyChecklistToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = usePartRunning(part);
  const input = part.args as {
    summary?: string;
    checks?: Array<{ item?: string; ok?: boolean; note?: string }>;
    ready_for_user?: boolean;
  } | undefined;
  const output = part.result as {
    ok?: boolean;
    verified?: boolean;
    failed?: string[];
    instruction?: string;
  } | undefined;
  const checks = input?.checks ?? [];
  const error = part.isError || (output ? output.ok === false : false);

  return (
    <ToolShell
      name={TOOL_NAMES.verifyChecklist}
      running={running}
      error={error}
      subtitle={
        output?.verified
          ? "Passed"
          : output
            ? "Needs attention"
            : input?.summary?.slice(0, 48)
      }
      expandWhileRunning={running && checks.length > 0}
    >
      {input?.summary && (
        <p className="text-[11px] text-[var(--muted)]">{input.summary}</p>
      )}
      {checks.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {checks.map((c, i) => (
            <li key={i} className="text-[11px] text-[var(--text-secondary)]">
              {c.ok ? "✓" : "·"} {c.item}
              {c.note ? ` — ${c.note}` : ""}
            </li>
          ))}
        </ul>
      )}
      {output?.instruction && (
        <p className="mt-1 text-[11px] text-[var(--muted-soft)]">
          {output.instruction}
        </p>
      )}
    </ToolShell>
  );
};

/* ─── Confirmation (side effects) ─── */

const ConfirmationToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = usePartRunning(part);
  const input = part.args as {
    title?: string;
    preview?: string;
    target?: string;
    action?: string;
  } | undefined;
  const output = part.result as {
    needs_confirmation?: boolean;
    confirmation_id?: string;
    title?: string;
    preview?: string;
    instruction?: string;
    ok?: boolean;
  } | undefined;

  const title = output?.title || input?.title || "Needs your confirmation";
  const preview = output?.preview || input?.preview;
  const confirm = confirmationFromResult(output);
  const pending = confirm.needsConfirmation && !running;

  return (
    <ToolShell
      name={TOOL_NAMES.requestConfirmation}
      running={running}
      subtitle={title}
      expandWhileRunning={running}
      stayOpen={pending}
    >
      {preview && (
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted)]">
          {preview}
        </p>
      )}
      {input?.target && (
        <p className="mt-1 truncate text-[10px] text-[var(--muted-soft)]">
          {input.target}
        </p>
      )}
      <ConfirmCardActions
        confirmationId={confirm.confirmationId}
        active={pending}
        payload={replayPayloadForPart(part, confirm.payload)}
      />
    </ToolShell>
  );
};

/* ─── Browser ─── */

const BrowserNavigateToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = usePartRunning(part);
  const input = part.args as { url?: string } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    title?: string;
    url?: string;
    text?: string;
    warning?: string;
    mode?: string;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const href = output?.url || input?.url;

  return (
    <ToolShell
      name={TOOL_NAMES.browserNavigate}
      running={running}
      error={error}
      subtitle={output?.title || href}
      expandWhileRunning={running && !!(output?.text || part.argsText)}
    >
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mb-1 inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
        >
          {href}
          <ExternalLinkIcon className="size-3" />
        </a>
      )}
      {output?.error && (
        <p className="text-[11px] text-[var(--error-text)]">{output.error}</p>
      )}
      {output?.warning && (
        <p className="text-[11px] text-[var(--muted)]">{output.warning}</p>
      )}
      {output?.text && (
        <p className="max-h-36 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--muted)]">
          {output.text.length > 2000
            ? `${output.text.slice(0, 2000)}…`
            : output.text}
        </p>
      )}
    </ToolShell>
  );
};

const BrowserActToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = usePartRunning(part);
  const input = part.args as {
    action?: string;
    url?: string;
    description?: string;
  } | undefined;
  const output = part.result as {
    ok?: boolean;
    error?: string;
    needs_confirmation?: boolean;
    confirmation_id?: string;
    title?: string;
    preview?: string;
    text?: string;
    note?: string;
  } | undefined;
  const error = part.isError || (output ? output.ok === false : false);
  const confirm = confirmationFromResult(output);
  const pending = confirm.needsConfirmation && !running;

  return (
    <ToolShell
      name={TOOL_NAMES.browserAct}
      running={running}
      error={error}
      subtitle={
        output?.needs_confirmation
          ? "Needs your confirmation"
          : input?.action || input?.description
      }
      expandWhileRunning={running}
      stayOpen={pending}
    >
      {(output?.preview || input?.description) && (
        <p className="whitespace-pre-wrap text-[11px] text-[var(--muted)]">
          {output?.preview || input?.description}
        </p>
      )}
      {output?.error && (
        <p className="text-[11px] text-[var(--error-text)]">{output.error}</p>
      )}
      {output?.text && (
        <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--muted)]">
          {output.text.length > 1500
            ? `${output.text.slice(0, 1500)}…`
            : output.text}
        </p>
      )}
      {output?.note && (
        <p className="mt-1 text-[11px] text-[var(--muted-soft)]">{output.note}</p>
      )}
      <ConfirmCardActions
        confirmationId={confirm.confirmationId}
        active={pending}
        payload={replayPayloadForPart(part, confirm.payload)}
      />
    </ToolShell>
  );
};

/* ─── Generic fallback ─── */

const GenericToolCall: FC<{ part: ToolPartLike }> = ({ part }) => {
  const running = usePartRunning(part);
  return (
    <ToolShell
      name={part.toolName}
      running={running}
      error={part.isError}
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
    case TOOL_NAMES.verifyChecklist:
      return <VerifyChecklistToolCall part={part} />;
    case TOOL_NAMES.requestConfirmation:
      return <ConfirmationToolCall part={part} />;
    case TOOL_NAMES.browserNavigate:
      return <BrowserNavigateToolCall part={part} />;
    case TOOL_NAMES.browserAct:
      return <BrowserActToolCall part={part} />;
    default:
      return <GenericToolCall part={part} />;
  }
};
