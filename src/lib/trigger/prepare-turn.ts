/**
 * Assemble a durable-agent turn from ephemeral clientData + optional Neon.
 * BYOK keys stay in clientData; hosted keys come from worker env.
 */

import type { UIMessage } from "ai";
import { isCloudDbConfigured } from "@/lib/db";
import { relevantMemoryPrompt } from "@/lib/memory/store";
import {
  formatProjectForPrompt,
  getProject,
} from "@/lib/projects/store";
import { getAuthSecretString } from "@/lib/auth-secret";
import {
  DEFAULT_TOOL_APPROVAL_MODE,
  parseToolApprovalMode,
} from "@/lib/hermes/tool-approval";
import type { ChatClientData } from "./client-data";
import { verifyAgentContextToken } from "./context-token";
import {
  composeChatSystem,
  lastUserText,
  parseHarnessFields,
  resolveTurnTimeBudget,
} from "@/lib/chat-turn";
import { redactChatClientData } from "./client-data";

export async function prepareDurableChatTurn(input: {
  clientData: ChatClientData;
  chatId: string;
  uiMessages?: UIMessage[];
  userText?: string;
}): Promise<{
  hosted: boolean;
  requestedModel: string;
  provider: NonNullable<ChatClientData["provider"]>;
  apiKey: string;
  baseURL: string;
  origin: string | null;
  system: string;
  toolsEnabled: boolean;
  userId: string | null;
  conversationId: string | null;
  projectId?: string;
  hasDrive: boolean;
  hasGitHub: boolean;
  hasMemory: boolean;
  harnessDepth: ReturnType<typeof parseHarnessFields>["harnessDepth"];
  harnessIntent: ReturnType<typeof parseHarnessFields>["harnessIntent"];
  harnessRunId?: string;
  maxSteps: number;
  maxWebSearches: number | null;
  approvalMode: ReturnType<typeof parseToolApprovalMode>;
  contextToken?: string;
  continueSegment: boolean;
}> {
  const data = input.clientData;
  const hosted = data.accessMode !== "byok";
  const conversationId = data.conversationId || input.chatId;
  let userId = data.userId ?? null;
  let hasDrive = data.hasDrive === true;
  let hasGitHub = data.hasGitHub === true;
  const approvalMode = parseToolApprovalMode(
    data.approvalMode ?? DEFAULT_TOOL_APPROVAL_MODE,
  );

  if (data.contextToken) {
    const ctx = await verifyAgentContextToken(
      data.contextToken,
      getAuthSecretString(),
    );
    if (ctx) {
      userId = ctx.userId;
      hasDrive = ctx.hasDrive;
      hasGitHub = ctx.hasGitHub;
    }
  }

  const messages = input.uiMessages ?? [];
  const userText = input.userText || lastUserText(messages) || "";
  const parsed = parseHarnessFields(data.harness);
  const timeBudget = resolveTurnTimeBudget(data.harness, userText);

  let memoryBlock = "";
  let projectBlock = "";
  const hasMemory = !!(userId && isCloudDbConfigured());
  if (hasMemory && userId) {
    try {
      memoryBlock = await relevantMemoryPrompt(userId, userText);
      if (data.projectId) {
        const project = await getProject(userId, data.projectId);
        projectBlock = formatProjectForPrompt(project);
      }
    } catch (err) {
      console.warn("[chat.agent] memory/project", redactChatClientData({ err: String(err) }));
    }
  }
  const useClientMemory = !hasMemory;
  const memoryForPrompt =
    memoryBlock || (useClientMemory ? data.memoryContext : "") || "";

  const hasBrowserless = !!(
    process.env.BROWSERLESS_TOKEN?.trim() ||
    process.env.BROWSERLESS_URL?.trim()
  );

  const composed = composeChatSystem({
    toolsEnabled: data.toolsEnabled !== false,
    hermesLive: false,
    userText,
    harnessDepth: parsed.harnessDepth,
    harnessIntent: parsed.harnessIntent,
    harnessClarifications: parsed.harnessClarifications,
    harnessPlanSteps: parsed.harnessPlanSteps,
    timeBudget,
    continueSegment: data.continueSegment === true,
    userSystem: data.system,
    memoryForPrompt,
    projectBlock,
    hasDrive,
    hasGitHub,
    hasBrowserless,
    signedIn: !!userId,
    hasMemory,
    canPersistArtifacts: hasMemory,
    approvalMode,
  });

  return {
    hosted,
    requestedModel: data.model,
    provider: data.provider ?? "openrouter",
    apiKey: hosted ? "" : data.apiKey ?? "",
    baseURL: data.baseURL ?? "",
    origin: data.origin ?? null,
    system: composed.system,
    toolsEnabled: data.toolsEnabled !== false,
    userId,
    conversationId,
    projectId: data.projectId,
    hasDrive,
    hasGitHub,
    hasMemory,
    harnessDepth: composed.harnessDepth,
    harnessIntent: parsed.harnessIntent,
    harnessRunId: parsed.harnessRunId,
    maxSteps: composed.budget.maxSteps,
    maxWebSearches: timeBudget?.maxSearches ?? null,
    approvalMode,
    contextToken: data.contextToken,
    continueSegment: data.continueSegment === true,
  };
}
