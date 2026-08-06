import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  InvalidToolInputError,
  NoSuchToolError,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { repairToolCallInputJson } from "@/lib/repair-tool-json";
import {
  budgetForDepthWithTime,
  harnessSystemAddendum,
} from "@/lib/harness/budgets";
import {
  collectMessageText,
  collectSeedUnlockedToolNames,
  createAgentLoopController,
  webSearchBudgetForDepth,
} from "@/lib/harness/loop-efficiency";
import { updateAgentRunStatus } from "@/lib/harness/runs-store";
import {
  buildToolRegistry,
  resolveAvailableToolNames,
} from "@/lib/harness/tool-registry";
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
import { auth } from "@/auth";
import { relevantMemoryPrompt } from "@/lib/memory/store";
import {
  formatProjectForPrompt,
  getProject,
} from "@/lib/projects/store";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import { getValidGitHubAccessToken } from "@/lib/github-session";
import { messageMentionsGitHubRepo } from "@/lib/connectors/github";
import { isCloudDbConfigured } from "@/lib/db";
import { listHostedCandidates } from "@/lib/hosted/client";
import { isHostedConfigured } from "@/lib/hosted/config";
import { createFailoverLanguageModel } from "@/lib/hosted/failover";
import { friendlyChatError } from "@/lib/chat-errors";
import { CONTINUE_SYSTEM_ADDENDUM } from "@/lib/chat-continue";

/**
 * Vercel enforces a plan-specific function wall clock.
 * Pro allows up to 300s — use the full budget.
 * Longer Opus / tool / artifact turns rely on client auto-continue across segments.
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

function resolveModel(provider: ProviderId, model: string): string {
  if (provider === "anthropic") {
    return model.replace(/^anthropic\//, "");
  }
  if (provider === "openai") {
    return model.replace(/^openai\//, "");
  }
  return model;
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

function buildByokModel(input: {
  provider: ProviderId;
  apiKey: string;
  baseURL: string;
  modelId: string;
  origin?: string | null;
}): LanguageModel {
  if (input.provider === "anthropic") {
    return createAnthropic({ apiKey: input.apiKey })(input.modelId);
  }
  const openai = createOpenAI({
    apiKey: input.apiKey,
    baseURL:
      input.baseURL ||
      (input.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : input.provider === "openai"
          ? "https://api.openai.com/v1"
          : input.baseURL),
    headers:
      input.provider === "openrouter"
        ? {
            "HTTP-Referer": input.origin ?? "http://localhost:3000",
            "X-Title": "Aether",
          }
        : undefined,
  });
  return openai.chat(input.modelId);
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
      if (!isHostedConfigured()) {
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

    const messages = body.messages as UIMessage[];
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages provided." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
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

    const session = await auth();
    const userId = session?.user?.id || session?.user?.email || null;

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
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId : null;

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
    const verifyBlock = verifySystemAddendum({
      depth: harnessDepth,
      intent: harnessIntent,
      timeBudget,
    });
    const timeBlock = timeBudget
      ? timeBudgetSystemAddendum(timeBudget)
      : null;

    // Stable prefix first (tools + harness), volatile memory/project last —
    // helps provider prompt caches across steps within a turn.
    const system = [
      toolsEnabled ? TOOLS_SYSTEM_PROMPT : null,
      harnessAddendum,
      timeBlock,
      verifyBlock,
      toolsEnabled ? skillsBlock : null,
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

    let model: LanguageModel;
    if (hosted) {
      const candidates = listHostedCandidates(
        requestedModel,
        req.headers.get("origin"),
      );
      if (candidates.length === 0) {
        return new Response(
          JSON.stringify({
            error:
              "That model is not available on Aether Cloud right now. Pick another model or use Bring your own key.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
      // BUZZ → optional relays → OpenRouter (see resolveHostedRoute).
      model = createFailoverLanguageModel(candidates);
    } else {
      const modelId = resolveModel(provider, requestedModel);
      model = buildByokModel({
        provider,
        apiKey,
        baseURL,
        modelId,
        origin: req.headers.get("origin"),
      });
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
          },
        });
      }
    }

    const hasDrive = hasDriveEarly;
    const hasGitHub = hasGitHubEarly;

    const availableToolNames = toolsEnabled
      ? resolveAvailableToolNames({ userId, hasDrive, hasGitHub })
      : [];
    // Seed deferred tools from the whole thread — not just the last user
    // message. Continue segments use CONTINUE_USER_TEXT, which would otherwise
    // drop previously unlocked GitHub tools and cause AI_NoSuchToolError.
    const threadText = toolsEnabled ? collectMessageText(messages) : "";
    const seedUnlocked = toolsEnabled
      ? collectSeedUnlockedToolNames({
          messages,
          availableToolNames,
          mentionsGitHubRepo:
            hasGitHub && messageMentionsGitHubRepo(threadText),
          // Soft-seed memory/Drive/GitHub from conversation text so discovery
          // is not solely dependent on a successful tool_search step.
          intentText: threadText,
        })
      : [];
    // Research/write intents need extra search headroom beyond pure depth caps
    // (models otherwise burn 1–2 guesses on wrong outlets and stop).
    const intentSearchCap =
      harnessIntent === "research" || harnessIntent === "study"
        ? Math.max(5, webSearchBudgetForDepth(harnessDepth))
        : harnessIntent === "write"
          ? Math.max(4, webSearchBudgetForDepth(harnessDepth))
          : null;
    const loop = toolsEnabled
      ? createAgentLoopController({
          depth: harnessDepth,
          availableToolNames,
          seedUnlocked: seedUnlocked.length ? seedUnlocked : undefined,
          maxWebSearches:
            timeBudget?.maxSearches ?? intentSearchCap ?? null,
        })
      : null;

    const result = streamText({
      model,
      messages: await convertToModelMessages(enrichedMessages),
      ...(system ? { system } : {}),
      ...(toolsEnabled && loop
        ? {
            tools: buildToolRegistry({
              userId,
              conversationId,
              projectId: projectId ?? null,
              hasDrive,
              hasGitHub,
              loop,
            }),
            activeTools: loop.initialActiveTools,
            toolOrder: loop.toolOrder,
            prepareStep: () => loop.prepareStep(),
            stopWhen: stepCountIs(budget.maxSteps),
            // Models (esp. Claude) sometimes concatenate two JSON objects in
            // one tool_use input when they meant parallel calls. Take the first.
            repairToolCall: async ({ toolCall, error }) => {
              if (NoSuchToolError.isInstance(error)) return null;
              if (!InvalidToolInputError.isInstance(error)) return null;
              const repaired = repairToolCallInputJson(toolCall.input);
              if (!repaired) return null;
              console.info("[chat] repaired tool input JSON", {
                tool: toolCall.toolName,
                before: toolCall.input.slice(0, 160),
                after: repaired.slice(0, 160),
              });
              return { ...toolCall, input: repaired };
            },
          }
        : {}),
      maxOutputTokens: 8192,
      // Failover model walks upstreams itself — don't burn 3 retries on one 429.
      maxRetries: hosted ? 0 : 2,
      abortSignal: req.signal,
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
            },
          });
        }
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[api/chat]", error);
        if (harnessRunId && userId) {
          void updateAgentRunStatus({
            id: harnessRunId,
            userId,
            status: "done",
            eventType: "chat_error",
            eventPayload: {
              error: error instanceof Error ? error.message : "error",
            },
          });
        }
        return friendlyChatError(error);
      },
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
