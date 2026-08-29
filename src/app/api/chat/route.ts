import type { UIMessage } from "ai";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import {
  budgetForDepthWithTime,
  harnessSystemAddendum,
} from "@/lib/harness/budgets";
import { streamLegacyLocalChat } from "@/lib/harness/legacy-local-stream";
import { updateAgentRunStatus } from "@/lib/harness/runs-store";
import {
  HARNESS_DEPTHS,
  HARNESS_INTENTS,
  type HarnessChatContext,
  type HarnessDepth,
  type HarnessIntent,
} from "@/lib/harness/types";
import {
  depthUnderTimePressure,
  parseTimeBudgetFromText,
  timeBudgetForMinutes,
  timeBudgetSystemAddendum,
} from "@/lib/harness/time-budget";
import { verifySystemAddendum } from "@/lib/harness/verify";
import {
  resolveSessionSkills,
  sessionSkillsSystemAddendum,
} from "@/lib/harness/session-skills";
import {
  playbooksSystemAddendum,
  resolvePlaybooks,
} from "@/lib/harness/playbooks";
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
import { CONTINUE_SYSTEM_ADDENDUM } from "@/lib/chat-continue";
import { shouldProxyChatToHermes } from "@/lib/hermes/config";
import { proxyChatToHermes } from "@/lib/hermes/proxy-chat";
import {
  hermesAetherToolSeamAddendum,
  hermesSafeVerifyAddendum,
} from "@/lib/hermes/tool-seam";
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

/**
 * Only applies on Vercel serverless. Railway / `next start` has no function
 * wall clock — long tool turns finish in one request. Keep Continue for
 * genuine disconnects.
 */
export const maxDuration = 300;
export const runtime = "nodejs";

type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

type IncomingAttachment = {
  name: string;
  mime: string;
  dataUrl: string;
};

function getHeader(req: Request, name: string): string {
  return req.headers.get(name)?.trim() ?? "";
}

/** Inject image parts + optional text prefix into the last user message. */
function enrichMessagesWithAttachments(
  messages: UIMessage[],
  attachments: IncomingAttachment[],
  textPrefix?: string,
): UIMessage[] {
  if ((!attachments || attachments.length === 0) && !textPrefix) {
    return messages;
  }

  // Find the last user message
  const lastUserIdx = [...messages]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find(({ m }) => m.role === "user")?.i;

  if (lastUserIdx === undefined) return messages;

  const original = messages[lastUserIdx];
  const existingParts: UIMessage["parts"] = Array.isArray(original.parts)
    ? [...original.parts]
    : [];

  // Prepend text prefix if present
  if (textPrefix) {
    const firstTextIdx = existingParts.findIndex((p) => p.type === "text");
    if (firstTextIdx >= 0) {
      const part = existingParts[firstTextIdx] as { type: "text"; text: string };
      existingParts[firstTextIdx] = {
        type: "text",
        text: textPrefix + (part.text || ""),
      };
    } else {
      existingParts.unshift({ type: "text", text: textPrefix });
    }
  }

  // Append image parts (data URLs)
  for (const att of attachments) {
    existingParts.push({
      type: "file",
      mediaType: att.mime,
      url: att.dataUrl,
      filename: att.name,
    } as UIMessage["parts"][number]);
  }

  const enriched: UIMessage = {
    ...original,
    parts: existingParts,
  };

  const next = [...messages];
  next[lastUserIdx] = enriched;
  return next;
}

/** Last user text for memory relevance. */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const parts = Array.isArray(m.parts) ? m.parts : [];
    const texts = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text);
    if (texts.length) return texts.join("\n");
  }
  return "";
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
    let harnessDepth: HarnessDepth =
      rawHarness &&
      typeof rawHarness.depth === "string" &&
      (HARNESS_DEPTHS as readonly string[]).includes(rawHarness.depth)
        ? rawHarness.depth
        : "standard";
    const harnessIntent: HarnessIntent =
      rawHarness &&
      typeof rawHarness.intent === "string" &&
      (HARNESS_INTENTS as readonly string[]).includes(rawHarness.intent)
        ? rawHarness.intent
        : "chat";
    const harnessClarifications =
      rawHarness?.clarifications &&
      typeof rawHarness.clarifications === "object"
        ? rawHarness.clarifications
        : undefined;
    const harnessPlanSteps = Array.isArray(rawHarness?.planSteps)
      ? rawHarness.planSteps
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 200))
          .slice(0, 6)
      : undefined;
    const harnessRunId =
      typeof rawHarness?.runId === "string" ? rawHarness.runId : undefined;

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

    // Time budget from harness body or latest user text ("in 5 minutes").
    const userText = lastUserText(messages);
    const timeBudget =
      typeof rawHarness?.timeBudgetMinutes === "number" &&
      rawHarness.timeBudgetMinutes > 0
        ? timeBudgetForMinutes(rawHarness.timeBudgetMinutes)
        : parseTimeBudgetFromText(userText);
    harnessDepth = depthUnderTimePressure(harnessDepth, timeBudget);
    const budget = budgetForDepthWithTime(
      harnessDepth,
      timeBudget?.minutes ?? null,
    );
    const harnessAddendum = harnessSystemAddendum({
      depth: harnessDepth,
      intent: harnessIntent,
      clarifications: harnessClarifications,
      planSteps: harnessPlanSteps,
    });
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
    const skills = resolveSessionSkills({
      hasDrive: hasDriveEarly,
      hasGitHub: hasGitHubEarly,
      hasBrowserless,
      signedIn: !!userId,
    });
    const skillsBlock = sessionSkillsSystemAddendum(skills);
    const playbooksBlock = toolsEnabled
      ? playbooksSystemAddendum(
          resolvePlaybooks({ text: userText, intent: harnessIntent }),
        )
      : "";
    const verifyBlock = verifySystemAddendum({
      depth: harnessDepth,
      intent: harnessIntent,
      timeBudget,
    });
    const timeBlock = timeBudget
      ? timeBudgetSystemAddendum(timeBudget)
      : null;

    const hermesLive = shouldProxyChatToHermes({ hosted });
    // Stable prefix first (tools + harness), volatile memory/project last —
    // helps provider prompt caches across steps within a turn.
    const system = [
      hermesLive
        ? hermesAetherToolSeamAddendum({
            toolsEnabled,
            hasDrive: hasDriveEarly,
            hasGitHub: hasGitHubEarly,
            hasMemory: !!(userId && isCloudDbConfigured()),
            canPersistArtifacts: !!(userId && isCloudDbConfigured()),
            approvalMode,
          })
        : toolsEnabled
          ? TOOLS_SYSTEM_PROMPT
          : null,
      harnessAddendum,
      timeBlock,
      hermesLive ? hermesSafeVerifyAddendum(verifyBlock) : verifyBlock,
      hermesLive ? null : toolsEnabled ? skillsBlock : null,
      playbooksBlock || null,
      continueSegment ? CONTINUE_SYSTEM_ADDENDUM : null,
      userSystem,
      memoryForPrompt,
      projectBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
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
