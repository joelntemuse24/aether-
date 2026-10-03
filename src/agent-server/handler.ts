/**
 * VM agent HTTP handler. Plain Node. No Next imports.
 * GET /health is open. Every other route requires the shared bearer.
 * The turn JWT is checked as well: expired, wrong user, or a tool outside
 * the allow-list is rejected. Web tools run in this process. Account tools
 * call back to Vercel with the turn token.
 */

import { randomUUID } from "node:crypto";
import http from "node:http";
import type { UIMessage } from "ai";
import { AGENT_FINAL_ERROR } from "@/lib/agent/loop";
import type { UiChunk } from "@/lib/trueforge/ui-chunks";
import { createAgentEventLog, type AgentEvent } from "@/lib/agent/events";
import { verifyTurnToken, type TurnClaims } from "@/lib/agent/turn-token";
import type { HarnessDepth } from "@/lib/harness/types";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";
import { bearerMatches } from "@/lib/trueforge/auth";

const BODY_LIMIT = 1_500_000;
const TURN_TTL_MS = 10 * 60 * 1000;
const MAX_TURNS = 100;

export type AgentTurnRequest = {
  modelId: string;
  messages: UIMessage[];
  system: string;
  conversationId: string;
  userId: string;
  approvalMode: ToolApprovalMode;
  tools: string[];
  depth: HarnessDepth;
  timeMinutes: number | null;
  timeZone: string | null;
  openRouterKey: string | null;
  turnToken: string;
  callbackOrigin: string | null;
};

export type AgentTurnRunner = (
  body: AgentTurnRequest,
  signal: AbortSignal,
  onChunk?: (chunk: UiChunk) => void,
) => Promise<AgentEvent[]>;

type LiveTurn = {
  controller: AbortController;
  log: ReturnType<typeof createAgentEventLog>;
  done: boolean;
  createdAt: number;
};

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", reject);
  });
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toolList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 64) return null;
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 80) return null;
    names.push(item);
  }
  return names;
}

function depthOf(value: unknown): HarnessDepth {
  if (value === "shallow" || value === "standard" || value === "deep") return value;
  return "standard";
}

function callbackOriginOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const origin = value.trim().replace(/\/+$/, "");
  if (!origin || origin.length > 300) return null;
  return origin;
}

