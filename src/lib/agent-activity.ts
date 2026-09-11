/**
 * Honest in-progress activity for a chat turn.
 *
 * Status lines map 1:1 onto real tool / retrieval parts. Token-only
 * generation is at most a quiet elapsed clock — never a costume stack
 * of Thinking / Planning / search theater.
 */

import { collectSourceCitations } from "./citations";
import { recoverToolCallsFromMarkup } from "./visible-chat-text";

export type ActivityPart = {
  type?: string;
  toolName?: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
  status?: { type?: string };
  text?: string;
  state?: string;
};

export type ActivityMessage = {
  id?: string;
  role: string;
  parts?: readonly ActivityPart[];
};

export type ActivityStep = {
  id: string;
  kind: "tool";
  toolName: string;
  label: string;
  state: "running" | "complete";
};

export type ActivityMode = "hidden" | "elapsed" | "live" | "collapsed";

export type ActivityView = {
  visible: boolean;
  mode: ActivityMode;
  steps: ActivityStep[];
  liveStepId: string | null;
  /** Single mutating line while live. Never a stacked costume. */
  liveLine: string | null;
  /** Stable across ticking seconds so the line does not re-enter every second. */
  lineKey: string | null;
  elapsedSeconds: number;
  elapsedLabel: string | null;
  summaryLabel: string | null;
};

export type ContinuePhase = "idle" | "continuing" | "needs-continue";

export type DeriveAgentActivityInput = {
  messages: ActivityMessage[];
  isRunning: boolean;
  elapsedSeconds: number;
  /** Pre-send classify is not tool work — never a Planning line. */
  classifying?: boolean;
  continuePhase?: ContinuePhase;
  continueSegment?: number;
  continueMax?: number;
};

function hidden(elapsedSeconds = 0): ActivityView {
  return {
    visible: false,
    mode: "hidden",
    steps: [],
    liveStepId: null,
    liveLine: null,
    lineKey: null,
    elapsedSeconds,
    elapsedLabel: null,
    summaryLabel: null,
  };
}

export function formatActivityElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function toolNameFromActivityPart(part: ActivityPart): string | null {
  if (typeof part.toolName === "string" && part.toolName) return part.toolName;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    const name = part.type.slice("tool-".length);
    if (!name || name === "call" || name === "result" || name === "invocation") {
      return null;
    }
    return name;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseArgs(part: ActivityPart): Record<string, unknown> {
  const fromArgs = asRecord(part.args);
  if (Object.keys(fromArgs).length > 0) return fromArgs;
  if (typeof part.argsText === "string" && part.argsText.trim()) {
    try {
      return asRecord(JSON.parse(part.argsText));
    } catch {
      return {};
    }
  }
  return {};
}

function partLooksComplete(part: ActivityPart): boolean {
  if (part.result !== undefined) return true;
  const t = part.status?.type;
  if (t === "complete" || t === "incomplete" || t === "cancelled") return true;
  if (part.state === "output-available" || part.state === "output-error") {
    return true;
  }
  return false;
}

function partLooksRunning(part: ActivityPart, isRunning: boolean): boolean {
  if (partLooksComplete(part)) return false;
  const t = part.status?.type;
  if (t === "running" || t === "requires-action") return true;
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested"
  ) {
    return true;
  }
  if (toolNameFromActivityPart(part)) return true;
  return isRunning;
}

function artifactObject(args: Record<string, unknown>): string {
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (kind === "data") return "table";
  if (kind === "document") return "document";
  if (kind === "code") return "file";
  if (kind === "image" || kind === "svg") return "image";
  return "file";
}

