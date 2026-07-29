import type { HarnessClassification, HarnessDepth, HarnessIntent } from "./types";
import { classificationSchema } from "./types";

/** Keyword/heuristic fallback when the model classifier is unavailable. */
export function heuristicClassify(message: string): HarnessClassification {
  const text = message.trim();
  const lower = text.toLowerCase();
  const len = text.length;

  let intent: HarnessIntent = "chat";
  if (
    /\b(research|brief|sources?|cite|look up|latest|news)\b/.test(lower)
  ) {
    intent = "research";
  } else if (
    /\b(essay|draft|rewrite|outline|poem|story|blog|write)\b/.test(lower)
  ) {
    intent = "write";
  } else if (
    /\b(buy|purchase|order|book|schedule|submit|email|remind|todo)\b/.test(
      lower,
    )
  ) {
    intent = "life_admin";
  } else if (
    /\b(explain|verse|passage|homework|assignment|study|theology|philosophy|close.?read)\b/.test(
      lower,
    )
  ) {
    intent = "study";
  } else if (
    /\b(code|bug|function|typescript|python|refactor|implement)\b/.test(lower)
  ) {
    intent = "code";
  }

  let depth: HarnessDepth = "standard";
  if (
    len < 40 &&
    /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)\b/.test(lower)
  ) {
    depth = "shallow";
  } else if (
    intent === "research" ||
    intent === "study" ||
    intent === "write" ||
    /\b(deep|thorough|detailed|comprehensive|go deep|extra mile)\b/.test(lower)
  ) {
    depth = "deep";
  } else if (len < 80) {
    depth = "shallow";
  }

  const ambiguousWrite =
    intent === "write" &&
    !/\b(email|essay|outline|poem|tweet|linkedin|blog)\b/.test(lower);
  const ambiguousLife =
    intent === "life_admin" &&
    !/\b(draft|plan|checklist|how to)\b/.test(lower);
  const thinBrief = len < 120 && (intent === "research" || intent === "study");

  const needsClarify = ambiguousWrite || ambiguousLife || thinBrief;
  const questions: HarnessClassification["questions"] = [];

  if (ambiguousWrite) {
    questions.push({
      id: "form",
      prompt: "What form should this take?",
      options: [
        { id: "outline", label: "Outline first" },
        { id: "full_draft", label: "Full draft" },
        { id: "edit", label: "Edit what I paste next" },
      ],
    });
  }
  if (ambiguousLife) {
    questions.push({
      id: "action",
      prompt: "How should I help with this?",
      options: [
        { id: "plan", label: "Make a plan" },
        { id: "draft", label: "Draft the message / steps" },
        { id: "checklist", label: "Checklist only" },
      ],
    });
  }
  if (thinBrief && intent === "study") {
    questions.push({
      id: "angle",
      prompt: "What angle do you want?",
      options: [
        { id: "exegesis", label: "Close reading / meaning" },
        { id: "application", label: "Application to life" },
        { id: "context", label: "Historical / literary context" },
      ],
    });
  }
  if (thinBrief && intent === "research") {
    questions.push({
      id: "scope",
      prompt: "How deep should the research go?",
      options: [
        { id: "snapshot", label: "Quick snapshot" },
        { id: "brief", label: "Structured brief with sources" },
        { id: "deep", label: "Deep dive" },
      ],
    });
  }

  const planSteps =
    depth === "deep"
      ? intent === "research"
        ? ["Search for current sources", "Synthesize with citations", "Flag uncertainties"]
        : intent === "study"
          ? ["Attend to the text", "Name tensions / ambiguities", "Offer one implication"]
          : ["Clarify goal", "Produce substantive draft", "Verify gaps before finishing"]
      : undefined;

  return classificationSchema.parse({
    intent,
    depth: needsClarify && depth === "shallow" ? "standard" : depth,
    needsClarify: needsClarify && questions.length > 0,
    questions: needsClarify ? questions.slice(0, 3) : [],
    planSteps,
    rationale: "heuristic",
  });
}
