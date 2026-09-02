import type { FilePart, ImagePart, ModelMessage, TextPart, UIMessage } from "ai";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import {
  budgetForDepthWithTime,
  harnessSystemAddendum,
} from "@/lib/harness/budgets";
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
  type TimeBudget,
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
import { CONTINUE_SYSTEM_ADDENDUM } from "@/lib/chat-continue";
import {
  hermesAetherToolSeamAddendum,
  hermesSafeVerifyAddendum,
} from "@/lib/hermes/tool-seam";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";

export type IncomingAttachment = {
  name: string;
  mime: string;
  dataUrl: string;
};

/** Inject image parts + optional text prefix into the last user message. */
export function enrichMessagesWithAttachments(
  messages: UIMessage[],
  attachments: IncomingAttachment[],
  textPrefix?: string,
): UIMessage[] {
  if ((!attachments || attachments.length === 0) && !textPrefix) {
    return messages;
  }

  const lastUserIdx = [...messages]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find(({ m }) => m.role === "user")?.i;

  if (lastUserIdx === undefined) return messages;

  const original = messages[lastUserIdx];
  const existingParts: UIMessage["parts"] = Array.isArray(original.parts)
    ? [...original.parts]
    : [];

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

function modelTextFromContent(
  content: ModelMessage["content"],
): Array<TextPart | ImagePart | FilePart> {
  const parts: Array<TextPart | ImagePart | FilePart> = [];
  if (typeof content === "string") {
    parts.push({ type: "text", text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;
  for (const part of content) {
    if (part && typeof part === "object" && "type" in part) {
      parts.push(part as TextPart | ImagePart | FilePart);
    }
  }
  return parts;
}

/** Inject image/file parts + optional text prefix into the last user model message. */
export function enrichModelMessagesWithAttachments(
  messages: ModelMessage[],
  attachments: IncomingAttachment[],
  textPrefix?: string,
): ModelMessage[] {
  if ((!attachments || attachments.length === 0) && !textPrefix) {
    return messages;
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return messages;

  const original = messages[lastUserIdx];
  const parts: Array<TextPart | ImagePart | FilePart> = [
    ...modelTextFromContent(original.content),
  ];

  if (textPrefix) {
    const firstTextIdx = parts.findIndex((p) => p.type === "text");
    if (firstTextIdx >= 0) {
      const part = parts[firstTextIdx] as TextPart;
      parts[firstTextIdx] = { type: "text", text: textPrefix + (part.text || "") };
    } else {
      parts.unshift({ type: "text", text: textPrefix });
    }
  }

  for (const att of attachments) {
    if (att.mime.startsWith("image/")) {
      parts.push({
        type: "image",
        image: att.dataUrl,
        mediaType: att.mime,
      });
    } else {
      parts.push({
        type: "file",
        data: att.dataUrl,
        mediaType: att.mime,
        filename: att.name,
      });
    }
  }

  const next = [...messages];
  next[lastUserIdx] = { ...original, content: parts } as ModelMessage;
  return next;
}

/** Last user text from model messages (durable agent run payload). */
export function lastUserTextFromModelMessages(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (!Array.isArray(m.content)) continue;
    const texts = m.content
      .filter((p): p is TextPart => !!p && typeof p === "object" && p.type === "text")
      .map((p) => p.text);
    if (texts.length) return texts.join("\n");
  }
  return "";
}

/** Last user text for memory relevance. */
export function lastUserText(messages: UIMessage[]): string {
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

export function parseHarnessFields(rawHarness: HarnessChatContext | undefined): {
  harnessDepth: HarnessDepth;
  harnessIntent: HarnessIntent;
  harnessClarifications: Record<string, string> | undefined;
  harnessPlanSteps: string[] | undefined;
  harnessRunId: string | undefined;
} {
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
    rawHarness?.clarifications && typeof rawHarness.clarifications === "object"
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
  return {
    harnessDepth,
    harnessIntent,
    harnessClarifications,
    harnessPlanSteps,
    harnessRunId,
  };
}

export type ComposeChatSystemInput = {
  toolsEnabled: boolean;
  hermesLive: boolean;
  userText: string;
  harnessDepth: HarnessDepth;
  harnessIntent: HarnessIntent;
  harnessClarifications?: Record<string, string>;
  harnessPlanSteps?: string[];
  timeBudget: TimeBudget | null;
  continueSegment: boolean;
  userSystem?: string;
  memoryForPrompt?: string;
  projectBlock?: string;
  hasDrive: boolean;
  hasGitHub: boolean;
  hasBrowserless: boolean;
  signedIn: boolean;
  hasMemory: boolean;
  canPersistArtifacts: boolean;
  approvalMode: ToolApprovalMode;
};

export type ComposedChatSystem = {
  system: string;
  harnessDepth: HarnessDepth;
  budget: ReturnType<typeof budgetForDepthWithTime>;
  skillsBlock: string;
  playbooksBlock: string;
};

export function composeChatSystem(input: ComposeChatSystemInput): ComposedChatSystem {
  const harnessDepth = depthUnderTimePressure(input.harnessDepth, input.timeBudget);
  const budget = budgetForDepthWithTime(
    harnessDepth,
    input.timeBudget?.minutes ?? null,
  );
  const harnessAddendum = harnessSystemAddendum({
    depth: harnessDepth,
    intent: input.harnessIntent,
    clarifications: input.harnessClarifications,
    planSteps: input.harnessPlanSteps,
  });
  const skills = resolveSessionSkills({
    hasDrive: input.hasDrive,
    hasGitHub: input.hasGitHub,
    hasBrowserless: input.hasBrowserless,
    signedIn: input.signedIn,
  });
  const skillsBlock = sessionSkillsSystemAddendum(skills);
  const playbooksBlock = input.toolsEnabled
    ? playbooksSystemAddendum(
        resolvePlaybooks({ text: input.userText, intent: input.harnessIntent }),
      )
    : "";
  const verifyBlock = verifySystemAddendum({
    depth: harnessDepth,
    intent: input.harnessIntent,
    timeBudget: input.timeBudget,
  });
  const timeBlock = input.timeBudget
    ? timeBudgetSystemAddendum(input.timeBudget)
    : null;

  const system = [
    input.hermesLive
      ? hermesAetherToolSeamAddendum({
          toolsEnabled: input.toolsEnabled,
          hasDrive: input.hasDrive,
          hasGitHub: input.hasGitHub,
          hasMemory: input.hasMemory,
          canPersistArtifacts: input.canPersistArtifacts,
          approvalMode: input.approvalMode,
        })
      : input.toolsEnabled
        ? TOOLS_SYSTEM_PROMPT
        : null,
    harnessAddendum,
    timeBlock,
    input.hermesLive ? hermesSafeVerifyAddendum(verifyBlock) : verifyBlock,
    input.hermesLive ? null : input.toolsEnabled ? skillsBlock : null,
    playbooksBlock || null,
    input.continueSegment ? CONTINUE_SYSTEM_ADDENDUM : null,
    input.userSystem,
    input.memoryForPrompt,
    input.projectBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, harnessDepth, budget, skillsBlock, playbooksBlock };
}

export function resolveTurnTimeBudget(
  rawHarness: HarnessChatContext | undefined,
  userText: string,
): TimeBudget | null {
  return typeof rawHarness?.timeBudgetMinutes === "number" &&
    rawHarness.timeBudgetMinutes > 0
    ? timeBudgetForMinutes(rawHarness.timeBudgetMinutes)
    : parseTimeBudgetFromText(userText);
}
