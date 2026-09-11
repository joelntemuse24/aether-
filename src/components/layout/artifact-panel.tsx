"use client";

import { useEffect, useMemo, useRef, useState, type FC } from "react";
import hljs from "highlight.js";
import { marked } from "marked";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  PencilIcon,
  PlayIcon,
  SaveIcon,
  TableIcon,
  BarChart3Icon,
  BracesIcon,
  EyeIcon,
  HardDriveUploadIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useArtifact } from "@/providers/artifact-provider";
import { useDrive } from "@/providers/drive-provider";
import { saveArtifactToDrive } from "@/lib/google-drive";
import { useTheme } from "@/providers/theme-provider";
import type { ArtifactKind } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { fonts } from "@/lib/tokens";
import { diffText } from "@/lib/artifacts/diff";
import {
  downloadExtension,
  downloadMime,
  isFileArtifactKind,
  isTextArtifactKind,
  normalizeArtifactKind,
  parseCsv,
  previewMode,
} from "@/lib/artifacts/kinds";
import { provenanceLabels } from "@/lib/artifacts/provenance";
import {
  filePreviewMode,
  parseCsvTable,
  textFromArtifactContent,
} from "@/lib/artifacts/table-preview";

const EXT_BY_LANG: Record<string, string> = {
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
  react: "jsx",
  python: "py",
  py: "py",
  html: "html",
  htm: "html",
  css: "css",
  json: "json",
  markdown: "md",
  md: "md",
  svg: "svg",
  sql: "sql",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  rust: "rs",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  ruby: "rb",
  php: "php",
};

const PREVIEWABLE_CODE_LANGS = new Set([
  "html",
  "htm",
  "svg",
  "jsx",
  "tsx",
  "react",
  "javascript",
  "js",
]);

type Tab = "preview" | "code" | "edit" | "table" | "chart" | "json";

function download(filename: string, content: string, mime: string) {
  if (content.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = content;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "artifact"
  );
}

/** Theme tokens mirrored into sandboxed iframe previews. */
type PreviewTheme = {
  canvas: string;
  elevated: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  border: string;
  codeBg: string;
};

const PREVIEW_THEME_FALLBACK: PreviewTheme = {
  canvas: "#faf7f1",
  elevated: "#f4efe6",
  text: "#1a1714",
  textSecondary: "#2e2a24",
  muted: "#6b6458",
  accent: "#d4734f",
  border: "rgba(0,0,0,0.08)",
  codeBg: "#f3eee3",
};

function readPreviewTheme(): PreviewTheme {
  if (typeof document === "undefined") return PREVIEW_THEME_FALLBACK;
  const s = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    canvas: pick("--canvas", PREVIEW_THEME_FALLBACK.canvas),
    elevated: pick("--elevated", PREVIEW_THEME_FALLBACK.elevated),
    text: pick("--text", PREVIEW_THEME_FALLBACK.text),
    textSecondary: pick(
      "--text-secondary",
      PREVIEW_THEME_FALLBACK.textSecondary,
    ),
    muted: pick("--muted", PREVIEW_THEME_FALLBACK.muted),
    accent: pick("--accent", PREVIEW_THEME_FALLBACK.accent),
    border: pick("--border", PREVIEW_THEME_FALLBACK.border),
    codeBg: pick("--code-bg", PREVIEW_THEME_FALLBACK.codeBg),
  };
}

function usePreviewTheme(): PreviewTheme {
  const { theme, accent } = useTheme();
  const [vars, setVars] = useState<PreviewTheme>(PREVIEW_THEME_FALLBACK);
  useEffect(() => {
    setVars(readPreviewTheme());
  }, [theme, accent]);
  return vars;
}

