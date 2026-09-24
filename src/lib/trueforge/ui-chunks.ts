/**
 * Map TrueForge turn events onto the AI SDK UI chunks Aether's thread already renders.
 * Tool rows use the existing tool shells. Approvals use the existing confirm card.
 */

export type UiChunk = Record<string, unknown>;

type ToolBuf = { id?: string; name?: string; args: string };

export type TrueForgeUiState = {
  textSeq: number;
  textId: string | null;
  reasoningId: string | null;
  tools: Map<number, ToolBuf>;
  opened: Set<string>;
};

export function createTrueForgeUiState(): TrueForgeUiState {
  return {
    textSeq: 0,
    textId: null,
    reasoningId: null,
    tools: new Map(),
    opened: new Set(),
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}

function ensureText(state: TrueForgeUiState, chunks: UiChunk[]): string {
  if (state.textId) return state.textId;
  state.textSeq += 1;
  state.textId = `tf-text-${state.textSeq}`;
  chunks.push({ type: "text-start", id: state.textId });
  return state.textId;
}

function parseToolInput(args: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { raw: args };
  }
}

/** Emit tool-input-available once arguments have stopped streaming. */
export function flushPendingTools(state: TrueForgeUiState, chunks: UiChunk[]) {
  for (const tool of state.tools.values()) {
    if (!tool.id || !tool.name || state.opened.has(tool.id)) continue;
    state.opened.add(tool.id);
    state.textId = null;
    chunks.push({
      type: "tool-input-available",
      toolCallId: tool.id,
      toolName: tool.name,
      input: parseToolInput(tool.args),
    });
  }
}

function toolPreview(state: TrueForgeUiState, toolCallId: string): string {
  for (const tool of state.tools.values()) {
    if (tool.id !== toolCallId) continue;
    const name = tool.name || "tool";
    const args = tool.args ? ` ${tool.args.slice(0, 280)}` : "";
    return `${name}${args}`;
  }
  return toolCallId;
}

function absorbToolDelta(
  state: TrueForgeUiState,
  chunks: UiChunk[],
  calls: unknown,
) {
  if (!Array.isArray(calls)) return;
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const row = call as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const index = row.index ?? 0;
    const buf = state.tools.get(index) ?? { args: "" };
    if (row.id) buf.id = row.id;
    if (row.function?.name) buf.name = row.function.name;
    if (row.function?.arguments) buf.args += row.function.arguments;
    state.tools.set(index, buf);
  }
}

