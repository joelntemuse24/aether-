import type { UIMessage } from "ai";
import { streamLegacyLocalChat } from "@/lib/harness/legacy-local-stream";
import { updateAgentRunStatus } from "@/lib/harness/runs-store";
import type { HarnessChatContext } from "@/lib/harness/types";
import { auth } from "@/auth";
import { relevantMemoryPrompt } from "@/lib/memory/store";
import {
  formatProjectForPrompt,
  getProject,
} from "@/lib/projects/store";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import { getValidGitHubAccessToken } from "@/lib/github-session";
import { isCloudDbConfigured } from "@/lib/db";
import { isHostedConfigured } from "@/lib/hosted/config";
import { isHostedChatAvailable } from "@/lib/hosted/availability";
import { shouldProxyChatToHermes } from "@/lib/hermes/config";
import { proxyChatToHermes } from "@/lib/hermes/proxy-chat";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import { registerAetherToolSession } from "@/lib/hermes/tool-session";
import { buildHermesSessionKey } from "@/lib/hermes/config";
import { getUserPreferences } from "@/lib/preferences/store";
import { ensureConfirmationRepository } from "@/lib/harness/confirmation-store";
import {
  resolveChatMessages,
  uiMessagesFromFormatRepo,
} from "@/lib/chat-history-merge";
import { getMessageRepo } from "@/lib/conversations/store";
import {
  composeChatSystem,
  enrichMessagesWithAttachments,
  lastUserText,
  parseHarnessFields,
  resolveTurnTimeBudget,
  type IncomingAttachment,
} from "@/lib/chat-turn";

/**
 * Only applies on Vercel serverless. Railway / `next start` has no function
 * wall clock — long tool turns finish in one request. Keep Continue for
 * genuine disconnects.
 */
export const maxDuration = 300;
export const runtime = "nodejs";

type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

