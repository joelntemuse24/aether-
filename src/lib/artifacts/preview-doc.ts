import { fonts } from "@/lib/tokens";
import type { ArtifactKind } from "@/lib/tools";

/** Theme tokens mirrored into sandboxed iframe previews. */
export type PreviewTheme = {
  canvas: string;
  elevated: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  border: string;
  codeBg: string;
};

/** Build the HTML document rendered inside the live-preview iframe. */
export function buildPreviewDoc(
  kind: ArtifactKind,
  lang: string,
  content: string,
  theme: PreviewTheme,
): string {
  if (kind === "svg" || lang === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:${theme.canvas}}
      svg{width:100%;height:auto;max-width:100%;max-height:100%}
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
