import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { parseScheduleWhen } from "@/lib/schedules/cron";
import {
  createTrueForgeSchedule,
  deleteTrueForgeSchedule,
  listTrueForgeSchedules,
  trueforgeSchedulesAvailable,
  updateTrueForgeSchedule,
} from "@/lib/trueforge/schedules";
import { trueforgeClient } from "@/lib/trueforge/sessions";

export const runtime = "nodejs";

const unavailableNote = "Automations need the hosted agent runtime.";

export async function GET() {
  const gate = await requireCloudUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await trueforgeSchedulesAvailable())) {
    return NextResponse.json({ jobs: [], fires: false, backend: "unavailable", note: unavailableNote });
  }
  try {
    return NextResponse.json({
      jobs: await listTrueForgeSchedules(trueforgeClient()),
      fires: true,
      backend: "harness",
    });
  } catch {
    return NextResponse.json({ jobs: [], fires: false, backend: "unavailable", note: unavailableNote });
  }
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await trueforgeSchedulesAvailable())) {
    return NextResponse.json({ error: unavailableNote }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    prompt?: unknown;
    when?: unknown;
    timezone?: unknown;
    status?: unknown;
  };
  const title = typeof body.title === "string" ? body.title.trim() : "Recurring run";
  const task = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const when = typeof body.when === "string" ? body.when : "";
  if (!title || !task) return NextResponse.json({ error: "Add a title and task." }, { status: 400 });
  const parsed = parseScheduleWhen(when);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const job = await createTrueForgeSchedule(trueforgeClient(), {
      name: title,
      title,
      cron: parsed.cron,
      task,
      timezone: typeof body.timezone === "string" ? body.timezone : parsed.timezone || "UTC",
      status: body.status === "paused" ? "paused" : "active",
    });
    return NextResponse.json({ ok: true, job, note: "Saved as a recurring run." });
  } catch {
    return NextResponse.json({ error: "Could not save this recurring run." }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await trueforgeSchedulesAvailable())) return NextResponse.json({ error: unavailableNote }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; status?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const status = body.status === "paused" || body.status === "active" ? body.status : null;
  if (!id || !status) return NextResponse.json({ error: "id and status are required." }, { status: 400 });
  try {
    const schedules = await listTrueForgeSchedules(trueforgeClient());
    const existing = schedules.find((job) => job.id === id);
    if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const job = await updateTrueForgeSchedule(trueforgeClient(), id, { ...existing, name: existing.name, status });
    return NextResponse.json({ ok: true, job });
  } catch {
    return NextResponse.json({ error: "Could not update this recurring run." }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await trueforgeSchedulesAvailable())) return NextResponse.json({ error: unavailableNote }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  try {
    await deleteTrueForgeSchedule(trueforgeClient(), id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not remove this recurring run." }, { status: 503 });
  }
}
