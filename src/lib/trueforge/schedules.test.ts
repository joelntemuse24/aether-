import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AETHER_SCHEDULED_AGENT_NAME,
  createTrueForgeSchedule,
  ensureScheduledAgent,
  mapTrueForgeSchedule,
  slugifyScheduleName,
  trueforgeSchedulesAvailable,
} from "./schedules";

describe("TrueForge schedules", () => {
  it("creates ResourceName-safe schedule names", () => {
    assert.equal(slugifyScheduleName(" Morning Brief: Team / Updates! "), "morning-brief-team-updates");
    assert.equal(slugifyScheduleName("---"), "scheduled-run");
    assert.match(slugifyScheduleName("1 day"), /^[a-z]/);
    assert.ok(slugifyScheduleName("a").length >= 2);
  });

  it("humanizes the schedule title while preserving the ResourceName", () => {
    const mapped = mapTrueForgeSchedule({
      id: "sch_1",
      name: "morning-brief",
      agentName: AETHER_SCHEDULED_AGENT_NAME,
      manifest: { cron: "0 8 * * *", task: "Summarize the inbox", status: "paused" },
      createdAt: "2026-10-05T08:00:00.000Z",
      updatedAt: "2026-10-05T08:01:00.000Z",
    });
    assert.deepEqual(mapped, {
      id: "sch_1",
      name: "morning-brief",
      title: "Morning Brief",
      cron: "0 8 * * *",
      timezone: "UTC",
      status: "paused",
      task: "Summarize the inbox",
      agentName: AETHER_SCHEDULED_AGENT_NAME,
      createdAt: "2026-10-05T08:00:00.000Z",
      updatedAt: "2026-10-05T08:01:00.000Z",
    });
  });

  it("adds a unique suffix when a schedule name already exists", async () => {
    const createdNames = ["morning-brief"];
    const forge = {
      agents: {
        list: async function* () {},
        create: async () => ({ data: { name: AETHER_SCHEDULED_AGENT_NAME } }),
      },
      schedules: {
        list: async function* () {
          for (const name of createdNames) {
            yield {
              id: name,
              name,
              agentName: AETHER_SCHEDULED_AGENT_NAME,
              manifest: { cron: "0 8 * * *", task: "Existing" },
              createdAt: "2026-10-05T08:00:00.000Z",
              updatedAt: "2026-10-05T08:00:00.000Z",
            };
          }
        },
        create: async (input: { name: string }) => {
          createdNames.push(input.name);
          return {
            data: {
              id: "sch_new",
              name: input.name,
              agentName: AETHER_SCHEDULED_AGENT_NAME,
              manifest: { cron: "0 9 * * *", task: "New" },
              createdAt: "2026-10-05T09:00:00.000Z",
              updatedAt: "2026-10-05T09:00:00.000Z",
            },
          };
        },
      },
    } as never;
    const created = await createTrueForgeSchedule(forge, {
      name: "morning-brief",
      cron: "0 9 * * *",
      task: "New",
    });
    assert.equal(created.name, "morning-brief-2");
    assert.equal(created.title, "Morning Brief 2");
    assert.ok(created.name.length <= 64);
  });

  it("creates the named agent once and reuses it", async () => {
    const created: string[] = [];
    const forge = {
      agents: {
        list: async function* () {
          for (const name of created) yield { name };
        },
        create: async (input: { name: string }) => {
          created.push(input.name);
          return { data: { name: input.name } };
        },
      },
      schedules: {} as never,
    } as never;
    await ensureScheduledAgent(forge);
    await ensureScheduledAgent(forge);
    assert.deepEqual(created, [AETHER_SCHEDULED_AGENT_NAME]);
  });

  it("gates availability when the sidecar is disabled", async () => {
    const previous = process.env.AETHER_TRUEFORGE;
    process.env.AETHER_TRUEFORGE = "0";
    try {
      assert.equal(await trueforgeSchedulesAvailable(), false);
    } finally {
      if (previous === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previous;
    }
  });
});
