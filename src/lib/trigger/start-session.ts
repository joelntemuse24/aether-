import type { ChatClientData } from "./client-data";

export function mergeStartSessionClientData(input: {
  clientData: ChatClientData;
  userId: string | null;
  conversationId: string;
  contextToken: string;
  hasDrive: boolean;
  hasGitHub: boolean;
  hasMemory: boolean;
}): ChatClientData {
  return {
    ...input.clientData,
    userId: input.userId,
    conversationId: input.conversationId,
    contextToken: input.contextToken,
    hasDrive: input.hasDrive,
    hasGitHub: input.hasGitHub,
    hasMemory: input.hasMemory,
  };
}
