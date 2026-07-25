import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import {
  TOOL_NAMES,
  TOOLS_SYSTEM_PROMPT,
  createArtifactInput,
  executePythonInput,
  webSearchInput,
  type CreateArtifactOutput,
  type WebSearchOutput,
  type WebSearchResult,
} from "@/lib/tools";

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

const SEARCH_TIMEOUT_MS = 10_000;

/** Keyless web search: DuckDuckGo Instant Answer with a Wikipedia fallback. */
async function runWebSearch(query: string): Promise<WebSearchOutput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  // Some public APIs (e.g. Wikipedia) reject server requests lacking a UA.
  const fetchInit: RequestInit = {
    signal: controller.signal,
    headers: {
      "User-Agent": "AetherChat/1.0 (+https://github.com/; contact: dev)",
      Accept: "application/json",
    },
  };
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(
      query,
    )}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgUrl, fetchInit);
    if (ddgRes.ok) {
      const data = (await ddgRes.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const results: WebSearchResult[] = [];
      if (data.AbstractText) {
        results.push({
          title: data.Heading || query,
          snippet: data.AbstractText,
          url: data.AbstractURL || undefined,
        });
      }
      for (const topic of data.RelatedTopics ?? []) {
        if (topic.Text) {
          results.push({
            title: topic.Text.split(" - ")[0] || topic.Text,
            snippet: topic.Text,
            url: topic.FirstURL,
          });
        }
        if (results.length >= 6) break;
      }
      if (results.length > 0) {
        clearTimeout(timer);
        return { ok: true, query, source: "duckduckgo", results };
      }
    }

    // Fallback: Wikipedia search API.
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&format=json&srlimit=5&origin=*`;
    const wikiRes = await fetch(wikiUrl, fetchInit);
    if (wikiRes.ok) {
      const wiki = (await wikiRes.json()) as {
        query?: { search?: Array<{ title: string; snippet: string }> };
      };
      const results: WebSearchResult[] = (wiki.query?.search ?? []).map((r) => ({
        title: r.title,
        snippet: r.snippet.replace(/<[^>]+>/g, ""),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
          r.title.replace(/ /g, "_"),
        )}`,
      }));
      clearTimeout(timer);
      return { ok: true, query, source: "wikipedia", results };
    }

    clearTimeout(timer);
    return { ok: false, query, results: [], error: "No search results found." };
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Search timed out."
        : err instanceof Error
          ? err.message
          : "Search failed.";
    return { ok: false, query, results: [], error: message };
  }
}

/** Build the tool set offered to the model. */
function buildTools(): ToolSet {
  return {
    // Client-executed (no `execute`): run in the browser via Pyodide.
    [TOOL_NAMES.executePython]: tool({
      description:
        "Execute Python code in a sandboxed in-browser Pyodide runtime and return stdout and the final expression value. Use for math, data processing, or verifying code.",
      inputSchema: executePythonInput,
    }),
    // Server-executed: keyless web search.
    [TOOL_NAMES.webSearch]: tool({
      description:
        "Search the web for current or factual information and return a list of result snippets.",
      inputSchema: webSearchInput,
      execute: async ({ query }): Promise<WebSearchOutput> =>
        runWebSearch(query),
    }),
    // Server-executed acknowledgement: the artifact body travels in the tool
    // call input, which the client renders in the artifact panel.
    [TOOL_NAMES.createArtifact]: tool({
      description:
        "Create a rich artifact (code, document, data, image, or svg) shown in the side panel for the user to view, edit, preview, or export. Use for substantial, reusable content.",
      inputSchema: createArtifactInput,
      execute: async ({ kind, title }): Promise<CreateArtifactOutput> => ({
        ok: true,
        kind,
        title,
      }),
    }),
  };
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
    const system = toolsEnabled
      ? [TOOLS_SYSTEM_PROMPT, userSystem].filter(Boolean).join("\n\n")
      : userSystem;
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

    const result = streamText({
      model,
      messages: await convertToModelMessages(enrichedMessages),
      ...(system ? { system } : {}),
      ...(toolsEnabled
        ? { tools: buildTools(), stopWhen: stepCountIs(5) }
        : {}),
      maxOutputTokens: 8192,
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[api/chat]", error);
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
