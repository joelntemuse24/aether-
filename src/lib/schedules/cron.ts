export type ParsedScheduleWhen =
  | { ok: true; cron: string; label: string; timezone?: string }
  | { ok: false; error: string };

const CRON_RE =
  /^([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9*,/-]+)\s+([0-9A-Za-z*,/-]+)$/;

function validFiveFieldCron(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return CRON_RE.test(parts.join(" "));
}

export function parseScheduleWhen(raw: string): ParsedScheduleWhen {
  const text = raw.trim().toLowerCase();
  if (!text) return { ok: false, error: "Say when this should run." };

  if (text === "every morning" || text === "each morning" || text === "daily morning") {
    return { ok: true, cron: "0 8 * * *", label: "Every morning" };
  }
  if (
    text === "every weekday morning" ||
    text === "weekday mornings" ||
    text === "weekdays at 8"
  ) {
    return { ok: true, cron: "0 8 * * 1-5", label: "Weekday mornings" };
  }
  if (text === "every evening" || text === "each evening") {
    return { ok: true, cron: "0 18 * * *", label: "Every evening" };
  }
  if (text === "every night" || text === "nightly") {
    return { ok: true, cron: "0 21 * * *", label: "Every night" };
  }

  const asCron = raw.trim();
  if (validFiveFieldCron(asCron)) {
    return { ok: true, cron: asCron, label: asCron };
  }
  return {
    ok: false,
    error:
      "Use “every morning”, “every weekday morning”, “every evening”, or a 5-field cron.",
  };
}
