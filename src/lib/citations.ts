export type SourceCitation = {
  id: string;
  title: string;
  url?: string;
};

/** Structural message-part shape used for citation harvest. */
export type CitationPart = {
  type?: string;
  toolName?: string;
  result?: unknown;
};

export function assignCitationIds<T extends { id?: string }>(
  results: T[],
): Array<T & { id: string }> {
  return results.map((result, index) => ({
    ...result,
    id: result.id?.trim() || String(index + 1),
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toolNameFromPart(part: CitationPart): string {
  if (typeof part.toolName === "string") return part.toolName;
  const type = part.type || "";
  if (type.startsWith("tool-")) return type.slice("tool-".length);
  return "";
}

function pushUnique(
  out: SourceCitation[],
  seen: Set<string>,
  title: string,
  url?: string,
  id?: string,
) {
  const key = (url || title).toLowerCase();
  if (!title || seen.has(key)) return;
  seen.add(key);
  out.push({
    id: id?.trim() || String(out.length + 1),
    title,
    url,
  });
}

/** Unique web_search + fetch_url sources, numbered for inline [n] citations. */
export function collectSourceCitations(
  parts: readonly CitationPart[] | undefined,
): SourceCitation[] {
  const out: SourceCitation[] = [];
  const seen = new Set<string>();
  for (const part of parts ?? []) {
    const name = toolNameFromPart(part);
    const result = asRecord(part.result);
    if (name === "web_search") {
      const results = result.results;
      if (!Array.isArray(results)) continue;
      for (const raw of results) {
        const row = asRecord(raw);
        const title = typeof row.title === "string" ? row.title.trim() : "";
        pushUnique(
          out,
          seen,
          title,
          typeof row.url === "string" ? row.url : undefined,
          typeof row.id === "string" ? row.id : undefined,
        );
      }
    } else if (name === "fetch_url" || name === "browse_page" || name === "browser_snapshot") {
      if (result.ok === false) continue;
      const title =
        (typeof result.title === "string" && result.title.trim()) ||
        (typeof result.url === "string" ? result.url : "");
      pushUnique(
        out,
        seen,
        title,
        typeof result.url === "string" ? result.url : undefined,
        typeof result.id === "string" ? result.id : undefined,
      );
    }
  }
  return out.map((source, index) => ({
    ...source,
    id: source.id || String(index + 1),
  }));
}

const CITATION_RE = /\[(\d+)\]/g;

export type CitationTextNode = { type: "text"; value: string };
export type CitationLinkNode = {
  type: "link";
  url: string;
  children: Array<{ type: "text"; value: string }>;
};
export type CitationSplitNode = CitationTextNode | CitationLinkNode;

export function splitTextWithCitations(
  text: string,
  sources: SourceCitation[],
): CitationSplitNode[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const nodes: CitationSplitNode[] = [];
  let last = 0;
  CITATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_RE.exec(text)) !== null) {
    const source = byId.get(match[1]!);
    if (!source?.url) continue;
    if (match.index > last) {
      nodes.push({ type: "text", value: text.slice(last, match.index) });
    }
    nodes.push({
      type: "link",
      url: source.url,
      children: [{ type: "text", value: match[1]! }],
    });
    last = match.index + match[0].length;
  }
  if (last === 0) return [{ type: "text", value: text }];
  if (last < text.length) {
    nodes.push({ type: "text", value: text.slice(last) });
  }
  return nodes;
}

export function applyInlineCitations(
  markdown: string,
  sources: SourceCitation[],
): string {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return markdown.replace(CITATION_RE, (full, id: string, offset: number) => {
    const before = markdown.slice(Math.max(0, offset - 1), offset);
    const after = markdown.slice(offset + full.length, offset + full.length + 1);
    if (before === "(" || after === "(" || after === "]") return full;
    const source = byId.get(id);
    if (!source?.url) return full;
    return `[${id}](${source.url})`;
  });
}

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
};

function rewriteCitationTree(node: MdastNode, sources: SourceCitation[]) {
  if (!node || typeof node !== "object") return;
  if (node.type === "code" || node.type === "inlineCode" || node.type === "link") {
    return;
  }
  const children = node.children;
  if (!Array.isArray(children) || children.length === 0) return;
  const next: MdastNode[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      const split = splitTextWithCitations(child.value, sources);
      if (split.length === 1 && split[0]?.type === "text") {
        next.push(child);
        continue;
      }
      for (const piece of split) {
        if (piece.type === "text") {
          next.push({ type: "text", value: piece.value });
        } else {
          next.push({
            type: "link",
            url: piece.url,
            children: [{ type: "text", value: piece.children[0]?.value || "" }],
          });
        }
      }
      continue;
    }
    rewriteCitationTree(child, sources);
    next.push(child);
  }
  node.children = next;
}

/** remark plugin: turn [1] into links using this turn's source ids. */
export function remarkInlineCitations(sources: SourceCitation[]) {
  return () => (tree: MdastNode) => {
    if (!sources.length) return;
    rewriteCitationTree(tree, sources);
  };
}
