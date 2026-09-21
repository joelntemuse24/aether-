/**
 * Last-step force-text + grounded fallback when the model ends on tools.
 * Never invent numbers — only quote figures present in tool outputs.
 */

import { sanitizeVisibleAssistantText } from "@/lib/visible-chat-text";

export type ToolEvidence = {
  name: string;
  output: unknown;
};

export type StreamChunk = Record<string, unknown> & {
  type?: string;
  delta?: unknown;
  text?: unknown;
  toolName?: unknown;
  tool?: unknown;
  output?: unknown;
  result?: unknown;
};

export function shouldForceTextStep(input: {
  stepNumber: number;
  maxSteps: number;
}): boolean {
  const max = Number.isFinite(input.maxSteps) ? input.maxSteps : 0;
  if (max <= 1) return true;
  return input.stepNumber >= max - 1;
}

export function hasVisibleAssistantText(text: string | null | undefined): boolean {
  return sanitizeVisibleAssistantText(text ?? "").length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const FIGURE_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{2,}/g;

function figuresIn(text: string): string[] {
  return [...text.matchAll(FIGURE_RE)].map((m) => m[0]);
}

function currentTimeAnswer(output: unknown): string | null {
  const rec = asRecord(output);
  if (rec.ok === false) {
    const err = str(rec.error);
    return err
      ? `I couldn't read that timezone (${err}).`
      : "I couldn't read that timezone.";
  }
  const local = str(rec.local).trim();
  const timeZone = str(rec.timeZone).trim();
  if (!local) return null;
  return timeZone ? `It's ${local} (${timeZone}).` : `It's ${local}.`;
}

type CitedSnippet = {
  id: string;
  title: string;
  url?: string;
  text: string;
  figures: string[];
};

function collectCitedSnippets(tools: ToolEvidence[]): CitedSnippet[] {
  const out: CitedSnippet[] = [];
  for (const tool of tools) {
    const rec = asRecord(tool.output);
    if (tool.name === "web_search" && Array.isArray(rec.results)) {
      for (const raw of rec.results) {
        const row = asRecord(raw);
        const snippet = str(row.snippet).trim();
        const title = str(row.title).trim() || "Source";
        const id = str(row.id).trim() || String(out.length + 1);
        if (!snippet && !title) continue;
        out.push({
          id,
          title,
          url: str(row.url) || undefined,
          text: snippet,
          figures: figuresIn(snippet),
        });
      }
    }
    if (
      (tool.name === "browse_page" || tool.name === "fetch_url") &&
      rec.ok !== false
    ) {
      const title = str(rec.title).trim() || str(rec.url).trim() || "Page";
      const body = [str(rec.focused), str(rec.text), ...(Array.isArray(rec.excerpts) ? rec.excerpts.map(str) : [])]
        .filter(Boolean)
        .join("\n");
      const id = str(rec.id).trim() || String(out.length + 1);
      out.push({
        id,
        title,
        url: str(rec.url) || undefined,
        text: body.slice(0, 800),
        figures: figuresIn(body),
      });
    }
  }
  return out;
}

function looksLikeOfficeHospitality(userText: string): boolean {
  const lower = userText.toLowerCase();
  return /\boffice\b/.test(lower) && /\bhospitality\b/.test(lower);
}

export function synthesizeFallbackAnswer(input: {
  userText?: string;
  tools: ToolEvidence[];
}): string {
  const tools = input.tools ?? [];
  const clock = tools.find((t) => t.name === "current_time");
  if (clock) {
    const spoken = currentTimeAnswer(clock.output);
    if (spoken) return spoken;
  }

  const snippets = collectCitedSnippets(tools);
  const withFigures = snippets.filter((s) => s.figures.length > 0);
  const userText = input.userText ?? "";

  if (withFigures.length > 0) {
    const lines: string[] = [];
    if (looksLikeOfficeHospitality(userText)) {
      lines.push(
        "Caveat: “office” is not an official CSO employment category, so these are published sector counts used as a proxy — not a clean office-vs-hospitality headcount.",
      );
    } else {
      lines.push(
        "Grounded estimate from the sources I retrieved (not invented):",
      );
    }
    for (const hit of withFigures) {
      const figureList = hit.figures.slice(0, 4).join(", ");
      lines.push(`- ${hit.text || figureList} [${hit.id}]`);
    }
    return lines.join("\n");
  }

  if (snippets.length > 0) {
    const cites = snippets
      .slice(0, 4)
      .map((s) => `- ${s.title} [${s.id}]`)
      .join("\n");
    return `The search results didn’t include a usable numeric estimate, so I will not invent a headcount.\n\nClosest sources:\n${cites}`;
  }

  if (tools.length > 0) {
    const names = [...new Set(tools.map((t) => t.name))].join(", ");
    return `I ran ${names} but didn’t get enough to finish a numeric answer. I won’t invent one.`;
  }

  return "I don’t have a grounded figure for that yet.";
}

export function collectToolEvidenceFromChunks(
  chunks: Iterable<StreamChunk> | StreamChunk[],
): ToolEvidence[] {
  const tools: ToolEvidence[] = [];
  for (const chunk of chunks) {
    const evidence = toolEvidenceFromChunk(chunk);
    if (evidence) tools.push(evidence);
  }
  return tools;
}

function toolEvidenceFromChunk(chunk: StreamChunk): ToolEvidence | null {
  const type = str(chunk.type);
  if (type !== "tool-output-available" && type !== "tool-result") return null;
  const name = str(chunk.toolName) || str(chunk.tool);
  if (!name) return null;
  const output = chunk.output ?? chunk.result;
  return { name, output };
}

function chunkVisibleText(chunk: StreamChunk): string {
  const type = str(chunk.type);
  if (type !== "text-delta" && type !== "text") return "";
  return str(chunk.delta) || str(chunk.text);
}

export async function* injectFallbackAnswerChunks(
  chunks: AsyncIterable<StreamChunk> | Iterable<StreamChunk>,
  input: { userText?: string },
): AsyncGenerator<StreamChunk> {
  const tools: ToolEvidence[] = [];
  let hasText = false;
  const pendingFinish: StreamChunk[] = [];

  for await (const chunk of chunks as AsyncIterable<StreamChunk>) {
    const evidence = toolEvidenceFromChunk(chunk);
    if (evidence) tools.push(evidence);
    if (hasVisibleAssistantText(chunkVisibleText(chunk))) hasText = true;
    if (str(chunk.type) === "finish") {
      pendingFinish.push(chunk);
      continue;
    }
    yield chunk;
  }

  if (!hasText) {
    const text = synthesizeFallbackAnswer({
      userText: input.userText,
      tools,
    }).trim();
    if (text) {
      const id = "fallback-answer";
      yield { type: "text-start", id };
      yield { type: "text-delta", id, delta: text, text };
      yield { type: "text-end", id };
    }
  }

  for (const finish of pendingFinish) yield finish;
}

type StreamTextLike = {
  toUIMessageStream?: (...args: unknown[]) => unknown;
  toUIMessageStreamResponse?: (...args: unknown[]) => unknown;
};

function isReadableStream(value: unknown): value is ReadableStream {
  return (
    typeof ReadableStream !== "undefined" &&
    value instanceof ReadableStream
  );
}

async function* iterateUnknownStream(
  stream: unknown,
): AsyncGenerator<StreamChunk> {
  if (!stream) return;
  if (isReadableStream(stream)) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && typeof value === "object") yield value as StreamChunk;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (typeof (stream as AsyncIterable<StreamChunk>)[Symbol.asyncIterator] === "function") {
    for await (const chunk of stream as AsyncIterable<StreamChunk>) {
      yield chunk;
    }
  }
}

/** Trigger head-start calls `.tee()` on this stream — generators are not enough. */
function readableFromAsyncIterable(
  iterable: AsyncIterable<StreamChunk>,
): ReadableStream<StreamChunk> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<StreamChunk>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      void iterator.return?.(reason);
    },
  });
}

/**
 * Patch a streamText result so Trigger auto-pipe and the /api/chat
 * UIMessage response both get a last-resort answer after empty tool turns.
 */
export function wrapStreamTextWithFallbackAnswer<T>(
  result: T,
  input: { userText?: string },
): T {
  const streamResult = result as T & StreamTextLike;
  const orig = streamResult.toUIMessageStream;
  if (typeof orig !== "function") return result;

  streamResult.toUIMessageStream = (...args: unknown[]) => {
    const inner = orig.apply(streamResult, args);
    return readableFromAsyncIterable(
      injectFallbackAnswerChunks(iterateUnknownStream(inner), input),
    );
  };

  return result;
}
