import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProbeCaseResult, ProbeReport } from "./types";

const PACK_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPORT_JSON = join(PACK_DIR, "last-report.json");
export const DEFAULT_REPORT_MD = join(PACK_DIR, "last-report.md");

export function excerptOf(text: string, max = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

export function buildReport(input: Omit<ProbeReport, "totals" | "failures">): ProbeReport {
  const failures = input.results.filter((r) => !r.passed);
  return {
    ...input,
    totals: {
      runs: input.results.length,
      passed: input.results.length - failures.length,
      failed: failures.length,
    },
    failures,
  };
}

export function renderMarkdown(report: ProbeReport): string {
  const lines = [
    `# Aether probe report`,
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode} (${report.subset})`,
    `- Base URL: ${report.baseUrl ?? "—"}`,
    `- Transport: ${report.chatTransport ?? "—"}`,
    `- Hosted available: ${report.hostedAvailable ?? "—"}`,
    `- Tiers: ${report.tiers.join(", ")}`,
    `- Score: ${report.totals.passed}/${report.totals.runs} passed`,
    ``,
  ];

  if (report.failures.length === 0) {
    lines.push(`No failures.`);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`## Failures`);
  lines.push(``);
  for (const fail of report.failures) {
    lines.push(`### ${fail.id} (${fail.tier})`);
    lines.push(``);
    lines.push(`- Category: ${fail.category}`);
    lines.push(`- Surface: ${fail.surface}`);
    lines.push(`- Transport: ${fail.transport}`);
    lines.push(`- Elapsed: ${fail.elapsedMs}ms${fail.timedOut ? " (timed out)" : ""}`);
    for (const finding of fail.findings) {
      lines.push(`- \`${finding.code}\`: ${finding.detail}`);
    }
    if (fail.screenshot) lines.push(`- Screenshot: \`${fail.screenshot}\``);
    if (fail.excerpt) lines.push(`- Excerpt: ${fail.excerpt}`);
    lines.push(``);
  }
  return `${lines.join("\n")}\n`;
}

export function writeReport(
  report: ProbeReport,
  jsonPath: string = DEFAULT_REPORT_JSON,
  mdPath: string = DEFAULT_REPORT_MD,
): { jsonPath: string; mdPath: string } {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
}

export function toCaseResult(
  result: Omit<ProbeCaseResult, "passed" | "excerpt" | "surface"> & {
    excerpt?: string;
    visibleText?: string;
    surface?: ProbeCaseResult["surface"];
  },
): ProbeCaseResult {
  const { visibleText, excerpt, ...rest } = result;
  return {
    ...rest,
    surface: rest.surface ?? "api",
    passed: rest.findings.length === 0,
    excerpt: excerpt ?? excerptOf(visibleText ?? ""),
    screenshot: rest.screenshot ?? null,
  };
}