function getHeader(req: Request, name: string): string {
  return req.headers.get(name)?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const accessMode = getHeader(req, "x-access-mode") || "byok";
    const apiKey = getHeader(req, "x-api-key");
    const provider = (getHeader(req, "x-provider") || "openrouter") as ProviderId;
    const baseURL = getHeader(req, "x-base-url");
    const headerModel = getHeader(req, "x-model");
    const hosted = accessMode === "hosted";

    if (hosted) {
      // Hosted = server OpenRouter / BUZZ keys. Hermes is opt-in only.
      if (!isHostedChatAvailable(process.env, isHostedConfigured())) {
        return new Response(
          JSON.stringify({
            error:
              "Aether Cloud is not configured on this server. Switch to Bring your own key in Settings, or ask the operator to set OPENROUTER_API_KEY.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
    } else if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid request body." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const incomingMessages = body.messages as UIMessage[];
    if (!Array.isArray(incomingMessages) || incomingMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages provided." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId : null;
    const toolsEnabled = getHeader(req, "x-tools") !== "0";
    const continueSegment = body.continueSegment === true;
    const userSystem =
      typeof body.system === "string" && body.system.length <= 8000
        ? body.system
        : undefined;

    const rawHarness = body.harness as HarnessChatContext | undefined;
    const {
      harnessDepth: parsedDepth,
      harnessIntent,
      harnessClarifications,
      harnessPlanSteps,
      harnessRunId,
    } = parseHarnessFields(rawHarness);

    ensureConfirmationRepository();
    const session = await auth();
    const userId = session?.user?.id || session?.user?.email || null;

    let storedMessages: UIMessage[] = [];
    if (conversationId && userId && isCloudDbConfigured()) {
      try {
        storedMessages = uiMessagesFromFormatRepo(
          await getMessageRepo(userId, conversationId),
        );
      } catch {
        storedMessages = [];
      }
    }
    const messages = resolveChatMessages({
      conversationId,
      incoming: incomingMessages,
      stored: storedMessages,
      log: (event, details) => {
        console.warn(`[api/chat] ${event}`, details);
      },
    });

    let approvalMode = parseToolApprovalMode(
      getHeader(req, "x-tool-approval-mode"),
    );
    if (userId && isCloudDbConfigured() && !getHeader(req, "x-tool-approval-mode")) {
      const prefs = await getUserPreferences(userId);
      approvalMode = prefs.toolApprovalMode;
    }

    const userText = lastUserText(messages);
    const timeBudget = resolveTurnTimeBudget(rawHarness, userText);
    const projectId =
      typeof body.projectId === "string" ? body.projectId : undefined;

    let memoryBlock = "";
    let projectBlock = "";
    if (userId && isCloudDbConfigured()) {
      memoryBlock = await relevantMemoryPrompt(
        userId,
        lastUserText(messages),
      );
      if (projectId) {
        const project = await getProject(userId, projectId);
        projectBlock = formatProjectForPrompt(project);
      }
    }

    // Client local memory only when cloud memory is not the active source.
    const clientMemory =
      typeof body.memoryContext === "string" && body.memoryContext.length <= 6000
        ? body.memoryContext
        : undefined;
    const useClientMemory = !userId || !isCloudDbConfigured();
    const memoryForPrompt = memoryBlock || (useClientMemory ? clientMemory : "");

    const hasDriveEarly = userId
      ? !!(await getValidDriveAccessToken(userId))
      : false;
    const hasGitHubEarly = userId
      ? !!(await getValidGitHubAccessToken(userId))
      : false;
    const hasBrowserless = !!(
      process.env.BROWSERLESS_TOKEN?.trim() ||
      process.env.BROWSERLESS_URL?.trim()
    );

    const hermesLive = shouldProxyChatToHermes({ hosted });
    const composed = composeChatSystem({
      toolsEnabled,
      hermesLive,
      userText,
      harnessDepth: parsedDepth,
      harnessIntent,
      harnessClarifications,
      harnessPlanSteps,
      timeBudget,
      continueSegment,
      userSystem,
      memoryForPrompt,
      projectBlock,
      hasDrive: hasDriveEarly,
      hasGitHub: hasGitHubEarly,
      hasBrowserless,
      signedIn: !!userId,
      hasMemory: !!(userId && isCloudDbConfigured()),
      canPersistArtifacts: !!(userId && isCloudDbConfigured()),
      approvalMode,
    });
    const { system, harnessDepth, budget } = composed;
    const requestedModel =
      (typeof body.model === "string" && body.model) || headerModel;

    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as IncomingAttachment[])
      : [];
    const textPrefix =
      typeof body.textPrefix === "string" ? body.textPrefix : undefined;

    if (!requestedModel) {
      return new Response(
        JSON.stringify({ error: "No model selected. Pick a model from the dropdown." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const enrichedMessages = enrichMessagesWithAttachments(
      messages,
      attachments,
      textPrefix,
    );

    if (harnessRunId) {
      if (userId) {
        void updateAgentRunStatus({
          id: harnessRunId,
          userId,
          status:
            harnessDepth === "deep" || timeBudget?.forceEarlyDraft
              ? "verifying"
              : "acting",
          eventType: continueSegment ? "chat_continued" : "chat_started",
          eventPayload: {
            depth: harnessDepth,
            intent: harnessIntent,
            maxSteps: budget.maxSteps,
            timeBudgetMinutes: timeBudget?.minutes ?? null,
            surface: rawHarness?.surface ?? "chat",
            engine: hermesLive ? "hermes" : "local",
          },
        });
      }
    }

    // Hermes owns the hosted tool loop. BYOK (and hosted without Hermes)
    // stay on the isolated local streamText path — user keys never leave Vercel.
    if (hermesLive) {
      console.info("[api/chat] hermes proxy", {
        conversationId,
        model: requestedModel,
        runId: harnessRunId ?? null,
        userId: userId ? "yes" : "no",
      });
      const driveToken = hasDriveEarly && userId
        ? await getValidDriveAccessToken(userId)
        : null;
      const githubToken = hasGitHubEarly && userId
        ? await getValidGitHubAccessToken(userId)
        : null;
      const sessionKey = buildHermesSessionKey({ userId, conversationId });
      registerAetherToolSession({
        sessionKey,
        userId,
        conversationId,
        projectId: projectId ?? null,
        runId: harnessRunId ?? null,
        approvalMode,
        hasMemory: !!(userId && isCloudDbConfigured()),
        hasDrive: hasDriveEarly,
        hasGitHub: hasGitHubEarly,
        driveAccessToken: driveToken?.accessToken,
        githubAccessToken: githubToken?.accessToken,
      });
      return proxyChatToHermes({
        messages: enrichedMessages,
        system,
        model: requestedModel,
        userId,
        conversationId,
        runId: harnessRunId,
        abortSignal: req.signal,
        accessMode: "hosted",
        aetherTools: toolsEnabled
          ? {
              userId,
              conversationId,
              projectId: projectId ?? null,
              runId: harnessRunId ?? null,
              approvalMode,
              hasMemory: !!(userId && isCloudDbConfigured()),
              hasDrive: hasDriveEarly,
              hasGitHub: hasGitHubEarly,
              driveAccessToken: driveToken?.accessToken,
              githubAccessToken: githubToken?.accessToken,
            }
          : null,
        onFinish: () => {
          if (harnessRunId && userId) {
            void updateAgentRunStatus({
              id: harnessRunId,
              userId,
              status: "done",
              eventType: "chat_finished",
              eventPayload: {
                depth: harnessDepth,
                intent: harnessIntent,
                engine: "hermes",
              },
            });
          }
        },
        onError: (error) => {
          console.error("[api/chat] hermes", error);
          if (harnessRunId && userId) {
            void updateAgentRunStatus({
              id: harnessRunId,
              userId,
              status: "done",
              eventType: "chat_error",
              eventPayload: {
                error: error instanceof Error ? error.message : "error",
                engine: "hermes",
              },
            });
          }
        },
      });
    }

    return streamLegacyLocalChat({
      hosted,
      requestedModel,
      provider,
      apiKey,
      baseURL,
      origin: req.headers.get("origin"),
      messages,
      enrichedMessages,
      system,
      toolsEnabled,
      userId,
      conversationId,
      projectId,
      hasDrive: hasDriveEarly,
      hasGitHub: hasGitHubEarly,
      harnessDepth,
      harnessIntent,
      harnessRunId,
      maxSteps: budget.maxSteps,
      maxWebSearches: timeBudget?.maxSearches ?? null,
      abortSignal: req.signal,
      approvalMode,
    });
  } catch (error) {
    console.error("[api/chat]", error);
    const message =
      error instanceof Error ? error.message : "Request failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
