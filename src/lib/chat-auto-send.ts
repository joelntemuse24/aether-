import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { TOOL_NAMES } from "@/lib/tools";

/** Re-post only when the browser still has to run execute_python. Sidecar tools must not. */
export function shouldAutoSendClientTools({ messages }: { messages: UIMessage[] }): boolean {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  return last.parts.some((part) => {
    if (part.type !== `tool-${TOOL_NAMES.executePython}`) return false;
    if (!("state" in part)) return false;
    if ("providerExecuted" in part && part.providerExecuted) return false;
    return part.state === "output-available" || part.state === "output-error";
  });
}
