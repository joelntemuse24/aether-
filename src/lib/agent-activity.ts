/**
 * Honest in-progress activity for a chat turn.
 *
 * One live status line. Before a tool exists the line says "Thinking".
 * A real tool replaces that word in place. Token text collapses the
 * line into a muted summary. Never a costume stack or a second Working row.
 */

import { collectSourceCitations } from "./citations";
import {
  recoverToolCallsFromMarkup,
  sanitizeReasoningText,
  sanitizeVisibleAssistantText,
} from "./visible-chat-text";

export type ActivityPart = {
  type?: string;
  toolName?: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
  output?: unknown;
  errorText?: string;
  isError?: boolean;
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
  /** Search query, shown only inside the expanded disclosure. */
  query?: string;
  /** Host that was read, shown only inside the expanded disclosure. */
  site?: string;
  /** Short code preview, shown only inside the expanded disclosure. */
  code?: string;
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
  /** Sanitized chain-of-thought. Never the collapsed headline. */
  reasoning: string | null;
};

const WORKING_CLOCK_LINE = /^(?:working(?: for \S+)?|thinking)$/i;

/** First live word, before a real tool step exists. Not a costume stack. */
export const THINKING_WORD = "Thinking";

/** Elapsed seconds stay off the line until the turn has been going this long. */
export const ACTIVITY_ELAPSED_REVEAL_SECONDS = 3;

export function shouldRevealActivityElapsed(seconds: number): boolean {
  return seconds >= ACTIVITY_ELAPSED_REVEAL_SECONDS;
}

/** Decorative ChatGPT-style status — never an Aether live line. */
export const THINKING_THEATER =
  /Thinking…|Planning…|Cooking…|\bMulling\b|\bUntangling\b|Gathering (?:threads|context)/i;

export function isWorkingClockLine(text: string | null | undefined): boolean {
  return WORKING_CLOCK_LINE.test((text ?? "").trim());
}

export function looksLikeThinkingTheater(text: string | null | undefined): boolean {
  return THINKING_THEATER.test(text ?? "");
}

/**
 * Live column shows at most the current real step. Completed steps wait
 * behind the collapsed summary so the thread never stacks a second row.
 */
export function compactLiveSteps(view: ActivityView): ActivityStep[] {
  if (view.mode === "collapsed") return view.steps;
  const live =
    view.steps.find((step) => step.id === view.liveStepId) ??
    view.steps.find((step) => step.state === "running") ??
    null;
  return live ? [live] : [];
}

/**
 * Tool one-liner under the Working clock. Never a second "Working" line.
 */
export function liveWorkOneLiner(view: ActivityView): string | null {
  if (view.mode !== "live" && view.mode !== "elapsed") return null;
  const line = view.liveLine?.trim() ?? "";
  if (!line) return null;
  if (isWorkingClockLine(line)) return null;
  return line;
}

/** Host pills on the collapsed source row — one line, no wrap-jump. */
export const MAX_SOURCE_PILLS = 3;

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
    reasoning: null,
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
  if (part.result !== undefined || part.output !== undefined) return true;
  if (part.isError) return true;
  if (typeof part.errorText === "string" && part.errorText.length > 0) {
    return true;
  }
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
  if (toolNameFromActivityPart(part)) return isRunning;
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
    case "web_search":
      return running ? "Searching the web" : "Searched the web";
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
    case "current_time":
      return running ? "Checking the time" : "Checked the time";
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
    if (!part || typeof part !== "object") continue;
    const toolName = toolNameFromActivityPart(part);
    if (toolName) {
      const running = partLooksRunning(part, isRunning);
      const id = `${toolName}:${index}`;
      const args = parseArgs(part);
      seen.add(toolName);
      steps.push({
        id,
        kind: "tool",
        toolName,
        label: activityLabelForTool(toolName, args, running),
        state: running ? "running" : "complete",
        ...stepDetail(toolName, args, part),
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
          ...stepDetail(recovered.toolName, recovered.args),
        });
      }
    }
  }
  return steps;
}

function revealedElapsedLabel(seconds: number): string | null {
  if (!shouldRevealActivityElapsed(seconds)) return null;
  return formatActivityElapsed(seconds);
}

function thoughtSummary(elapsedSeconds: number): string {
  return `Thought for ${formatActivityElapsed(Math.max(elapsedSeconds, 1))}`;
}

