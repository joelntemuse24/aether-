import { detectFailures } from "./detectors";
import {
  fetchHostedStatus,
  fixtureSnapshot,
  runLiveTurn,
  type ProbeAuth,
} from "./client";
import { expandCases, loadProbePack, selectPrompts } from "./pack";
import { buildReport, toCaseResult, writeReport } from "./report";
import type { ProbeCaseResult, ProbeReport } from "./types";
import type { SpeedTier } from "../../src/lib/hosted/speed-tiers";

export type ProbeCliOptions = {
  smoke?: boolean;
  all?: boolean;
  offline?: boolean;
  live?: boolean;
  baseUrl?: string;
  tiers?: SpeedTier[];
  ids?: string[];
  categories?: string[];
  cookie?: string;
  sessionToken?: string;
  timeoutMs?: number;
};

function parseArgs(argv: string[]): ProbeCliOptions {
  const opts: ProbeCliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--smoke") opts.smoke = true;
    else if (arg === "--all") opts.all = true;
    else if (arg === "--offline") opts.offline = true;
    else if (arg === "--live") opts.live = true;
    else if (arg === "--base-url" && next) {
      opts.baseUrl = next;
      i += 1;
    } else if (arg === "--tier" && next) {
      opts.tiers = next.split(",").map((t) => (t.trim() === "expert" ? "expert" : "fast"));
      i += 1;
    } else if (arg === "--id" && next) {
      opts.ids = next.split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--category" && next) {
      opts.categories = next.split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--timeout-ms" && next) {
      opts.timeoutMs = Number(next);
      i += 1;
    }
  }
  return opts;
}

function resolveBaseUrl(opts: ProbeCliOptions): string | null {
  const raw = opts.baseUrl ?? process.env.AETHER_PROBE_BASE_URL ?? "";
  const trimmed = raw.trim();
  return trimmed || null;
}

function resolveAuth(): ProbeAuth {
  return {
    cookie: process.env.AETHER_PROBE_COOKIE,
    sessionToken:
      process.env.AETHER_PROBE_SESSION_TOKEN ?? process.env.AETHER_PROBE_TOKEN,
  };
}

function resolveTiers(opts: ProbeCliOptions, smoke: boolean): SpeedTier[] {
  if (opts.tiers?.length) return [...new Set(opts.tiers)];
  const env = process.env.AETHER_PROBE_TIERS?.trim();
  if (env) {
    return [
      ...new Set(
        env.split(",").map((t) => (t.trim() === "expert" ? "expert" : "fast" as SpeedTier)),
      ),
    ];
  }
  return smoke ? ["fast"] : ["fast", "expert"];
}

const FIXTURES: Record<
  string,
  { visibleText: string; rawText?: string; finished?: boolean }
> = {
  "blank-survival-hello": { visibleText: "Hello — I am here and ready." },
  "math-final-price": {
    visibleText: "Discounted $102, then 8% tax → $110.16 final price.",
  },
  "time-dublin": {
    visibleText: "It is afternoon in Dublin, Ireland (Europe/Dublin).",
  },
};

export async function runProbe(opts: ProbeCliOptions = {}): Promise<ProbeReport> {
  const smoke = opts.all === true ? false : opts.smoke !== false;
  const pack = loadProbePack();
  const prompts = selectPrompts(pack, {
    smoke,
    ids: opts.ids,
    categories: opts.categories,
  });
  const tiers = resolveTiers(opts, smoke);
  const cases = expandCases(prompts, tiers);
  const baseUrl = resolveBaseUrl(opts);
  const wantLive = opts.live === true || (Boolean(baseUrl) && opts.offline !== true);
  const mode = wantLive ? "live" : "offline-fixtures";

  if (opts.live && !baseUrl) {
    throw new Error("AETHER_PROBE_BASE_URL (or --base-url) is required for --live.");
  }

  let chatTransport: "request" | "durable" | null = null;
  let hostedAvailable: boolean | null = null;
  const auth = resolveAuth();

  if (mode === "live" && baseUrl) {
    const status = await fetchHostedStatus(baseUrl, auth);
    hostedAvailable = status.available;
    chatTransport = status.chatTransport;
    if (!status.available) {
      throw new Error(
        `Hosted chat is unavailable at ${baseUrl}. Check server keys or use --offline.`,
      );
    }
  }

  const results: ProbeCaseResult[] = [];
  for (const { prompt, tier } of cases) {
    if (mode === "offline-fixtures") {
      const fixture = FIXTURES[prompt.id] ?? {
        visibleText: `Fixture placeholder for ${prompt.id}.`,
      };
      const snap = fixtureSnapshot({
        promptId: prompt.id,
        category: prompt.category,
        tier,
        prompt: prompt.prompt,
        visibleText: fixture.visibleText,
        rawText: fixture.rawText ?? fixture.visibleText,
        finished: fixture.finished ?? true,
      });
      results.push(
        toCaseResult({
          id: prompt.id,
          category: prompt.category,
          tier,
          prompt: prompt.prompt,
          findings: detectFailures(snap),
          elapsedMs: snap.elapsedMs,
          timedOut: snap.timedOut,
          httpStatus: snap.httpStatus,
          visibleText: snap.visibleText,
          transport: "fixture",
        }),
      );
      continue;
    }

    const timeoutMs =
      opts.timeoutMs ??
      Number(process.env.AETHER_PROBE_TIMEOUT_MS || "") ||
      prompt.timeoutMs ||
      90_000;
    try {
      const { snap, transport } = await runLiveTurn({
        baseUrl: baseUrl!,
        promptId: prompt.id,
        category: prompt.category,
        prompt: prompt.prompt,
        tier,
        timeoutMs,
        auth,
        preferHeadStart: chatTransport === "durable",
      });
      results.push(
        toCaseResult({
          id: prompt.id,
          category: prompt.category,
          tier,
          prompt: prompt.prompt,
          findings: detectFailures(snap),
          elapsedMs: snap.elapsedMs,
          timedOut: snap.timedOut,
          httpStatus: snap.httpStatus,
          visibleText: snap.visibleText,
          transport,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const snap = fixtureSnapshot({
        promptId: prompt.id,
        category: prompt.category,
        tier,
        prompt: prompt.prompt,
        clientException: message,
        httpStatus: null,
        finished: false,
      });
      results.push(
        toCaseResult({
          id: prompt.id,
          category: prompt.category,
          tier,
          prompt: prompt.prompt,
          findings: detectFailures(snap),
          elapsedMs: snap.elapsedMs,
          timedOut: false,
          httpStatus: null,
          visibleText: "",
          transport: chatTransport === "durable" ? "head-start" : "request",
        }),
      );
    }
  }

  const report = buildReport({
    generatedAt: new Date().toISOString(),
    mode,
    subset: smoke ? "smoke" : "full",
    baseUrl,
    chatTransport,
    hostedAvailable,
    tiers,
    results,
  });
  writeReport(report);
  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runProbe(opts);
  const md = report.failures.length
    ? report.failures
        .map((f) => `- ${f.id} (${f.tier}): ${f.findings.map((x) => x.code).join(", ")}`)
        .join("\n")
    : "No failures.";
  console.log(
    `probe ${report.mode} ${report.subset}: ${report.totals.passed}/${report.totals.runs} passed`,
  );
  console.log(md);
  console.log(`wrote evals/probe/last-report.json and evals/probe/last-report.md`);
  if (report.totals.failed > 0 && report.mode === "live") {
    process.exitCode = 1;
  }
}

const isCli = /[/\\]evals[/\\]probe[/\\]run\.ts$/.test(process.argv[1] ?? "");
if (isCli) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
