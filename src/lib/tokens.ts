/**
 * Design tokens for the Aether chat UI.
 * Warm editorial palette — Cormorant Garamond serif, Inter UI.
 * Runtime themes live in globals.css (light parchment default / dark charcoal).
 * Values below match Light (parchment) — the CSS :root default.
 */
export const colors = {
  canvas: "#faf7f1",
  elevated: "#f4efe6",
  elevatedDeep: "#ece6d9",
  surface: "#faf7f1",
  border: "rgba(0, 0, 0, 0.08)",
  borderSubtle: "rgba(0, 0, 0, 0.05)",
  accent: "#d4734f",
  accentHover: "#c26442",
  accentMuted: "rgba(212, 115, 79, 0.10)",
  text: "#1a1714",
  textSecondary: "#2e2a24",
  muted: "#6b6458",
  mutedSoft: "#9a9285",
  danger: "#b42318",
} as const;

export const fonts = {
  reading:
    'var(--font-serif), "Cormorant Garamond", Georgia, Cambria, "Times New Roman", Times, serif',
  sc: 'var(--font-sc), "Cormorant SC", Georgia, serif',
  ui: 'var(--font-ui), "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'var(--font-mono), "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;
