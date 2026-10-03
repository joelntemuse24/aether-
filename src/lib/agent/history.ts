/**
 * Each turn rebuilds the model transcript from the conversation.
 * Nothing is kept in a sidecar session, so edit, regenerate, and branch stay intact.
 */

import { ensureDurableToolStubs } from "@/lib/chat-tool-transcript";
import {
  resolveChatMessages,
  type UnderSentHistoryDetails,
} from "@/lib/chat-history-merge";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";

export async function prepareAgentHistory(input: {
  conversationId: string | null;
  incoming: UIMessage[];
  stored?: UIMessage[];
  log?: (event: "under_sent_history", details: UnderSentHistoryDetails) => void;
}): Promise<{ uiMessages: UIMessage[]; modelMessages: ModelMessage[] }> {
  const uiMessages = resolveChatMessages({
    conversationId: input.conversationId,
    incoming: input.incoming,
    stored: input.stored ?? [],
    log: input.log,
  });
  const modelMessages = await convertToModelMessages(ensureDurableToolStubs(uiMessages), {
    ignoreIncompleteToolCalls: true,
  });
  return { uiMessages, modelMessages };
}
