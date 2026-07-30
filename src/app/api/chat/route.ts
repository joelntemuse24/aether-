import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { budgetForDepth, harnessSystemAddendum } from "@/lib/harness/budgets";
import { createAgentLoopController } from "@/lib/harness/loop-efficiency";
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
import { auth } from "@/auth";
import { relevantMemoryPrompt } from "@/lib/memory/store";
import {
  formatProjectForPrompt,
  getProject,
} from "@/lib/projects/store";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import { isCloudDbConfigured } from "@/lib/db";

export const maxDuration = 60;
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

export async function POST(req: Request) {
  try {
    const apiKey = getHeader(req, "x-api-key");
    const provider = (getHeader(req, "x-provider") || "openrouter") as ProviderId;
    const baseURL = getHeader(req, "x-base-url");
    const headerModel = getHeader(req, "x-model");

    if (!apiKey) {
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
    const userSystem =
      typeof body.system === "string" && body.system.length <= 8000
        ? body.system
        : undefined;

    const rawHarness = body.harness as HarnessChatContext | undefined;
    const harnessDepth: HarnessDepth =
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
    const budget = budgetForDepth(harnessDepth);
    const harnessAddendum = harnessSystemAddendum({
      depth: harnessDepth,
      intent: harnessIntent,
      clarifications: harnessClarifications,
      planSteps: harnessPlanSteps,
    });

    const session = await auth();
    const userId = session?.user?.id || session?.user?.email || null;
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

    // Stable prefix first (tools + harness), volatile memory/project last —
    // helps provider prompt caches across steps within a turn.
    const system = [
      toolsEnabled ? TOOLS_SYSTEM_PROMPT : null,
      harnessAddendum,
      userSystem,
      memoryForPrompt,
      projectBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
    const modelId = resolveModel(
      provider,
      (typeof body.model === "string" && body.model) || headerModel,
    );

    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as IncomingAttachment[])
      : [];
    const textPrefix =
      typeof body.textPrefix === "string" ? body.textPrefix : undefined;

    if (!modelId) {
      return new Response(
        JSON.stringify({ error: "No model selected. Pick a model from the dropdown." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let model;
    if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else {
      const openai = createOpenAI({
        apiKey,
        baseURL:
          baseURL ||
          (provider === "openrouter"
            ? "https://openrouter.ai/api/v1"
            : provider === "openai"
              ? "https://api.openai.com/v1"
              : baseURL),
        headers:
          provider === "openrouter"
            ? {
                "HTTP-Referer":
                  req.headers.get("origin") ?? "http://localhost:3000",
                "X-Title": "Aether",
              }
            : undefined,
      });
      model = openai.chat(modelId);
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
          status: harnessDepth === "deep" ? "verifying" : "acting",
          eventType: "chat_started",
          eventPayload: {
            depth: harnessDepth,
            intent: harnessIntent,
            maxSteps: budget.maxSteps,
          },
        });
      }
    }

    const hasDrive = userId
      ? !!(await getValidDriveAccessToken(userId))
      : false;

    const availableToolNames = toolsEnabled
      ? resolveAvailableToolNames({ userId, hasDrive })
      : [];
    const loop = toolsEnabled
      ? createAgentLoopController({
          depth: harnessDepth,
          availableToolNames,
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
              loop,
            }),
            activeTools: loop.initialActiveTools,
            toolOrder: loop.toolOrder,
            prepareStep: () => loop.prepareStep(),
            stopWhen: stepCountIs(budget.maxSteps),
          }
        : {}),
      maxOutputTokens: 8192,
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
        if (error instanceof Error) return error.message;
        return "An error occurred while generating a response.";
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