function searchClause(sourceCount: number): string {
  if (sourceCount === 1) return "Searched the web · 1 source";
  if (sourceCount > 1) return `Searched the web · ${sourceCount} sources`;
  return "Searched the web";
}

/**
 * One headline for the whole turn. Search turns that ran long enough
 * lead with "Thought for Ns". Every other completed step joins that
 * same line. A lone tool stays its own past-tense label.
 */
function collapsedSummary(
  steps: ActivityStep[],
  elapsedSeconds: number,
  sourceCount: number,
): string {
  const phrases: string[] = [];
  const seen = new Set<string>();
  const push = (phrase: string) => {
    if (!phrase || seen.has(phrase)) return;
    seen.add(phrase);
    phrases.push(phrase);
  };

  const searched = steps.some((step) => step.toolName === "web_search");
  if (searched && shouldRevealActivityElapsed(elapsedSeconds)) {
    push(thoughtSummary(elapsedSeconds));
  }

  for (const step of steps) {
    if (step.toolName === "web_search") {
      push(searchClause(sourceCount));
      continue;
    }
    push(step.label);
  }

  if (phrases.length === 0) return thoughtSummary(elapsedSeconds);
  return phrases.join(" · ");
}

function codePreview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return undefined;
  const clipped = text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
  const joined = clipped.split("\n").slice(0, 4).join("\n").trim();
  return joined || undefined;
}

function stepDetail(
  toolName: string,
  args: Record<string, unknown>,
  part?: ActivityPart,
): Pick<ActivityStep, "query" | "site" | "code"> {
  const detail: Pick<ActivityStep, "query" | "site" | "code"> = {};
  if (
    toolName === "web_search" ||
    toolName === "memory_search" ||
    toolName === "drive_search" ||
    toolName === "search_images" ||
    toolName === "gmail_search"
  ) {
    const query = clipPhrase(args.query, 80);
    if (query) detail.query = query;
  }
  if (
    toolName === "fetch_url" ||
    toolName === "browse_page" ||
    toolName === "browser_snapshot" ||
    toolName === "browser_navigate" ||
    toolName === "browser_act"
  ) {
    const record = {
      ...asRecord(part?.output),
      ...asRecord(part?.result),
    };
    const site = hostFromUrl(args.url) ?? hostFromUrl(record.url);
    if (site) detail.site = site;
  }
  if (toolName === "execute_python") {
    const code = codePreview(args.code);
    if (code) detail.code = code;
  }
  return detail;
}

function reasoningText(part: ActivityPart): string {
  if (typeof part.text === "string" && part.text.trim()) return part.text;
  const extra = part as ActivityPart & { reasoning?: unknown; delta?: unknown };
  if (typeof extra.reasoning === "string") return extra.reasoning;
  if (typeof extra.delta === "string") return extra.delta;
  return "";
}

/** Muted summary for the disclosure. Empty when the provider sent none. */
export function collectReasoningSummary(
  parts: readonly ActivityPart[] | undefined,
): string | null {
  const bits: string[] = [];
  for (const part of parts ?? []) {
    if (!part || typeof part !== "object") continue;
    const type = part.type ?? "";
    if (type !== "reasoning" && !type.startsWith("reasoning")) continue;
    const clean = sanitizeReasoningText(reasoningText(part));
    if (clean) bits.push(clean);
  }
  const joined = bits.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!joined) return null;
  if (joined.length <= 700) return joined;
  return `${joined.slice(0, 699).trimEnd()}…`;
}

function latestAssistant(
  messages: ActivityMessage[],
): ActivityMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return undefined;
}

function assistantHasVisibleProse(
  message: ActivityMessage | undefined,
): boolean {
  if (!message || !Array.isArray(message.parts)) return false;
  return message.parts.some((part) => {
    if (part?.type !== "text") return false;
    return sanitizeVisibleAssistantText(part.text).length > 0;
  });
}

