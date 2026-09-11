/**
 * Cheap IANA clock — Node/browser Intl, no Python or tzdata package.
 */

export type CurrentTimeResult = {
  ok: boolean;
  timeZone: string;
  iso: string;
  utc: string;
  local: string;
  error?: string;
};

export function resolveCurrentTime(input: {
  timeZone?: string | null;
  now?: Date;
}): CurrentTimeResult {
  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const timeZone = (input.timeZone ?? "UTC").trim() || "UTC";
  try {
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }).format(now);
    return { ok: true, timeZone, iso, utc: iso, local };
  } catch {
    return {
      ok: false,
      timeZone,
      iso,
      utc: iso,
      local: "",
      error: `Unknown timezone: ${timeZone}`,
    };
  }
}