function minutesOf(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function toolsAllowed(requested: readonly string[], allowed: readonly string[]): boolean {
  const permit = new Set(allowed);
  return requested.every((name) => permit.has(name));
}

function claimsMatch(
  claims: TurnClaims,
  body: {
    userId: string;
    conversationId: string;
    tools: string[];
    approvalMode: string;
  },
): boolean {
  return (
    body.userId === claims.sub &&
    body.conversationId === claims.conversationId &&
    body.approvalMode === claims.approvalMode &&
    toolsAllowed(body.tools, claims.tools)
  );
}

export function createAgentServer(options: {
  token: string;
  runTurn: AgentTurnRunner;
  now?: () => number;
}): http.Server {
  const turns = new Map<string, LiveTurn>();
  const now = options.now ?? Date.now;

  function prune() {
    const clock = now();
    for (const [id, turn] of turns) {
      if (clock - turn.createdAt > TURN_TTL_MS) {
        turn.controller.abort();
        turns.delete(id);
      }
    }
    while (turns.size > MAX_TURNS) {
      const oldest = turns.keys().next().value;
      if (!oldest) break;
      turns.get(oldest)?.controller.abort();
      turns.delete(oldest);
    }
  }

  async function handleTurn(req: http.IncomingMessage, res: http.ServerResponse) {
    let raw: unknown;
    try {
      raw = await readBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid request body." });
      return;
    }
    if (!raw || typeof raw !== "object") {
      sendJson(res, 400, { error: "Invalid request body." });
      return;
    }
    const record = raw as Record<string, unknown>;
    const turnToken = stringField(record.turnToken);
    const modelId = stringField(record.modelId);
    const system = stringField(record.system);
    const conversationId = stringField(record.conversationId);
    const userId = stringField(record.userId);
    const approvalMode = record.approvalMode;
    const tools = toolList(record.tools);
    const messages = record.messages;
    if (
      !turnToken ||
      !modelId ||
      system == null ||
      conversationId == null ||
      !userId ||
      (approvalMode !== "ask" && approvalMode !== "auto") ||
      !tools ||
      !Array.isArray(messages)
    ) {
      sendJson(res, 400, { error: "Invalid request body." });
      return;
    }
    const claims = await verifyTurnToken(turnToken, options.token);
    if (!claims) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }
    if (!claimsMatch(claims, { userId, conversationId, tools, approvalMode })) {
      sendJson(res, 403, { error: "Unauthorized." });
      return;
    }

    const turnId = randomUUID();
    const live: LiveTurn = {
      controller: new AbortController(),
      log: createAgentEventLog(),
      done: false,
      createdAt: now(),
    };
    turns.set(turnId, live);
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-aether-turn-id": turnId,
    });
    res.flushHeaders();
    res.on("close", () => {
      if (!live.done) live.controller.abort();
    });

    const openRouterKey = req.headers["x-openrouter-key"];
    const headerKey = Array.isArray(openRouterKey) ? openRouterKey[0] : openRouterKey;
    try {
      let streamed = false;
      const writeChunk = (chunk: UiChunk) => {
        streamed = true;
        if (live.controller.signal.aborted || res.writableEnded) return;
        const stored = live.log.push(chunk);
        res.write(`${JSON.stringify(stored)}\n`);
      };
      const events = await options.runTurn(
        {
          modelId,
          messages: messages as UIMessage[],
          system,
          conversationId,
          userId,
          approvalMode,
          tools,
          depth: depthOf(record.depth),
          timeMinutes: minutesOf(record.timeMinutes),
          timeZone: typeof record.timeZone === "string" ? record.timeZone : null,
          openRouterKey: typeof headerKey === "string" && headerKey.trim() ? headerKey.trim() : null,
          turnToken,
          callbackOrigin: callbackOriginOf(record.callbackOrigin),
        },
        live.controller.signal,
        writeChunk,
      );
      if (!streamed) {
        for (const event of events) {
          if (live.controller.signal.aborted || res.writableEnded) break;
          const stored = live.log.push(event.chunk);
          res.write(`${JSON.stringify(stored)}\n`);
        }
      }
    } catch {
      if (!live.controller.signal.aborted && !res.writableEnded) {
        const stored = live.log.push({
          type: "text-delta",
          id: "agent-final",
          delta: AGENT_FINAL_ERROR,
        });
        res.write(`${JSON.stringify(stored)}\n`);
      }
    } finally {
      live.done = true;
      if (!res.writableEnded) res.end();
    }
  }

  return http.createServer((req, res) => {
    prune();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (!bearerMatches(req.headers.authorization, options.token)) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }
    if (req.method === "POST" && path === "/v1/turns") {
      void handleTurn(req, res);
      return;
    }
    const cancel = path.match(/^\/v1\/turns\/([0-9a-f-]{36})\/cancel$/);
    if (req.method === "POST" && cancel) {
      const live = turns.get(cancel[1]!);
      if (!live) {
        sendJson(res, 404, { error: "Turn not found." });
        return;
      }
      live.controller.abort();
      sendJson(res, 200, { ok: true });
      return;
    }
    const events = path.match(/^\/v1\/turns\/([0-9a-f-]{36})\/events$/);
    if (req.method === "GET" && events) {
      const live = turns.get(events[1]!);
      if (!live) {
        sendJson(res, 404, { error: "Turn not found." });
        return;
      }
      const after = url.searchParams.get("after");
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      });
      for (const event of live.log.since(after)) {
        res.write(`${JSON.stringify(event)}\n`);
      }
      res.end();
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  });
}