export function deriveAgentActivity(
  input: DeriveAgentActivityInput,
): ActivityView {
  if (input.classifying && !input.isRunning) {
    return hidden(input.elapsedSeconds);
  }

  const assistant = latestAssistant(input.messages);
  const steps = collectActivitySteps(assistant?.parts, input.isRunning);
  const reasoning = collectReasoningSummary(assistant?.parts);
  const live = steps.find((s) => s.state === "running") ?? null;
  const elapsed =
    input.elapsedSeconds > 0
      ? input.elapsedSeconds
      : input.isRunning
        ? 0
        : steps.length > 0
          ? recalledActivityElapsed(assistant?.id)
          : 0;
  const prose = assistantHasVisibleProse(assistant);
  const sourceCount = collectWebSearchHits(assistant?.parts).length;

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
      reasoning,
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
      reasoning,
    };
  }

  const answerStarted = prose && !live;
  if ((input.isRunning || live) && !answerStarted) {
    if (steps.length > 0) {
      const current = live?.label ?? steps[steps.length - 1]?.label ?? null;
      return {
        visible: true,
        mode: "live",
        steps,
        liveStepId: live?.id ?? steps[steps.length - 1]!.id,
        liveLine: current,
        lineKey: live?.id ?? steps[steps.length - 1]!.id,
        elapsedSeconds: elapsed,
        elapsedLabel: revealedElapsedLabel(elapsed),
        summaryLabel: null,
        reasoning,
      };
    }
    return {
      visible: true,
      mode: "elapsed",
      steps: [],
      liveStepId: null,
      liveLine: THINKING_WORD,
      lineKey: "elapsed",
      elapsedSeconds: elapsed,
      elapsedLabel: revealedElapsedLabel(elapsed),
      summaryLabel: null,
      reasoning,
    };
  }

  if (steps.length > 0 || prose || (assistant && !prose) || elapsed > 0) {
    const settledElapsed = assistant && !prose && elapsed <= 0 ? 1 : elapsed;
    return {
      visible: true,
      mode: "collapsed",
      steps,
      liveStepId: null,
      liveLine: null,
      lineKey: "collapsed",
      elapsedSeconds: settledElapsed,
      elapsedLabel:
        settledElapsed > 0 ? formatActivityElapsed(settledElapsed) : null,
      summaryLabel: collapsedSummary(steps, settledElapsed, sourceCount),
      reasoning,
    };
  }

  return hidden(elapsed);
}

/**
 * Failed tools collapse the activity strip while useChat can stay
 * `isRunning`. Don't leave Stop armed after that.
 */
export function composerShouldShowStop(input: {
  threadIsRunning: boolean;
  messageStatus?: string;
  parts?: readonly ActivityPart[];
}): boolean {
  if (!input.threadIsRunning) return false;
  const status = input.messageStatus;
  if (!status || status === "running") return true;
  const tools = (input.parts ?? []).filter((part) => toolNameFromActivityPart(part));
  if (tools.length > 0 && tools.every((part) => partLooksComplete(part))) {
    return false;
  }
  return true;
}

/** Composer clock is only for the gap before the assistant row mounts. */
export function shouldShowComposerActivity(input: {
  hasAssistantMessage: boolean;
  visible: boolean;
  mode: ActivityMode;
}): boolean {
  if (!input.visible) return false;
  if (input.hasAssistantMessage) return false;
  if (input.mode === "collapsed" || input.mode === "hidden") return false;
  return true;
}

export function sourceChipLabel(hit: {
  title?: unknown;
  url?: unknown;
}): string {
  const host = hostFromUrl(hit.url);
  if (host) return host;
  if (typeof hit.title === "string" && hit.title.trim()) {
    return hit.title.replace(/\s+/g, " ").trim().slice(0, 24);
  }
  return "";
}

export function sourceTrayPills(
  hits: readonly { title?: unknown; url?: unknown }[],
  max = MAX_SOURCE_PILLS,
): Array<{ title?: unknown; url?: unknown }> {
  const out: Array<{ title?: unknown; url?: unknown }> = [];
  for (const hit of hits) {
    if (!sourceChipLabel(hit)) continue;
    out.push(hit);
    if (out.length >= max) break;
  }
  return out;
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

/** Session-local elapsed clock so a settled turn can say "Thought for Ns". */
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
  if (input.continuePhase === "continuing") return true;
  // Truly paused — freeze the clock. Open tools without pause still tick
  // because the durable worker may still own the turn after Head Start ends.
  if (input.continuePhase === "needs-continue" && !input.isRunning) return false;
  const assistant = latestAssistant(input.messages);
  const toolLive = collectActivitySteps(assistant?.parts, input.isRunning).some(
    (step) => step.state === "running",
  );
  // First answer token collapses the line. Freeze thinking/tool time there
  // so "Thought for Ns" does not keep counting while the reply streams.
  if (assistantHasVisibleProse(assistant) && !toolLive) return false;
  if (input.isRunning) return true;
  return toolLive;
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
