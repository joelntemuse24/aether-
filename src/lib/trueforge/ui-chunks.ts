/**
 * Map TrueForge turn events onto the AI SDK UI chunks Aether's thread already renders.
 * Tool rows use the existing tool shells. Approvals use the existing confirm card.
 */

export type UiChunk = Record<string, unknown>;

type ToolBuf = { id?: string; name?: string; args: string };

export type TrueForgeUiState = {
  textId: string | null;
  reasoningId: string | null;
  tools: Map<number, ToolBuf>;
  opened: Set<string>;
};

export function createTrueForgeUiState(): TrueForgeUiState {
  return {
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
  state.textId = "tf-text";
  chunks.push({ type: "text-start", id: state.textId });
  return state.textId;
}

function openTool(state: TrueForgeUiState, chunks: UiChunk[], tool: ToolBuf) {
  if (!tool.id || !tool.name || state.opened.has(tool.id)) return;
  state.opened.add(tool.id);
  let input: unknown = {};
  try {
    input = tool.args ? JSON.parse(tool.args) : {};
  } catch {
    input = { raw: tool.args };
  }
  chunks.push({
    type: "tool-input-available",
    toolCallId: tool.id,
    toolName: tool.name,
    input,
  });
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
    openTool(state, chunks, buf);
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
        openTool(state, chunks, buf);
      });
    }
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
    for (const call of event.toolCalls) {
      if (!call || typeof call !== "object") continue;
      const toolCallId = String((call as { id?: string }).id ?? "");
      if (!toolCallId) continue;
      const confirmationId = `tf_${toolCallId}`;
      chunks.push({
        type: "tool-input-available",
        toolCallId: `confirm-${toolCallId}`,
        toolName: "request_confirmation",
        input: {
          title: "Allow this step?",
          preview: toolCallId,
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
          preview: "TrueForge is waiting for approval before it continues.",
        },
      });
    }
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
  if (state.reasoningId) chunks.push({ type: "reasoning-end", id: state.reasoningId });
  if (state.textId) chunks.push({ type: "text-end", id: state.textId });
  return chunks;
}
