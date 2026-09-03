/**
 * Honest in-progress activity for a chat turn.
 *
 * Status lines map 1:1 onto real tool / retrieval parts. Token-only
 * generation is at most a quiet elapsed clock — never a costume stack
 * of Thinking / Planning / search theater.
 */

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
  parts?: ActivityPart[];
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

export function activityLabelForTool(
  toolName: string,
  args: Record<string, unknown>,
  running: boolean,
): string {
  switch (toolName) {
    case "web_search":
      return running ? "Searching" : "Ran 1 search";
    case "memory_search":
      return running ? "Searching memory" : "Searched memory";
    case "drive_search":
      return running ? "Searching Drive" : "Searched Drive";
    case "drive_read":
      return running ? "Reading Drive file" : "Read Drive file";
    case "fetch_url":
    case "browser_navigate":
      return running ? "Reading page" : "Read page";
    case "browser_act":
      return running ? "Working on page" : "Worked on page";
    case "create_artifact": {
      const object = artifactObject(args);
      if (object === "document") {
        return running ? "Writing document" : "Wrote document";
      }
      if (object === "table") {
        return running ? "Creating table" : "Created table";
      }
      if (object === "image") {
        return running ? "Creating image" : "Created image";
      }
      return running ? "Creating file" : "Created file";
    }
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

function hasVisibleText(parts: ActivityPart[] | undefined): boolean {
  return (parts ?? []).some(
    (p) =>
      p.type === "text" &&
      typeof p.text === "string" &&
      p.text.trim().length > 0,
  );
}

export function collectActivitySteps(
  parts: ActivityPart[] | undefined,
  isRunning: boolean,
): ActivityStep[] {
  const steps: ActivityStep[] = [];
  for (const [index, part] of (parts ?? []).entries()) {
    const toolName = toolNameFromActivityPart(part);
    if (!toolName) continue;
    const running = partLooksRunning(part, isRunning);
    steps.push({
      id: `${toolName}:${index}`,
      kind: "tool",
      toolName,
      label: activityLabelForTool(toolName, parseArgs(part), running),
      state: running ? "running" : "complete",
    });
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
  const elapsed = input.elapsedSeconds;
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

  if (steps.length > 0) {
    if (input.isRunning) {
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
        elapsedLabel: elapsedText,
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
      elapsedLabel: null,
      summaryLabel: elapsedText
        ? `Worked for ${elapsedText}`
        : (steps[0]?.label ?? null),
    };
  }

  if (input.isRunning) {
    if (hasVisibleText(assistant?.parts)) {
      return hidden(elapsed);
    }
    const working = elapsedText ? `Working for ${elapsedText}` : null;
    return {
      visible: elapsed > 0,
      mode: "elapsed",
      steps: [],
      liveStepId: null,
      liveLine: working,
      lineKey: "elapsed",
      elapsedSeconds: elapsed,
      elapsedLabel: working,
      summaryLabel: null,
    };
  }

  return hidden(elapsed);
}

/** Session-local elapsed clock so completed turns can say "Worked for Ns". */
let liveStartedAt: number | null = null;
const completedElapsed = new Map<string, number>();

export function syncActivityClock(isRunning: boolean): number {
  if (!isRunning) {
    liveStartedAt = null;
    return 0;
  }
  if (liveStartedAt == null) liveStartedAt = Date.now();
  return Math.floor((Date.now() - liveStartedAt) / 1000);
}

export function rememberActivityElapsed(
  messageId: string,
  seconds: number,
): void {
  if (seconds > 0) completedElapsed.set(messageId, seconds);
}

export function recalledActivityElapsed(messageId?: string | null): number {
  if (!messageId) return 0;
  return completedElapsed.get(messageId) ?? 0;
}

export function closeActivityClock(messageId?: string | null): number {
  if (liveStartedAt != null) {
    const seconds = Math.floor((Date.now() - liveStartedAt) / 1000);
    if (messageId) rememberActivityElapsed(messageId, seconds);
    liveStartedAt = null;
    return seconds;
  }
  return recalledActivityElapsed(messageId);
}