/** One TrueForge event → zero or more UI chunks. */
export function chunksForTrueForgeEvent(
  event: { type?: string; [key: string]: unknown },
  state: TrueForgeUiState,
): UiChunk[] {
  const chunks: UiChunk[] = [];
  const type = event.type;

  if (type === "model.message.delta") {
    const reasoning = typeof event.reasoningContent === "string" ? event.reasoningContent : "";
    if (reasoning) {
      if (!state.reasoningId) {
        state.reasoningId = "tf-reason";
        chunks.push({ type: "reasoning-start", id: state.reasoningId });
      }
      chunks.push({ type: "reasoning-delta", id: state.reasoningId, delta: reasoning });
    }
    if (event.finishReason) flushPendingTools(state, chunks);
    const delta = textOf(event.content);
    if (delta) {
      const id = ensureText(state, chunks);
      chunks.push({ type: "text-delta", id, delta });
    }
    absorbToolDelta(state, chunks, event.toolCalls);
    return chunks;
  }

  if (type === "model.message") {
    const reasoning = typeof event.reasoningContent === "string" ? event.reasoningContent : "";
    if (reasoning && !state.reasoningId) {
      state.reasoningId = "tf-reason";
      chunks.push({ type: "reasoning-start", id: state.reasoningId });
      chunks.push({ type: "reasoning-delta", id: state.reasoningId, delta: reasoning });
    }
    const text = textOf(event.content);
    if (text) {
      const id = ensureText(state, chunks);
      chunks.push({ type: "text-delta", id, delta: text });
    }
    if (Array.isArray(event.toolCalls)) {
      event.toolCalls.forEach((call, index) => {
        if (!call || typeof call !== "object") return;
        const row = call as {
          id?: string;
          function?: { name?: string; arguments?: string };
        };
        const buf = state.tools.get(index) ?? { args: "" };
        if (row.id) buf.id = row.id;
        if (row.function?.name) buf.name = row.function.name;
        if (row.function?.arguments && !buf.args) buf.args = row.function.arguments;
        state.tools.set(index, buf);
      });
    }
    flushPendingTools(state, chunks);
    return chunks;
  }

  if (type === "tool.response") {
    const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
    if (!toolCallId) return chunks;
    let output: unknown = event.content;
    if (typeof event.content === "string") {
      try {
        output = JSON.parse(event.content);
      } catch {
        output = event.content;
      }
    }
    chunks.push({
      type: "tool-output-available",
      toolCallId,
      output,
    });
    return chunks;
  }

  if (type === "tool.approval_required" && Array.isArray(event.toolCalls)) {
    flushPendingTools(state, chunks);
    const sessionId = typeof event.sessionId === "string" ? event.sessionId : "";
    for (const call of event.toolCalls) {
      if (!call || typeof call !== "object") continue;
      const toolCallId = String((call as { id?: string }).id ?? "");
      if (!toolCallId) continue;
      const preview = toolPreview(state, toolCallId);
      const callConfirmation =
        call && typeof call === "object" && "confirmationId" in call
          ? (call as { confirmationId?: unknown }).confirmationId
          : undefined;
      const confirmationId =
        typeof callConfirmation === "string" && callConfirmation
          ? callConfirmation
          : typeof event.confirmationId === "string" && event.confirmationId
            ? event.confirmationId
            : "";
      chunks.push({
        type: "tool-output-available",
        toolCallId,
        output: { pending_approval: true },
      });
      if (!confirmationId) continue;
      chunks.push({
        type: "tool-input-available",
        toolCallId: `confirm-${toolCallId}`,
        toolName: "request_confirmation",
        input: {
          title: "Allow this step?",
          preview,
          action: "approve",
        },
      });
      chunks.push({
        type: "tool-output-available",
        toolCallId: `confirm-${toolCallId}`,
        output: {
          needs_confirmation: true,
          confirmation_id: confirmationId,
          title: "Allow this step?",
          preview,
          session_id: sessionId,
        },
      });
    }
    return chunks;
  }

  if (type === "tool.response_required") {
    flushPendingTools(state, chunks);
    const id = ensureText(state, chunks);
    chunks.push({
      type: "text-delta",
      id,
      delta: "\n\nThis step needs an answer in the composer before it can continue.",
    });
    return chunks;
  }

  if (type === "mcp.auth_required" && Array.isArray(event.mcpServers)) {
    const lines = event.mcpServers
      .map((server) => {
        if (!server || typeof server !== "object") return "";
        const row = server as { name?: string; authUrl?: string };
        return [row.name, row.authUrl].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    if (lines.length) {
      const id = ensureText(state, chunks);
      chunks.push({
        type: "text-delta",
        id,
        delta: `\n\nConnect to continue: ${lines.join(", ")}`,
      });
    }
    return chunks;
  }

  if (type === "turn.done") {
    const turnState = event.state as { status?: string; message?: string } | undefined;
    if (turnState?.status === "error") {
      chunks.push({
        type: "error",
        errorText: turnState.message || "The turn failed.",
      });
    }
  }

  return chunks;
}

export function closeTrueForgeUi(state: TrueForgeUiState): UiChunk[] {
  const chunks: UiChunk[] = [];
  flushPendingTools(state, chunks);
  if (state.reasoningId) chunks.push({ type: "reasoning-end", id: state.reasoningId });
  if (state.textId) chunks.push({ type: "text-end", id: state.textId });
  return chunks;
}
