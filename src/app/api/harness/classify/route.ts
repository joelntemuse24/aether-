import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { classifyMessage } from "@/lib/harness/classify";
import { createAgentRun } from "@/lib/harness/runs-store";
import type { HarnessClassification } from "@/lib/harness/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

function getHeader(req: Request, name: string): string {
  return req.headers.get(name)?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const accessMode =
      (getHeader(req, "x-access-mode") as "hosted" | "byok") || "byok";
    const apiKey = getHeader(req, "x-api-key");
    const provider = (getHeader(req, "x-provider") || "openrouter") as ProviderId;
    const baseURL = getHeader(req, "x-base-url");
    const modelId = getHeader(req, "x-model");
    const hosted = accessMode === "hosted";

    if (!hosted && !apiKey) {
      return NextResponse.json(
        { error: "Missing API key." },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      message?: string;
      conversationId?: string;
    };
    const message = typeof body.message === "string" ? body.message : "";
    if (!message.trim()) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    const classification: HarnessClassification = await classifyMessage({
      message,
      accessMode: hosted ? "hosted" : "byok",
      apiKey,
      provider,
      baseURL: baseURL || undefined,
      modelId,
      origin: req.headers.get("origin"),
    });

    const runId = crypto.randomUUID();
    const session = await auth();
    const userId = session?.user?.id || session?.user?.email;
    if (userId) {
      await createAgentRun({
        id: runId,
        userId,
        conversationId: body.conversationId ?? null,
        classification,
        status: classification.needsClarify ? "clarifying" : "acting",
      });
    }

    return NextResponse.json({
      runId,
      classification,
    });
  } catch (err) {
    console.error("[api/harness/classify]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Classify failed" },
      { status: 500 },
    );
  }
}