function clipPhrase(value: unknown, max = 88): string | null {
  if (typeof value !== "string") return null;
  const clipped = value.replace(/\s+/g, " ").trim();
  if (!clipped) return null;
  if (clipped.length <= max) return clipped;
  return `${clipped.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function hostFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return clipPhrase(value, 32);
  }
}

export function activityLabelForTool(
  toolName: string,
  args: Record<string, unknown>,
  running: boolean,
): string {
  switch (toolName) {
    case "web_search": {
      const query = clipPhrase(args.query);
      if (running) return query ? `Searching ${query}` : "Searching";
      return "Searched the web";
    }
    case "memory_search": {
      const query = clipPhrase(args.query);
      if (running) return query ? `Searching memory for ${query}` : "Searching memory";
      return "Searched memory";
    }
    case "drive_search": {
      const query = clipPhrase(args.query);
      if (running) return query ? `Searching Drive for ${query}` : "Searching Drive";
      return "Searched Drive";
    }
    case "drive_read":
      return running ? "Reading Drive file" : "Read Drive file";
    case "drive_upload":
    case "drive_write":
      return running ? "Saving to Drive" : "Saved to Drive";
    case "gmail_search":
      return running ? "Searching mail" : "Searched mail";
    case "gmail_read":
      return running ? "Reading mail" : "Read mail";
    case "gmail_create_draft":
      return running ? "Saving draft" : "Saved draft";
    case "gmail_send":
      return running ? "Sending mail" : "Sent mail";
    case "fetch_url":
    case "browse_page":
    case "browser_snapshot":
    case "browser_navigate": {
      const host = hostFromUrl(args.url);
      if (running) return host ? `Reading ${host}` : "Reading page";
      return host ? `Read ${host}` : "Read page";
    }
    case "browser_act":
      return running ? "Working on page" : "Worked on page";
    case "search_images": {
      const query = clipPhrase(args.query);
      if (running) return query ? `Searching images for ${query}` : "Searching images";
      return "Searched images";
    }
    case "generate_image":
      return running ? "Generating image" : "Generated image";
    case "create_artifact": {
      const title = clipPhrase(args.title);
      const object = artifactObject(args);
      if (object === "document") {
        if (running) return title ? `Writing ${title}` : "Writing document";
        return "Wrote document";
      }
      if (object === "table") {
        if (running) return title ? `Creating ${title}` : "Creating table";
        return "Created table";
      }
      if (object === "image") {
        if (running) return title ? `Creating ${title}` : "Creating image";
        return "Created image";
      }
      if (running) return title ? `Creating ${title}` : "Creating file";
      return "Created file";
    }
    case "create_presentation": {
      const title = clipPhrase(args.title);
      if (running) return title ? `Building ${title}` : "Building slides";
      return "Built slides";
    }
    case "create_spreadsheet": {
      const title = clipPhrase(args.title);
      if (running) return title ? `Building ${title}` : "Building spreadsheet";
      return "Built spreadsheet";
    }
    case "create_document": {
      const title = clipPhrase(args.title);
      if (running) return title ? `Writing ${title}` : "Writing document";
      return "Wrote document";
    }
    case "create_pdf": {
      const title = clipPhrase(args.title);
      if (running) return title ? `Building ${title}` : "Building PDF";
      return "Built PDF";
    }
    case "workspace_publish_file":
      return running ? "Attaching file" : "Attached file";
    case "workspace_exec":
      return running ? "Running command" : "Ran command";
    case "execute_python":
      return running ? "Running Python" : "Ran Python";
    case "memory_write":
      return running ? "Saving memory" : "Saved memory";
    case "github_get_repo":
      return running ? "Looking up repository" : "Looked up repository";
    case "github_list_contents":
      return running ? "Listing repository files" : "Listed repository files";
    case "github_read_file":
      return running ? "Reading repository file" : "Read repository file";
    case "tool_search":
      return running ? "Looking up tools" : "Looked up tools";
    case "verify_checklist":
      return running ? "Checking work" : "Checked work";
    case "request_confirmation":
      return running ? "Waiting for approval" : "Asked for approval";
    default:
      return running ? `Running ${toolName}` : `Ran ${toolName}`;
  }
}

export function collectActivitySteps(
  parts: readonly ActivityPart[] | undefined,
  isRunning: boolean,
): ActivityStep[] {
  const steps: ActivityStep[] = [];
  const seen = new Set<string>();
  for (const [index, part] of (parts ?? []).entries()) {
    const toolName = toolNameFromActivityPart(part);
    if (toolName) {
      const running = partLooksRunning(part, isRunning);
      const id = `${toolName}:${index}`;
      seen.add(toolName);
      steps.push({
        id,
        kind: "tool",
        toolName,
        label: activityLabelForTool(toolName, parseArgs(part), running),
        state: running ? "running" : "complete",
      });
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      for (const recovered of recoverToolCallsFromMarkup(part.text)) {
        if (seen.has(recovered.toolName)) continue;
        seen.add(recovered.toolName);
        steps.push({
          id: `${recovered.toolName}:markup:${index}`,
          kind: "tool",
          toolName: recovered.toolName,
          label: activityLabelForTool(
            recovered.toolName,
            recovered.args,
            isRunning,
          ),
          state: isRunning ? "running" : "complete",
        });
      }
    }
  }
  return steps;
}

function latestAssistant(
  messages: ActivityMessage[],
): ActivityMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return undefined;
}

export function deriveAgentActivity(
  input: DeriveAgentActivityInput,
): ActivityView {
  if (input.classifying && !input.isRunning) {
    return hidden(input.elapsedSeconds);
  }

  const assistant = latestAssistant(input.messages);
  const steps = collectActivitySteps(assistant?.parts, input.isRunning);
  const live = steps.find((s) => s.state === "running") ?? null;
  const elapsed =
    input.elapsedSeconds > 0
      ? input.elapsedSeconds
      : input.isRunning
        ? 0
        : steps.length > 0
          ? recalledActivityElapsed(assistant?.id)
          : 0;
  const elapsedText = elapsed > 0 ? formatActivityElapsed(elapsed) : null;

  if (
    input.continuePhase === "continuing" &&
    typeof input.continueSegment === "number"
  ) {
    const max = input.continueMax ?? 0;
    const continueLabel =
      max > 0
        ? `Continuing ${input.continueSegment}/${max}`
        : `Continuing ${input.continueSegment}`;
    return {
      visible: true,
      mode: steps.length > 0 ? "live" : "elapsed",
      steps,
      liveStepId: live?.id ?? null,
      liveLine:
        live?.label ??
        steps[steps.length - 1]?.label ??
        continueLabel,
      lineKey: live?.id ?? "continue",
      elapsedSeconds: elapsed,
      elapsedLabel: continueLabel,
      summaryLabel: null,
    };
  }

  if (input.continuePhase === "needs-continue" && !input.isRunning) {
    return {
      visible: true,
      mode: live || steps.length > 0 ? "live" : "elapsed",
      steps,
      liveStepId: live?.id ?? null,
      liveLine: live?.label ?? "Paused — continue",
      lineKey: live?.id ?? "needs-continue",
      elapsedSeconds: elapsed,
      elapsedLabel: "Paused — continue",
      summaryLabel: null,
    };
  }

  if (steps.length > 0) {
    if (input.isRunning || live) {
      const current =
        live?.label ?? steps[steps.length - 1]?.label ?? null;
      return {
        visible: true,
        mode: "live",
        steps,
        liveStepId: live?.id ?? steps[steps.length - 1]!.id,
        liveLine: current,
        lineKey: live?.id ?? steps[steps.length - 1]!.id,
        elapsedSeconds: elapsed,
        elapsedLabel: elapsedText ? `Working for ${elapsedText}` : "Working",
        summaryLabel: null,
      };
    }
    return {
      visible: true,
      mode: "collapsed",
      steps,
      liveStepId: null,
      liveLine: null,
      lineKey: "collapsed",
      elapsedSeconds: elapsed,
      elapsedLabel: elapsedText,
      summaryLabel: elapsedText
        ? `Worked for ${elapsedText}`
        : (steps[0]?.label ?? null),
    };
  }

  if (input.isRunning) {
    // Keep the Grok-style clock up until the turn ends — tokens do not hide it.
    return {
      visible: true,
      mode: "elapsed",
      steps: [],
      liveStepId: null,
      liveLine: "Working",
      lineKey: "elapsed",
      elapsedSeconds: elapsed,
      elapsedLabel: elapsedText ? `Working for ${elapsedText}` : "Working",
      summaryLabel: null,
    };
  }

  if (elapsed > 0) {
    return {
      visible: true,
      mode: "collapsed",
      steps: [],
      liveStepId: null,
      liveLine: null,
      lineKey: "collapsed",
      elapsedSeconds: elapsed,
      elapsedLabel: elapsedText,
      summaryLabel: `Worked for ${elapsedText}`,
    };
  }

  return hidden(elapsed);
}

export type ActivitySearchHit = {
  id?: string;
  title: string;
  url?: string;
  snippet?: string;
};

/** Completed web_search + fetch_url hits — rendered as cards after the answer. */
export function collectWebSearchHits(
  parts: readonly ActivityPart[] | undefined,
): ActivitySearchHit[] {
  return collectSourceCitations(parts).slice(0, MAX_RENDERED_SOURCES).map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
  }));
}

const MAX_RENDERED_SOURCES = 8;

/** Session-local elapsed clock so completed turns can say "Worked for Ns". */
let liveStartedAt: number | null = null;
const completedElapsed = new Map<string, number>();
let lastClosedElapsed = 0;
let lastClosedAt = 0;
const CLOCK_STORAGE_KEY = "aether:activity-clock:v1";
const LAST_CLOSED_REUSE_MS = 60_000;

function readPersistedClock(): {
  startedAt?: number;
  lastClosed?: number;
  lastClosedAt?: number;
} {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(CLOCK_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as {
      startedAt?: number;
      lastClosed?: number;
      lastClosedAt?: number;
    };
  } catch {
    return {};
  }
}

function writePersistedClock() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      CLOCK_STORAGE_KEY,
      JSON.stringify({
        startedAt: liveStartedAt,
        lastClosed: lastClosedElapsed,
        lastClosedAt,
      }),
    );
  } catch {
    // ignore quota / private mode
  }
}

function restoreClockFromSession() {
  if (liveStartedAt != null || lastClosedElapsed > 0) return;
  const persisted = readPersistedClock();
  if (typeof persisted.startedAt === "number" && persisted.startedAt > 0) {
    liveStartedAt = persisted.startedAt;
  }
  if (typeof persisted.lastClosed === "number" && persisted.lastClosed > 0) {
    lastClosedElapsed = persisted.lastClosed;
    lastClosedAt =
      typeof persisted.lastClosedAt === "number" ? persisted.lastClosedAt : Date.now();
  }
}

export function resetActivityClock(): void {
  liveStartedAt = null;
  lastClosedElapsed = 0;
  lastClosedAt = 0;
  completedElapsed.clear();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(CLOCK_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function activityClockShouldRun(input: {
  isRunning: boolean;
  continuePhase?: ContinuePhase;
  messages: ActivityMessage[];
}): boolean {
  if (input.isRunning) return true;
  if (input.continuePhase === "continuing") return true;
  // Truly paused — freeze the clock. Open tools without pause still tick
  // because the durable worker may still own the turn after Head Start ends.
  if (input.continuePhase === "needs-continue") return false;
  const assistant = latestAssistant(input.messages);
  return collectActivitySteps(assistant?.parts, false).some(
    (step) => step.state === "running",
  );
}

export function syncActivityClock(isRunning: boolean): number {
  restoreClockFromSession();
  if (!isRunning) {
    if (liveStartedAt == null) return lastClosedElapsed;
    return Math.floor((Date.now() - liveStartedAt) / 1000);
  }
  if (liveStartedAt == null) liveStartedAt = Date.now();
  writePersistedClock();
  return Math.floor((Date.now() - liveStartedAt) / 1000);
}

export function rememberActivityElapsed(
  messageId: string,
  seconds: number,
): void {
  if (seconds > 0) {
    completedElapsed.set(messageId, seconds);
    lastClosedElapsed = Math.max(lastClosedElapsed, seconds);
    lastClosedAt = Date.now();
    writePersistedClock();
  }
}

export function recalledActivityElapsed(messageId?: string | null): number {
  if (messageId && completedElapsed.has(messageId)) {
    return completedElapsed.get(messageId) ?? 0;
  }
  restoreClockFromSession();
  if (liveStartedAt != null) {
    return Math.max(0, Math.floor((Date.now() - liveStartedAt) / 1000));
  }
  const closedRecently =
    lastClosedElapsed > 0 && Date.now() - lastClosedAt < LAST_CLOSED_REUSE_MS;
  if (!messageId) return closedRecently ? lastClosedElapsed : 0;
  return closedRecently ? lastClosedElapsed : 0;
}

export function closeActivityClock(messageId?: string | null): number {
  restoreClockFromSession();
  if (liveStartedAt != null) {
    const seconds = Math.max(
      1,
      Math.floor((Date.now() - liveStartedAt) / 1000),
    );
    if (messageId) rememberActivityElapsed(messageId, seconds);
    lastClosedElapsed = Math.max(lastClosedElapsed, seconds);
    lastClosedAt = Date.now();
    liveStartedAt = null;
    writePersistedClock();
    return seconds;
  }
  return recalledActivityElapsed(messageId);
}
