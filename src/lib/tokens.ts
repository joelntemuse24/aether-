/**
 * Design tokens for the Aether chat UI.
 * Warm editorial dark palette — Cormorant Garamond serif, Inter UI, dark canvas.
 * Tweak values here — components reference CSS variables from globals.css.
 */
export const colors = {
  canvas: "#17150f",
  elevated: "#252219",
  elevatedDeep: "#2d2a20",
  surface: "#1e1c15",
  border: "rgba(255, 245, 220, 0.08)",
  borderSubtle: "rgba(255, 245, 220, 0.05)",
  accent: "#a83232",
  accentHover: "#be3838",
  accentMuted: "rgba(168, 50, 50, 0.10)",
  text: "#ede9de",
  textSecondary: "#d4d0c5",
  muted: "#9a9588",
  mutedSoft: "#635e52",
  danger: "#d4183d",
} as const;

export const fonts = {
  reading:
    'var(--font-serif), "Cormorant Garamond", Georgia, Cambria, "Times New Roman", Times, serif',
  sc: 'var(--font-sc), "Cormorant SC", Georgia, serif',
  ui: 'var(--font-ui), "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'var(--font-mono), "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;
