/**
 * Map TrueForge turn events onto the AI SDK UI chunks Aether's thread already renders.
 * Tool rows use the existing tool shells. Approvals use the existing confirm card.
 */

import { redactSandboxText, redactSandboxValue, type SandboxFileRef } from "./sandbox-files";

export type UiChunk = Record<string, unknown>;

type ToolBuf = { id?: string; name?: string; args: string };

type ChildThread = { toolCallId: string; text: string };

export type TrueForgeUiState = {
  textSeq: number;
  compactionSeq: number;
  textId: string | null;
  reasoningId: string | null;
  tools: Map<number, ToolBuf>;
  opened: Set<string>;
  rootThreadId: string | null;
  childThreads: Map<string, ChildThread>;
  sandboxHold: string;
  reasoningHold: string;
  sandboxFiles: SandboxFileRef[];
  openTools: Map<string, string>;
};

export function createTrueForgeUiState(): TrueForgeUiState {
  return {
    textSeq: 0,
    compactionSeq: 0,
    textId: null,
    reasoningId: null,
    tools: new Map(),
    opened: new Set(),
    rootThreadId: null,
    childThreads: new Map(),
    sandboxHold: "",
    reasoningHold: "",
    sandboxFiles: [],
    openTools: new Map(),
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

function rememberSandboxFiles(state: TrueForgeUiState, refs: SandboxFileRef[]) {
  for (const ref of refs) {
    if (!state.sandboxFiles.some((existing) => existing.path === ref.path)) {
      state.sandboxFiles.push(ref);
    }
  }
}

function pushVisibleText(state: TrueForgeUiState, chunks: UiChunk[], raw: string) {
  if (!raw) return;
  const fed = redactSandboxText(state.sandboxHold + raw);
  state.sandboxHold = fed.held;
  rememberSandboxFiles(state, fed.refs);
  if (!fed.visible) return;
  const id = ensureText(state, chunks);
  chunks.push({ type: "text-delta", id, delta: fed.visible });
}

function pushVisibleReasoning(state: TrueForgeUiState, chunks: UiChunk[], raw: string) {
  if (!raw) return;
  const fed = redactSandboxText(state.reasoningHold + raw);
  state.reasoningHold = fed.held;
  rememberSandboxFiles(state, fed.refs);
  if (!fed.visible) return;
  if (!state.reasoningId) {
    state.reasoningId = "tf-reason";
    chunks.push({ type: "reasoning-start", id: state.reasoningId });
  }
  chunks.push({ type: "reasoning-delta", id: state.reasoningId, delta: fed.visible });
}

/** Release a path fragment held across streamed chunks. */
export function flushSandboxHold(state: TrueForgeUiState): UiChunk[] {
  const chunks: UiChunk[] = [];
  if (state.sandboxHold) {
    const fed = redactSandboxText(state.sandboxHold, { flush: true });
    state.sandboxHold = "";
    rememberSandboxFiles(state, fed.refs);
    if (fed.visible) {
      const id = ensureText(state, chunks);
      chunks.push({ type: "text-delta", id, delta: fed.visible });
    }
  }
  if (state.reasoningHold) {
    const fed = redactSandboxText(state.reasoningHold, { flush: true });
    state.reasoningHold = "";
    rememberSandboxFiles(state, fed.refs);
    if (fed.visible) {
      if (!state.reasoningId) {
        state.reasoningId = "tf-reason";
        chunks.push({ type: "reasoning-start", id: state.reasoningId });
      }
      chunks.push({ type: "reasoning-delta", id: state.reasoningId, delta: fed.visible });
    }
  }
  return chunks;
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

function closeOpenText(state: TrueForgeUiState, chunks: UiChunk[]) {
  if (!state.textId) return;
  chunks.push({ type: "text-end", id: state.textId });
  state.textId = null;
}

/** Emit tool-input-available once arguments have stopped streaming. */
export function flushPendingTools(state: TrueForgeUiState, chunks: UiChunk[]) {
  let closing = false;
  for (const tool of state.tools.values()) {
    if (!tool.id || !tool.name || state.opened.has(tool.id)) continue;
    closing = true;
    break;
  }
  if (closing) closeOpenText(state, chunks);
  for (const tool of state.tools.values()) {
    if (!tool.id || !tool.name || state.opened.has(tool.id)) continue;
    state.opened.add(tool.id);
    state.openTools.set(tool.id, tool.name);
    chunks.push({
      type: "tool-input-available",
      toolCallId: tool.id,
      toolName: tool.name,
      input: parseToolInput(tool.args),
      providerExecuted: true,
    });
  }
}

function confirmationPayload(output: unknown): Record<string, unknown> | null {
  const row = unwrapToolOutput(output);
  if (!row || typeof row !== "object") return null;
  const data = row as { needs_confirmation?: unknown; confirmation_id?: unknown; title?: unknown; preview?: unknown };
  if (data.needs_confirmation !== true || typeof data.confirmation_id !== "string" || !data.confirmation_id) {
    return null;
  }
  return {
    needs_confirmation: true,
    confirmation_id: data.confirmation_id,
    title: typeof data.title === "string" ? data.title : "Allow this step?",
    preview: typeof data.preview === "string" ? data.preview : "",
  };
}

function unwrapToolOutput(output: unknown): unknown {
  if (typeof output === "string") {
    try {
      return unwrapToolOutput(JSON.parse(output));
    } catch {
      return output;
    }
  }
  if (!output || typeof output !== "object" || !("content" in output)) return output;
  const content = (output as { content?: unknown }).content;
  if (!Array.isArray(content)) return output;
  const text = content
    .map((part) =>
      part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : "",
    )
    .join("");
  if (!text) return output;
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
    const existing = state.tools.get(index);
    if (row.id && existing?.id && existing.id !== row.id) {
      state.tools.set(index, {
        id: row.id,
        name: row.function?.name,
        args: row.function?.arguments ?? "",
      });
      continue;
    }
    const buf = existing ?? { args: "" };
    if (row.id) buf.id = row.id;
    if (row.function?.name) buf.name = row.function.name;
    if (row.function?.arguments) buf.args += row.function.arguments;
    state.tools.set(index, buf);
  }
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function eventThreadId(event: { [key: string]: unknown }): string | null {
  return stringField(event.threadId) ?? stringField(event.thread_id);
}

function parentToolCallId(event: { [key: string]: unknown }): string | null {
  const parent = event.parent;
  if (!parent || typeof parent !== "object") return null;
  const row = parent as { toolCallId?: unknown; tool_call_id?: unknown };
  return stringField(row.toolCallId) ?? stringField(row.tool_call_id);
}

function rememberChildThread(state: TrueForgeUiState, threadId: string, toolCallId: string | null) {
  const existing = state.childThreads.get(threadId);
  state.childThreads.set(threadId, {
    toolCallId: toolCallId || existing?.toolCallId || "",
    text: existing?.text ?? "",
  });
}

function isChildThread(state: TrueForgeUiState, threadId: string | null): boolean {
  if (!threadId) return false;
  if (state.childThreads.has(threadId)) return true;
  return state.rootThreadId != null && threadId !== state.rootThreadId;
}

function appendChildText(state: TrueForgeUiState, threadId: string, text: string) {
  const existing = state.childThreads.get(threadId);
  state.childThreads.set(threadId, {
    toolCallId: existing?.toolCallId ?? "",
    text: `${existing?.text ?? ""}${text}`,
  });
}

function childTextForTool(state: TrueForgeUiState, toolCallId: string): string {
  for (const child of state.childThreads.values()) {
    if (child.toolCallId === toolCallId && child.text) return child.text;
  }
  return "";
}

/** One TrueForge event → zero or more UI chunks. */
export function chunksForTrueForgeEvent(
  event: { type?: string; [key: string]: unknown },
  state: TrueForgeUiState,
): UiChunk[] {
  const chunks: UiChunk[] = [];
  const type = event.type;
  const threadId = eventThreadId(event);
  if (type === "thread.created") {
    const toolCallId = parentToolCallId(event);
    if (threadId) rememberChildThread(state, threadId, toolCallId);
    flushPendingTools(state, chunks);
    return chunks;
  }
  if (type === "agent.context.overwrite") {
    const reason = event.reason ?? event.overwrite_reason ?? event.overwriteReason;
    if (reason === "compaction") {
      closeOpenText(state, chunks);
      state.compactionSeq += 1;
      const eventId = stringField(event.id) ?? `event-${state.compactionSeq}`;
      const toolCallId = `context-compaction-${eventId}`;
      chunks.push({
        type: "tool-input-available",
        toolCallId,
        toolName: "context_compaction",
        input: {},
        providerExecuted: true,
      });
      chunks.push({
        type: "tool-output-available",
        toolCallId,
        output: "Summarized earlier context",
        providerExecuted: true,
      });
    }
    return chunks;
  }
  if (threadId && !state.rootThreadId && !state.childThreads.has(threadId)) {
    state.rootThreadId = threadId;
  }
  if (isChildThread(state, threadId) && threadId) {
    if (!state.childThreads.has(threadId)) rememberChildThread(state, threadId, null);
    const delta = textOf(event.content);
    if (delta && (type === "model.message.delta" || type === "model.message")) {
      appendChildText(state, threadId, delta);
    }
    return chunks;
  }

  if (type === "model.message.delta") {
    const reasoning = typeof event.reasoningContent === "string" ? event.reasoningContent : "";
    if (reasoning) pushVisibleReasoning(state, chunks, reasoning);
    if (event.finishReason) flushPendingTools(state, chunks);
    pushVisibleText(state, chunks, textOf(event.content));
    absorbToolDelta(state, chunks, event.toolCalls);
    return chunks;
  }

  if (type === "model.message") {
    const reasoning = typeof event.reasoningContent === "string" ? event.reasoningContent : "";
    if (reasoning && !state.reasoningId) pushVisibleReasoning(state, chunks, reasoning);
    pushVisibleText(state, chunks, textOf(event.content));
    if (Array.isArray(event.toolCalls)) {
      event.toolCalls.forEach((call, index) => {
        if (!call || typeof call !== "object") return;
        const row = call as {
          id?: string;
          function?: { name?: string; arguments?: string };
        };
        const existing = state.tools.get(index);
        if (row.id && existing?.id && existing.id !== row.id) {
          state.tools.set(index, {
            id: row.id,
            name: row.function?.name,
            args: row.function?.arguments ?? "",
          });
          return;
        }
        const buf = existing ?? { args: "" };
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
    const toolCallId =
      (typeof event.toolCallId === "string" && event.toolCallId) ||
      (typeof event.tool_call_id === "string" && event.tool_call_id) ||
      "";
    if (!toolCallId) return chunks;
    let output: unknown = event.content;
    if (typeof event.content === "string") {
      try {
        output = JSON.parse(event.content);
      } catch {
        output = event.content;
      }
    }
    const childReport = childTextForTool(state, toolCallId);
    const blankOutput = output == null || (typeof output === "string" && output.trim() === "");
    if (childReport && blankOutput) output = childReport;
    output = redactSandboxValue(output, state.sandboxFiles);
    state.openTools.delete(toolCallId);
    chunks.push({
      type: "tool-output-available",
      toolCallId,
      output,
      providerExecuted: true,
    });
    const confirm = confirmationPayload(output);
    if (confirm) {
      chunks.push({
        type: "tool-input-available",
        toolCallId: `confirm-${toolCallId}`,
        toolName: "request_confirmation",
        providerExecuted: true,
        input: {
          title: confirm.title,
          preview: confirm.preview,
          action: "approve",
        },
      });
      chunks.push({
        type: "tool-output-available",
        toolCallId: `confirm-${toolCallId}`,
        output: confirm,
        providerExecuted: true,
      });
    }
    return chunks;
  }

  if (type === "tool.approval_required" && Array.isArray(event.toolCalls)) {
    flushPendingTools(state, chunks);
    const sessionId = typeof event.sessionId === "string" ? event.sessionId : "";
    for (const call of event.toolCalls) {
      if (!call || typeof call !== "object") continue;
      const toolCallId = String((call as { id?: string }).id ?? "");
      if (!toolCallId) continue;
      state.openTools.delete(toolCallId);
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
        providerExecuted: true,
      });
      if (!confirmationId) continue;
      chunks.push({
        type: "tool-input-available",
        toolCallId: `confirm-${toolCallId}`,
        toolName: "request_confirmation",
        providerExecuted: true,
        input: {
          title: "Allow this step?",
          preview,
          action: "approve",
        },
      });
      chunks.push({
        type: "tool-output-available",
        toolCallId: `confirm-${toolCallId}`,
        providerExecuted: true,
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

  if (type === "tool.response_required" && Array.isArray(event.toolCalls)) {
    flushPendingTools(state, chunks);
    for (const call of event.toolCalls) {
      if (!call || typeof call !== "object") continue;
      const row = call as { id?: string; confirmationId?: string };
      if (!row.id) continue;
      const tool = [...state.tools.values()].find((tool) => tool.id === row.id);
      const args = parseToolInput(tool?.args ?? "") as { question?: unknown; options?: unknown };
      const question = typeof args.question === "string" ? args.question : "What would you like to do next?";
      const options = Array.isArray(args.options) ? args.options.filter((option): option is string => typeof option === "string") : [];
      if (!state.opened.has(row.id)) {
        state.opened.add(row.id);
        chunks.push({ type: "tool-input-available", toolCallId: row.id, toolName: "ask_user_question", input: { question, options }, providerExecuted: true });
      }
      state.openTools.delete(row.id);
      chunks.push({ type: "tool-output-available", toolCallId: row.id, providerExecuted: true, output: { needs_response: true, confirmation_id: row.confirmationId ?? event.confirmationId ?? "", question, options, session_id: event.sessionId ?? "", thread_id: event.threadId ?? event.thread_id ?? "" } });
    }
    return chunks;
  }

  if (type === "mcp.auth_required" && Array.isArray(event.mcpServers)) {
    const servers = event.mcpServers.flatMap((server) => {
      if (!server || typeof server !== "object") return [];
      const row = server as { name?: unknown; authUrl?: unknown };
      if (typeof row.name !== "string" || typeof row.authUrl !== "string") return [];
      return [{ name: row.name, authUrl: row.authUrl }];
    });
    if (servers.length) {
      closeOpenText(state, chunks);
      const toolCallId = `mcp-auth-${String(event.id ?? state.opened.size)}`;
      state.opened.add(toolCallId);
      chunks.push({ type: "tool-input-available", toolCallId, toolName: "mcp_auth_connect", input: {}, providerExecuted: true });
      chunks.push({ type: "tool-output-available", toolCallId, output: { servers }, providerExecuted: true });
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

export const TOOL_DID_NOT_FINISH = "This step did not finish.";

/** Close every tool that never got a response, so the thread stops running. */
export function closeTrueForgeUi(state: TrueForgeUiState): UiChunk[] {
  const chunks: UiChunk[] = [];
  flushPendingTools(state, chunks);
  for (const toolCallId of state.openTools.keys()) {
    chunks.push({
      type: "tool-output-available",
      toolCallId,
      output: { ok: false, error: TOOL_DID_NOT_FINISH },
      providerExecuted: true,
    });
  }
  state.openTools.clear();
  if (state.reasoningId) chunks.push({ type: "reasoning-end", id: state.reasoningId });
  if (state.textId) chunks.push({ type: "text-end", id: state.textId });
  return chunks;
}