/** Build the HTML document rendered inside the live-preview iframe. */
function buildPreviewDoc(
  kind: ArtifactKind,
  lang: string,
  content: string,
  theme: PreviewTheme,
): string {
  if (kind === "svg" || lang === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:${theme.canvas}}
      svg{max-width:100%;max-height:100%}
    </style></head><body>${content}</body></html>`;
  }

  if (kind === "html" || lang === "html" || lang === "htm") {
    return /<html[\s>]|<body[\s>]/i.test(content)
      ? content
      : `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
  }

  // React / JSX / TSX / JS: transpile in-browser with Babel standalone (CDN).
  const cleaned = content
    // Drop imports (React and friends come from CDN globals).
    .replace(/^\s*import[^\n]*\n/gm, "")
    // Normalize default exports to a global we can render.
    .replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/, "function $1")
    .replace(/export\s+default\s+class\s+([A-Za-z0-9_]+)/, "class $1")
    .replace(/export\s+default\s+/, "window.__default = ")
    .replace(/^\s*export\s+/gm, "");

  return `<!doctype html><html><head><meta charset="utf-8">
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <style>
      body{font-family:${fonts.ui};margin:16px;background:${theme.canvas};color:${theme.text}}
      #root{min-height:40px}
      .aether-err{color:#b00020;white-space:pre-wrap;font-family:${fonts.mono};font-size:12px}
    </style></head><body>
    <div id="root"></div>
    <script type="text/babel" data-presets="react,typescript">
      try {
        ${cleaned}
        const __C =
          (typeof window.__default !== 'undefined' && window.__default) ||
          (typeof App !== 'undefined' && App) ||
          (typeof Component !== 'undefined' && Component) ||
          null;
        const root = ReactDOM.createRoot(document.getElementById('root'));
        if (__C) {
          root.render(React.createElement(__C));
        } else {
          document.getElementById('root').innerHTML =
            '<div class="aether-err">No React component found. Define a component named App (or use export default).</div>';
        }
      } catch (e) {
        document.getElementById('root').innerHTML =
          '<div class="aether-err">' + (e && e.message ? e.message : e) + '</div>';
      }
    </script>
  </body></html>`;
}

