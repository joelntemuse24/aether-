import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { rememberTrueForgeApproval } from "./approvals";
import { trueforgeClient, trueforgeSessionId } from "./sessions";
import {
  chunksForTrueForgeEvent,
  closeTrueForgeUi,
  createTrueForgeUiState,
} from "./ui-chunks";

export async function streamTrueForgeHostedChat(input: {
  conversationId: string | null;
  userText: string;
  abortSignal?: AbortSignal;
}): Promise<Response> {
  const conversationId = input.conversationId || `guest-${Date.now()}`;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const sessionId = await trueforgeSessionId(conversationId);
      const turn = await trueforgeClient().sessions.createTurnStream(
        sessionId,
        {
          input: [{ type: "user.message", content: input.userText || "" }],
        },
        { abortSignal: input.abortSignal },
      );
      const state = createTrueForgeUiState();
      for await (const event of turn) {
        if (event.type === "tool.approval_required") {
          for (const call of event.toolCalls) {
            rememberTrueForgeApproval(`tf_${call.id}`, {
              sessionId,
              threadId: event.threadId,
              toolCallId: call.id,
            });
          }
        }
        for (const chunk of chunksForTrueForgeEvent(
          event as unknown as { type?: string; [key: string]: unknown },
          state,
        )) {
          writer.write(chunk as never);
        }
      }
      for (const chunk of closeTrueForgeUi(state)) {
        writer.write(chunk as never);
      }
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: (error) =>
      error instanceof Error ? error.message : "The harness turn failed.",
  });
  return createUIMessageStreamResponse({ stream });
}
