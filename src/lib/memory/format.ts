import type { MemoryDTO } from "./types";

/** Compact block for system prompt injection (safe for client + server). */
export function formatMemoryForPrompt(records: MemoryDTO[]): string {
  if (records.length === 0) return "";
  const lines = [
    "## What you know about this user (curated memory)",
    "Use when relevant. Do not invent memories. Update via memory_write when the user states lasting preferences.",
  ];
  for (const r of records.slice(0, 10)) {
    lines.push(
      `- [${r.type}] ${r.title}: ${r.body.slice(0, 280)}${r.body.length > 280 ? "…" : ""}`,
    );
  }
  return lines.join("\n");
}
