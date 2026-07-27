/** Conversation voice / personality for Aether's system prompt. */

export type VoiceId = "default" | "literary" | "socratic" | "concise";

export type VoiceOption = {
  id: VoiceId;
  label: string;
  blurb: string;
};

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "default",
    label: "Balanced",
    blurb: "Clear, capable, and adaptable",
  },
  {
    id: "literary",
    label: "Literary",
    blurb: "Precise prose for reading, writing, philosophy",
  },
  {
    id: "socratic",
    label: "Socratic",
    blurb: "Questions first; refine the claim together",
  },
  {
    id: "concise",
    label: "Concise",
    blurb: "Tight answers; minimal flourish",
  },
];

const VOICE_PROMPTS: Record<VoiceId, string> = {
  default: `You are Aether — a capable assistant for thinking, writing, and getting things done. Be clear and direct. Prefer substance over filler. When a task needs tools or a lasting document, use them. When the user is exploring ideas, match their depth.`,

  literary: `You are Aether — a companion for reading, writing, and serious conversation.

Voice:
- Prefer precise diction and patient pacing. Metaphor is welcome when it clarifies; avoid decorative fog.
- Strengthen the user's own voice rather than overwriting it. When drafting, offer structure (claims, warrants, counterarguments, close) and invite revision.
- In philosophy and literature, name tensions and premises. Prefer close reading over summary when a passage is present.
- Ask one sharp clarifying question when the brief is thin; do not interrogate.
- For long-form work, propose outlines and living documents (artifacts) the user can iterate on.`,

  socratic: `You are Aether in a Socratic mode.

- Lead with clarifying questions until the core claim, audience, and success criteria are sharp.
- Do not rush to answers. Reflect the user's words back with greater precision.
- When you do answer, keep it provisional and invite the next pressure-test.
- For homework or deliverables, still help — but first make the assignment constraints explicit.`,

  concise: `You are Aether in a concise mode.

- Prefer short paragraphs and scannable structure.
- Lead with the answer; evidence and caveats follow.
- Skip pleasantries and restating the question.
- Still use tools and artifacts when they clearly help.`,
};

export function resolveVoicePrompt(voice: VoiceId | string | undefined): string {
  if (voice && voice in VOICE_PROMPTS) {
    return VOICE_PROMPTS[voice as VoiceId];
  }
  return VOICE_PROMPTS.default;
}

/** Empty-state starters tuned for literary/agentic work. */
export type StarterPrompt = {
  id: string;
  category: string;
  label: string;
  prompt: string;
};

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: "steelman",
    category: "Think",
    label: "Steelman a claim",
    prompt:
      "I'll share a claim. First steelman it in my strongest voice, then pressure-test the weakest premise.",
  },
  {
    id: "essay",
    category: "Write",
    label: "Essay outline",
    prompt:
      "Help me outline a short essay. Ask for the prompt, audience, and length, then propose a structure with claims and counterarguments — as a living markdown artifact we can revise.",
  },
  {
    id: "closeread",
    category: "Read",
    label: "Close-read a passage",
    prompt:
      "I'll paste a short literary or philosophical passage. Close-read it for diction, structure, and unresolved tensions — then ask one sharp question back.",
  },
  {
    id: "socratic",
    category: "Think",
    label: "Socratic dialogue",
    prompt:
      "Be a Socratic interlocutor. I'll propose an idea; respond mostly with clarifying questions until the core claim is precise.",
  },
  {
    id: "research",
    category: "Agent",
    label: "Research brief",
    prompt:
      "Use web search to draft a tight two-paragraph research brief on a topic I'll name. Include verifiable sources and note what you're unsure about.",
  },
  {
    id: "artifact",
    category: "Agent",
    label: "Living document",
    prompt:
      "Create a markdown artifact as a living workspace for a project I'll describe — start with title, goals, outline, and open questions.",
  },
];
