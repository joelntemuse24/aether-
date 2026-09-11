export type ArtifactProvenance = {
  tool: string;
  at: string;
};

/** Display labels — keep vendor-free and independent of tools.ts. */
const TOOL_LABELS: Record<string, string> = {
  create_artifact: "Artifact",
  create_presentation: "Presentation",
  create_spreadsheet: "Spreadsheet",
  create_document: "Document",
  create_pdf: "PDF",
  workspace_exec: "Workspace",
  workspace_publish_file: "Workspace",
  generate_image: "Image",
};

const MAX_PROVENANCE = 12;

export function mergeProvenance(
  existing: ArtifactProvenance[] | undefined,
  tools: string[],
  now = new Date().toISOString(),
): ArtifactProvenance[] {
  const prev = Array.isArray(existing) ? existing.filter(isProvenance) : [];
  let next = [...prev];
  for (const tool of tools) {
    const name = tool.trim();
    if (!name) continue;
    const last = next[next.length - 1];
    if (last?.tool === name) continue;
    next.push({ tool: name, at: now });
  }
  if (next.length > MAX_PROVENANCE) {
    next = next.slice(next.length - MAX_PROVENANCE);
  }
  return next;
}

function isProvenance(value: unknown): value is ArtifactProvenance {
  if (!value || typeof value !== "object") return false;
  const rec = value as ArtifactProvenance;
  return typeof rec.tool === "string" && typeof rec.at === "string";
}

export function provenanceLabels(rows: ArtifactProvenance[] | undefined): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of rows ?? []) {
    const label =
      TOOL_LABELS[row.tool] ||
      row.tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}