/** Document (markdown → HTML) preview styled like Aether chat reading. */
function buildDocumentPreviewDoc(html: string, theme: PreviewTheme): string {
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light dark;
    }
    html, body {
      margin: 0;
      background: ${theme.canvas};
      color: ${theme.text};
    }
    body {
      font-family: "Cormorant Garamond", Georgia, Cambria, "Times New Roman", Times, serif;
      font-size: 18px;
      line-height: 1.72;
      letter-spacing: -0.01em;
      max-width: 46rem;
      margin: 0 auto;
      padding: 28px 32px 48px;
    }
    h1, h2, h3, h4 {
      font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
      font-weight: 500;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: ${theme.text};
      margin: 1.4em 0 0.5em;
    }
    h1 { font-size: 1.65rem; }
    h2 { font-size: 1.3rem; }
    h3 { font-size: 1.1rem; }
    p, li { color: ${theme.textSecondary}; }
    a { color: ${theme.accent}; text-decoration: underline; text-underline-offset: 2px; }
    hr { border: 0; border-top: 1px solid ${theme.border}; margin: 1.5em 0; }
    pre {
      background: ${theme.codeBg};
      border: 1px solid ${theme.border};
      padding: 12px 14px;
      border-radius: 10px;
      overflow: auto;
      font-size: 0.78rem;
      line-height: 1.55;
    }
    code {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.86em;
    }
    :not(pre) > code {
      background: ${theme.codeBg};
      border-radius: 4px;
      padding: 0.1em 0.35em;
    }
    table { border-collapse: collapse; width: 100%; font-family: Inter, system-ui, sans-serif; font-size: 0.85rem; }
    th {
      background: ${theme.elevated};
      text-align: left;
      font-weight: 500;
      color: ${theme.text};
    }
    td, th { border: 1px solid ${theme.border}; padding: 8px 10px; color: ${theme.textSecondary}; }
    blockquote {
      border-left: 3px solid ${theme.accent};
      margin: 1em 0;
      padding: 0.15em 0 0.15em 14px;
      color: ${theme.muted};
    }
    img { max-width: 100%; border-radius: 8px; }
    @media print {
      body { background: #fff; color: #111; max-width: none; }
      a { color: #111; }
    }
  </style></head><body>${html}</body></html>`;
}

const HighlightedCode: FC<{ code: string; language?: string }> = ({
  code,
  language,
}) => {
  const html = useMemo(() => {
    const lang = (language || "").toLowerCase();
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return code.replace(/[&<>]/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
      );
    }
  }, [code, language]);

  return (
    <pre className="h-full overflow-auto bg-[var(--code-bg)] p-4 text-[12.5px] leading-relaxed text-[var(--text)]">
      <code
        className="hljs !bg-transparent font-[family-name:var(--font-mono)]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
};

/* ─── Data helpers ─── */

type ParsedData = {
  value: unknown;
  rows: Record<string, unknown>[] | null;
  columns: string[];
  series: { label: string; value: number }[] | null;
};

function parseData(content: string): ParsedData {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { value: null, rows: null, columns: [], series: null };
  }

  let rows: Record<string, unknown>[] | null = null;
  let columns: string[] = [];
  let series: { label: string; value: number }[] | null = null;

  if (Array.isArray(value) && value.length > 0) {
    if (value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) {
      rows = value as Record<string, unknown>[];
      const cols = new Set<string>();
      for (const r of rows) Object.keys(r).forEach((k) => cols.add(k));
      columns = [...cols];

      // Derive a chart series: label + first numeric column.
      const numericCol = columns.find((c) =>
        rows!.every((r) => typeof r[c] === "number"),
      );
      const labelCol =
        columns.find((c) => rows!.every((r) => typeof r[c] === "string")) ??
        columns[0];
      if (numericCol) {
        series = rows.map((r, i) => ({
          label: String(r[labelCol] ?? i),
          value: Number(r[numericCol]),
        }));
      }
    } else if (value.every((v) => typeof v === "number")) {
      series = (value as number[]).map((v, i) => ({
        label: String(i),
        value: v,
      }));
      rows = (value as number[]).map((v) => ({ value: v }));
      columns = ["value"];
    }
  }

  return { value, rows, columns, series };
}

const DataTable: FC<{ rows: Record<string, unknown>[]; columns: string[] }> = ({
  rows,
  columns,
}) => (
  <div className="h-full overflow-auto p-3">
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c}
              className="sticky top-0 border-b border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-left font-medium text-[var(--text)]"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="odd:bg-[var(--surface)] even:bg-[var(--elevated)]/40">
            {columns.map((c) => (
              <td
                key={c}
                className="border-b border-[var(--border)] px-3 py-1.5 align-top text-[var(--text-secondary)]"
              >
                {typeof r[c] === "object"
                  ? JSON.stringify(r[c])
                  : String(r[c] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const BarChart: FC<{ series: { label: string; value: number }[] }> = ({
  series,
}) => {
  const max = Math.max(...series.map((s) => Math.abs(s.value)), 1);
  const barH = 26;
  const gap = 10;
  const width = 460;
  const labelW = 110;
  const chartW = width - labelW - 60;
  const height = series.length * (barH + gap) + gap;

  return (
    <div className="h-full overflow-auto p-4">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        {series.map((s, i) => {
          const y = gap + i * (barH + gap);
          const w = Math.max((Math.abs(s.value) / max) * chartW, 1);
          return (
            <g key={i}>
              <text
                x={labelW - 8}
                y={y + barH / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="12"
                fill="var(--muted)"
              >
                {s.label.length > 16 ? s.label.slice(0, 15) + "…" : s.label}
              </text>
              <rect
                x={labelW}
                y={y}
                width={w}
                height={barH}
                rx={4}
                fill="var(--accent)"
              />
              <text
                x={labelW + w + 6}
                y={y + barH / 2}
                dominantBaseline="middle"
                fontSize="12"
                fill="var(--text)"
              >
                {s.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ─── Panel ─── */

export function ArtifactPanel() {
  const {
    artifact,
    open,
    closeArtifact,
    persistArtifactContent,
    saveCurrentArtifact,
  } = useArtifact();
  const { connected: driveConnected } = useDrive();
  const previewTheme = usePreviewTheme();
  const [copied, setCopied] = useState(false);
  const [driveSaving, setDriveSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tab, setTab] = useState<Tab>("code");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastPersisted = useRef<string>("");

  const kind: ArtifactKind = normalizeArtifactKind(artifact?.kind, {
    language: artifact?.language,
  });
  const lang = (artifact?.language || "").toLowerCase();
  const mode = previewMode(kind, lang);
  const versions = artifact?.versions ?? [];
  const provenance = artifact?.provenance ?? [];
  const [versionIndex, setVersionIndex] = useState(-1);
  const [showDiff, setShowDiff] = useState(false);

  const tabs = useMemo<Tab[]>(() => {
    if (!artifact) return [];
    if (mode === "image") return [];
    if (isFileArtifactKind(kind)) {
      if (filePreviewMode(artifact.language) !== "table") return [];
      const text = textFromArtifactContent(artifact.code);
      const table = text ? parseCsvTable(text) : null;
      return table?.rows.length ? ["table"] : [];
    }
    if (mode === "live") return ["preview", "code"];
    if (mode === "document") return ["preview", "edit"];
    if (mode === "table") {
      const { rows, series } = parseData(artifact.code);
      const csv = parseCsv(artifact.code) ?? parseCsvTable(artifact.code);
      const t: Tab[] = [];
      if (rows || csv?.rows.length) t.push("table");
      if (series) t.push("chart");
      t.push("json");
      return t;
    }
    return PREVIEWABLE_CODE_LANGS.has(lang) ? ["preview", "code"] : ["code"];
  }, [artifact, kind, lang, mode]);

  // Reset local state when the artifact changes.
  useEffect(() => {
    if (!artifact) return;
    setContent(artifact.code);
    setDebounced(artifact.code);
    lastPersisted.current = artifact.code;
    setCopied(false);
    setSaveState("idle");
    setShowDiff(false);
    setVersionIndex(-1);
    setTab(tabs[0] ?? "code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.id]);

  // Debounce content edits feeding the live preview (auto-refresh).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(content), 400);
    return () => clearTimeout(t);
  }, [content]);

  // Debounced write-back for any open artifact (local always; cloud when linked).
  useEffect(() => {
    if (!artifact?.id) return;
    if (content === lastPersisted.current) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      void (async () => {
        const ok = await persistArtifactContent(content);
        if (ok) {
          lastPersisted.current = content;
          setSaveState("saved");
        } else {
          setSaveState("error");
        }
      })();
    }, 900);
    return () => clearTimeout(t);
  }, [content, artifact?.id, artifact?.persisted, persistArtifactContent]);

  if (!open || !artifact) return null;

  const ext = EXT_BY_LANG[lang] || (kind === "document" ? "md" : "txt");

  const onCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onSaveToDrive = async () => {
    if (!driveConnected || driveSaving || !content) return;
    setDriveSaving(true);
    try {
      const mimeType =
        kind === "document"
          ? "text/markdown"
          : kind === "data"
            ? "application/json"
            : kind === "svg"
              ? "image/svg+xml"
              : "text/plain";
      const file = await saveArtifactToDrive({
        name: artifact.title,
        content,
        mimeType,
      });
      window.dispatchEvent(
        new CustomEvent("aether:notice", {
          detail: `Saved ${file.name} to Google Drive.`,
        }),
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent("aether:notice", {
          detail:
            error instanceof Error
              ? error.message
              : "Could not save this artifact to Google Drive.",
        }),
      );
    } finally {
      setDriveSaving(false);
    }
  };

  const onDownload = () => {
    if (kind === "image" || isFileArtifactKind(kind)) {
      const filename =
        isFileArtifactKind(kind)
          ? artifact.language?.includes(".")
            ? artifact.language
            : `${slugify(artifact.title)}${artifact.language ? `.${artifact.language}` : ""}`
          : `${slugify(artifact.title)}`;
      const href =
        isFileArtifactKind(kind)
          ? artifact.downloadPath ||
            (artifact.persisted && artifact.id
              ? `/api/artifacts/${encodeURIComponent(artifact.id)}/download`
              : content)
          : content;
      if (!href) {
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail: "This file is not available to download. Sign in to keep downloads.",
          }),
        );
        return;
      }
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const filename = `${slugify(artifact.title)}.${downloadExtension(kind, lang) || ext}`;
    download(filename, content, downloadMime(kind, lang));
  };

  const onExportPdf = () => {
    // Prefer the live preview iframe when it's mounted (preview tab).
    const live = iframeRef.current?.contentWindow;
    if (live && tab === "preview") {
      live.focus();
      live.print();
      return;
    }

    // Edit tab (or iframe not ready): print a temporary document.
    // Empty sandbox="" blocks window.print() — do not sandbox this frame.
    const html = buildDocumentPreviewDoc(
      marked.parse(content, { async: false }) as string,
      previewTheme,
    );
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "Print preview");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
      frame.remove();
    };
    win.addEventListener("afterprint", cleanup, { once: true });
    // If afterprint never fires (some browsers), still tear down.
    window.setTimeout(cleanup, 60_000);

    // Wait a tick so styles/fonts can attach before the dialog opens.
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
    }, 50);
  };

  const KindIcon =
    kind === "document" || kind === "markdown"
      ? FileTextIcon
      : kind === "data" || kind === "csv"
        ? BracesIcon
        : kind === "image"
          ? ImageIcon
          : isFileArtifactKind(kind)
            ? FileIcon
            : CodeIcon;

  const tabIcon: Record<Tab, FC<{ className?: string }>> = {
    preview: EyeIcon,
    code: CodeIcon,
    edit: PencilIcon,
    table: TableIcon,
    chart: BarChart3Icon,
    json: BracesIcon,
  };

  const latestVersionIndex = Math.max(0, versions.length - 1);
  const activeVersionIndex = versionIndex >= 0 ? versionIndex : latestVersionIndex;
  const viewingContent =
    versionIndex >= 0 && versions[versionIndex]
      ? versions[versionIndex]!.content
      : content;
  const viewingDebounced =
    versionIndex >= 0 && versions[versionIndex]
      ? versions[versionIndex]!.content
      : debounced;
  const previousVersion =
    versions.length > 1 && activeVersionIndex > 0
      ? versions[activeVersionIndex - 1]
      : undefined;
  const diffLines =
    showDiff && previousVersion
      ? diffText(previousVersion.content, viewingContent)
      : [];

  const documentHtml =
    kind === "document" || kind === "markdown"
      ? (marked.parse(viewingDebounced, { async: false }) as string)
      : "";

  const parsed = kind === "data" || kind === "csv" ? parseData(viewingContent) : null;
  const csvFromKind = kind === "csv" ? parseCsv(viewingContent) : null;
  const csvTable =
    isFileArtifactKind(kind) && filePreviewMode(artifact.language) === "table"
      ? (() => {
          const text = textFromArtifactContent(viewingContent);
          return text ? parseCsvTable(text) : null;
        })()
      : csvFromKind;
  const hasCsvPreview = !!(csvTable && csvTable.rows.length > 0);
  const producedBy = provenanceLabels(provenance);

  return (
    <aside
      className={cn(
        "flex h-full w-full shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]",
        expanded
          ? "fixed inset-0 z-50 max-w-none border-l-0"
          : "max-w-[min(100%,32rem)]",
        "animate-[slideIn_180ms_ease-out] motion-reduce:animate-none",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <KindIcon className="size-4 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--text)]">
              {artifact.title}
            </div>
            {producedBy.length > 0 && (
              <div className="truncate text-[11px] text-[var(--muted-soft)]">
                Produced by {producedBy.join(", ")}
              </div>
            )}
            <div className="text-[11px] lowercase text-[var(--muted-soft)]">
              {kind}
              {kind === "code" && lang ? ` · ${lang}` : ""}
              {isFileArtifactKind(kind) && lang ? ` · ${lang}` : ""}
              {saveState === "saving"
                ? " · saving…"
                : saveState === "saved"
                  ? artifact.persisted
                    ? " · saved"
                    : " · saved locally"
                  : saveState === "error"
                    ? " · save failed"
                    : artifact.persisted
                      ? " · cloud"
                      : artifact.local
                        ? " · this device"
                        : " · draft"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              void saveCurrentArtifact().then((ok) => {
                if (ok) {
                  lastPersisted.current = content;
                  setSaveState("saved");
                } else setSaveState("error");
              });
            }}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-[background-color,transform,color] hover:bg-[var(--elevated)] hover:text-[var(--text)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
            aria-label="Save artifact"
            title="Save artifact"
          >
            <SaveIcon className="size-4" />
          </button>
          {driveConnected && kind !== "file" && (
            <button
              type="button"
              onClick={() => void onSaveToDrive()}
              disabled={driveSaving}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-[background-color,transform,color] hover:bg-[var(--elevated)] hover:text-[var(--text)] active:scale-[0.97] disabled:opacity-50"
              aria-label="Save to Google Drive"
              title="Save to Google Drive"
            >
              <HardDriveUploadIcon className={cn("size-4", driveSaving && "animate-pulse")} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-[background-color,transform,color] hover:bg-[var(--elevated)] hover:text-[var(--text)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
            aria-label={expanded ? "Close expanded artifact" : "Expand artifact"}
            title={expanded ? "Close expanded artifact" : "Expand artifact"}
          >
            {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
          </button>
          {(kind === "document" || kind === "markdown") && (
            <button
              type="button"
              onClick={onExportPdf}
              className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
              title="Export as PDF"
            >
              PDF
            </button>
          )}
          {kind !== "image" && kind !== "file" && (
            <button
              type="button"
              onClick={onCopy}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
              aria-label="Copy"
              title="Copy"
            >
              {copied ? (
                <CheckIcon className="size-4 text-emerald-600" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
            aria-label="Download"
            title={
              kind === "document" || kind === "markdown"
                ? "Download .md"
                : kind === "html"
                  ? "Download source"
                  : kind === "react"
                    ? "Download source"
                    : "Download"
            }
          >
            <DownloadIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={closeArtifact}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)]"
            aria-label="Close panel"
            title="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      {versions.length > 1 && (
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
          <button
            type="button"
            disabled={activeVersionIndex <= 0}
            onClick={() => {
              setShowDiff(false);
              setVersionIndex(Math.max(0, activeVersionIndex - 1));
            }}
            className="flex size-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--elevated)] disabled:opacity-40"
            aria-label="Previous version"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <span className="text-[11px] text-[var(--muted)]">
            v{versions[activeVersionIndex]?.n ?? 1} of {versions.length}
          </span>
          <button
            type="button"
            disabled={activeVersionIndex >= latestVersionIndex}
            onClick={() => {
              setShowDiff(false);
              const next = Math.min(latestVersionIndex, activeVersionIndex + 1);
              setVersionIndex(next === latestVersionIndex ? -1 : next);
            }}
            className="flex size-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--elevated)] disabled:opacity-40"
            aria-label="Next version"
          >
            <ChevronRightIcon className="size-4" />
          </button>
          {isTextArtifactKind(kind) && previousVersion && (
            <button
              type="button"
              onClick={() => setShowDiff((v) => !v)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px]",
                showDiff
                  ? "bg-[var(--elevated)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]",
              )}
            >
              Diff
            </button>
          )}
        </div>
      )}

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-[var(--border)] px-3 py-1.5">
          {tabs.map((t) => {
            const TabIcon = tabIcon[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-[var(--elevated)] text-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]",
                )}
              >
                <TabIcon className="size-3.5" />
                {t}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {showDiff && diffLines.length > 0 && (
          <pre className="h-full overflow-auto bg-[var(--code-bg)] p-3 font-[family-name:var(--font-mono)] text-[12px] leading-relaxed">
            {diffLines.map((line, i) => (
              <div
                key={`${line.type}-${i}`}
                className={
                  line.type === "add"
                    ? "bg-emerald-500/10 text-emerald-800"
                    : line.type === "del"
                      ? "bg-red-500/10 text-red-800"
                      : "text-[var(--text-secondary)]"
                }
              >
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                {line.text}
              </div>
            ))}
          </pre>
        )}
        {/* Image */}
        {kind === "image" && !showDiff && (
          <div className="flex h-full items-center justify-center overflow-auto bg-[var(--elevated)] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={content}
              alt={artifact.title}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
        {isFileArtifactKind(kind) && hasCsvPreview && tab === "table" && csvTable && !showDiff && (
          <div className="flex h-full flex-col">
            <DataTable rows={csvTable.rows} columns={csvTable.columns} />
          </div>
        )}
        {isFileArtifactKind(kind) && !hasCsvPreview && !showDiff && (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--elevated)] px-6 text-center">
            <FileIcon className="size-10 text-[var(--accent)]" />
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                {artifact.title}
              </p>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {artifact.language || "Downloadable file"}
              </p>
            </div>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              <DownloadIcon className="size-3.5" />
              Download
            </button>
          </div>
        )}

        {/* SVG */}
        {kind === "svg" && tab === "preview" && !showDiff && (
          <iframe
            ref={iframeRef}
            title="SVG preview"
            sandbox=""
            srcDoc={buildPreviewDoc("svg", "svg", debounced, previewTheme)}
            className="h-full w-full border-0 bg-[var(--canvas)]"
          />
        )}
        {kind === "svg" && tab === "code" && !showDiff && (
          <HighlightedCode code={viewingContent} language="xml" />
        )}

        {/* Document */}
        {(kind === "document" || kind === "markdown") && tab === "preview" && !showDiff && (
          <iframe
            ref={iframeRef}
            title="Document preview"
            /* allow-modals: required for contentWindow.print() / Save as PDF.
               Empty sandbox="" silently blocks print. No scripts in this doc. */
            sandbox="allow-modals allow-same-origin"
            srcDoc={buildDocumentPreviewDoc(documentHtml, previewTheme)}
            className="h-full w-full border-0 bg-[var(--canvas)]"
          />
        )}
        {(kind === "document" || kind === "markdown") && tab === "edit" && !showDiff && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none border-0 bg-[var(--canvas)] p-4 font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-[var(--text)] outline-none"
          />
        )}

        {/* Data */}
        {(kind === "data" || kind === "csv") && tab === "table" && (parsed?.rows || csvTable?.rows) && !showDiff && (
          <DataTable
            rows={parsed?.rows ?? csvTable?.rows ?? []}
            columns={parsed?.columns ?? csvTable?.columns ?? []}
          />
        )}
        {(kind === "data" || kind === "csv") && tab === "chart" && parsed?.series && !showDiff && (
          <BarChart series={parsed.series} />
        )}
        {(kind === "data" || kind === "csv") && tab === "json" && !showDiff && (
          <HighlightedCode code={viewingContent} language="json" />
        )}

        {/* Code */}
        {(kind === "code" || kind === "html" || kind === "react") &&
          tab === "preview" &&
          !showDiff && (
          <iframe
            ref={iframeRef}
            title="Live preview"
            sandbox="allow-scripts"
            srcDoc={buildPreviewDoc(kind, lang || kind, viewingDebounced, previewTheme)}
            className="h-full w-full border-0 bg-[var(--canvas)]"
          />
        )}
        {(kind === "code" || kind === "html" || kind === "react") &&
          tab === "code" &&
          !showDiff && (
          <div className="flex h-full flex-col">
            <HighlightedCode code={viewingContent} language={lang || kind} />
          </div>
        )}
      </div>

      {/* Editable source for previewable code (auto-refresh) */}
      {(kind === "code" || kind === "html" || kind === "react") &&
        tab === "preview" &&
        !showDiff && (
        <details className="border-t border-[var(--border)]">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-soft)] hover:text-[var(--text)]">
            <PlayIcon className="mr-1 inline size-3" />
            Edit source (live)
          </summary>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-40 w-full resize-none border-0 border-t border-[var(--border)] bg-[var(--canvas)] p-3 font-[family-name:var(--font-mono)] text-[12px] leading-relaxed text-[var(--text)] outline-none"
          />
        </details>
      )}
    </aside>
  );
}
