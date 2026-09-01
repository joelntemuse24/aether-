import type { UIMessage } from "ai";

type ToolLikePart = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function isToolPart(part: UIMessage["parts"][number]): part is UIMessage["parts"][number] &
  ToolLikePart {
  return typeof part.type === "string" && part.type.startsWith("tool-");
}

function toolCallKey(part: ToolLikePart): string {
  if (typeof part.toolCallId === "string" && part.toolCallId.length > 0) {
    return part.toolCallId;
  }
  return part.type;
}

function hasCompletedOutput(part: ToolLikePart): boolean {
  return part.output != null || (typeof part.errorText === "string" && part.errorText.length > 0);
}

function completedToolParts(message: UIMessage): Array<UIMessage["parts"][number] & ToolLikePart> {
  if (!Array.isArray(message.parts)) return [];
  return message.parts.filter((part): part is UIMessage["parts"][number] & ToolLikePart => {
    return isToolPart(part) && hasCompletedOutput(part);
  });
}

/** Incoming draft wins for text; stored completed tool stubs are kept if the draft dropped them. */
export function preferToolRichMessage(
  stored: UIMessage,
  incoming: UIMessage,
): UIMessage {
  const storedTools = completedToolParts(stored);
  if (storedTools.length === 0) return incoming;

  const incomingParts = Array.isArray(incoming.parts) ? incoming.parts : [];
  const incomingKeys = new Set(
    incomingParts.filter(isToolPart).filter(hasCompletedOutput).map(toolCallKey),
  );
  const missing = storedTools.filter((part) => !incomingKeys.has(toolCallKey(part)));
  if (missing.length === 0) return incoming;

  return {
    ...incoming,
    parts: [...incomingParts, ...missing],
  };
}

export function restoreDurableToolStubsFromStored(
  stored: UIMessage[],
  incoming: UIMessage[],
): UIMessage[] {
  if (!Array.isArray(stored) || stored.length === 0) return incoming;
  const byId = new Map<string, UIMessage>();
  for (const message of stored) {
    if (message.id) byId.set(message.id, message);
  }
  return incoming.map((message) => {
    const prior = message.id ? byId.get(message.id) : undefined;
    return prior ? preferToolRichMessage(prior, message) : message;
  });
}

const STUB_OUTPUT = {
  ok: false,
  stub: true,
  error: "Tool call did not finish; result unavailable.",
} as const;

/**
 * Every tool-* part must leave a completed stub (state + output) so the next
 * convertToModelMessages / persist cycle can see what happened.
 */
export function ensureDurableToolStubs(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.parts)) return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!isToolPart(part)) return part;
      if (part.state === "output-available" && part.output != null) return part;
      if (part.state === "output-error" && (part.output != null || part.errorText)) {
        return part;
      }
      changed = true;
      const next: ToolLikePart = {
        ...part,
        type: part.type,
        toolCallId:
          typeof part.toolCallId === "string" && part.toolCallId
            ? part.toolCallId
            : `stub-${part.type}`,
        state: "output-available",
        input: part.input ?? {},
        output: part.output ?? { ...STUB_OUTPUT },
      };
      return next as UIMessage["parts"][number];
    });
    return changed ? { ...message, parts } : message;
  });
}
