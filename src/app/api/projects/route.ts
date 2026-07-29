import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { createProject, listProjects } from "@/lib/projects/store";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const projects = await listProjects(gate.userId);
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    instructions?: string;
  };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const project = await createProject(gate.userId, {
    title: body.title.trim(),
    instructions: body.instructions,
  });
  return NextResponse.json({ project });
}
