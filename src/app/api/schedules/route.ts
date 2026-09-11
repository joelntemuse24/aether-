import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { parseScheduleWhen } from "@/lib/schedules/cron";
import { registerScheduledJob } from "@/lib/schedules/register";
import { getScheduleStore } from "@/lib/schedules/store";
import { createTriggerSchedule, deleteTriggerSchedule } from "@/lib/schedules/trigger-register";
import { isTriggerChatConfigured } from "@/lib/trigger/config";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const jobs = await getScheduleStore().list(gate.userId);
  return NextResponse.json({
    jobs,
    fires: isTriggerChatConfigured(),
  });
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    prompt?: unknown;
    when?: unknown;
    delivery?: unknown;
    timezone?: unknown;
    conversationId?: unknown;
  };
  const title = typeof body.title === "string" ? body.title : "Morning brief";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const when = typeof body.when === "string" ? body.when : "every morning";
  const parsed = parseScheduleWhen(when);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const created = await registerScheduledJob(
    {
      userId: gate.userId,
      title,
      prompt,
      when,
      delivery: body.delivery === "email" ? "email" : "inbox",
      timezone: typeof body.timezone === "string" ? body.timezone : "UTC",
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : null,
    },
    { createTriggerSchedule },
  );
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }
  return NextResponse.json(created);
}

export async function DELETE(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const store = getScheduleStore();
  const existing = await store.get(gate.userId, id);
  const cancelled = await store.cancel(gate.userId, id);
  if (!cancelled) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await deleteTriggerSchedule(existing?.triggerScheduleId);
  return NextResponse.json({ ok: true, job: cancelled });
}
