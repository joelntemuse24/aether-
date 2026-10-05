import { TrueForge } from "@truefoundry/trueforge-sdk";
import {
  trueforgeAuthHeaders,
  trueforgeOrigin,
  trueforgeSandboxEnabled,
  trueforgeSidecarEnabled,
  trueforgeSidecarReachable,
  trueforgeToken,
} from "./config";
import { AETHER_EXPERT_MODEL_FQN } from "./providers";

export const AETHER_SCHEDULED_AGENT_NAME = "aether-scheduled";

export type TrueForgeScheduleClient = Pick<TrueForge, "agents" | "schedules">;

export type ScheduledJob = {
  id: string;
  name: string;
  title: string;
  cron: string;
  timezone: string;
  status: string;
  task: string;
  agentName: string;
  createdAt: string;
  updatedAt: string;
};

type ScheduleRecord = {
  id: string;
  name: string;
  agentName: string;
  manifest: { cron: string; task: string; timezone?: string; status?: string };
  createdAt: Date | string;
  updatedAt: Date | string;
};

function client(): TrueForgeScheduleClient {
  const token = trueforgeToken();
  if (trueforgeAuthHeaders().Authorization && token) {
    return new TrueForge({ baseUrl: trueforgeOrigin(), token });
  }
  return new TrueForge({ baseUrl: trueforgeOrigin(), auth: false });
}

export async function trueforgeSchedulesAvailable(): Promise<boolean> {
  if (!trueforgeSidecarEnabled()) return false;
  const remote = Boolean(process.env.AETHER_TRUEFORGE_URL?.trim());
  if (remote && !trueforgeToken()) return false;
  return trueforgeSidecarReachable();
}

export function slugifyScheduleName(title: string): string {
  let value = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!value) value = "scheduled-run";
  if (!/^[a-z]/.test(value)) value = `run-${value}`;
  if (value.length < 2) value = `${value}-run`;
  return value.slice(0, 64).replace(/-+$/g, "") || "scheduled-run";
}

function dateValue(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapTrueForgeSchedule(schedule: ScheduleRecord): ScheduledJob {
  const task = schedule.manifest.task.trim();
  const title = schedule.name
    ? schedule.name
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : task.slice(0, 80) || "Recurring run";
  return {
    id: schedule.id,
    name: schedule.name,
    title,
    cron: schedule.manifest.cron,
    timezone: schedule.manifest.timezone || "UTC",
    status: schedule.manifest.status || "active",
    task: schedule.manifest.task,
    agentName: schedule.agentName,
    createdAt: dateValue(schedule.createdAt),
    updatedAt: dateValue(schedule.updatedAt),
  };
}

export async function ensureScheduledAgent(
  forge: TrueForgeScheduleClient,
  input: { modelName?: string; instructions?: string } = {},
) {
  const agents = await forge.agents.list();
  for await (const agent of agents) {
    if (agent.name === AETHER_SCHEDULED_AGENT_NAME) return agent;
  }
  const created = await forge.agents.create({
    name: AETHER_SCHEDULED_AGENT_NAME,
    description: "Aether recurring runs",
    manifest: {
      model: { name: input.modelName || AETHER_EXPERT_MODEL_FQN },
      instructions:
        input.instructions ||
        "Complete the recurring task carefully and return a concise result for the Aether conversation.",
      config: {
        sandbox: { enabled: false },
        generativeUi: { enabled: false },
      },
    },
  });
  return created.data;
}

export async function listTrueForgeSchedules(forge: TrueForgeScheduleClient = client()) {
  const schedules: ScheduledJob[] = [];
  for await (const schedule of await forge.schedules.list()) {
    schedules.push(mapTrueForgeSchedule(schedule as ScheduleRecord));
  }
  return schedules;
}

export async function createTrueForgeSchedule(
  forge: TrueForgeScheduleClient,
  input: { name: string; title?: string; cron: string; task: string; timezone?: string; status?: "active" | "paused" },
) {
  await ensureScheduledAgent(forge);
  const existingNames = new Set(
    (await listTrueForgeSchedules(forge)).map((schedule) => schedule.name),
  );
  const baseName = slugifyScheduleName(input.title || input.name);
  let name = baseName;
  let suffix = 2;
  while (existingNames.has(name)) {
    const suffixText = `-${suffix}`;
    name = `${baseName.slice(0, 64 - suffixText.length).replace(/-+$/g, "")}${suffixText}`;
    suffix += 1;
  }
  const created = await forge.schedules.create({
    agentName: AETHER_SCHEDULED_AGENT_NAME,
    name,
    manifest: {
      cron: input.cron,
      task: input.task,
      timezone: input.timezone || "UTC",
      status: input.status || "active",
    },
  });
  return mapTrueForgeSchedule(created.data as ScheduleRecord);
}

export async function updateTrueForgeSchedule(
  forge: TrueForgeScheduleClient,
  id: string,
  input: { name: string; cron: string; task: string; timezone: string; status: "active" | "paused" },
) {
  const updated = await forge.schedules.update(id, {
    name: slugifyScheduleName(input.name),
    manifest: {
      cron: input.cron,
      task: input.task,
      timezone: input.timezone || "UTC",
      status: input.status,
    },
  });
  return mapTrueForgeSchedule(updated.data as ScheduleRecord);
}

export async function deleteTrueForgeSchedule(forge: TrueForgeScheduleClient, id: string) {
  return forge.schedules.delete(id);
}

export async function runTrueForgeScheduleNow(forge: TrueForgeScheduleClient, id: string) {
  return forge.schedules.createRun({ scheduleId: id });
}

export { trueforgeSandboxEnabled };
