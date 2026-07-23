/**
 * Design tokens for the Aether chat UI.
 * Tuned to match Claude.ai’s warm cream aesthetic (mid-2026).
 * Tweak values here — components reference CSS variables from globals.css.
 */
export const colors = {
  canvas: "#faf9f5",
  elevated: "#f5f0e8",
  elevatedDeep: "#efe9de",
  surface: "#ffffff",
  border: "#E5E0D6",
  borderSubtle: "rgba(120, 100, 75, 0.12)",
  accent: "#c96442",
  accentHover: "#b5573a",
  accentMuted: "rgba(201, 100, 66, 0.12)",
  text: "#141413",
  textSecondary: "#1a1a18",
  muted: "#6c6a64",
  mutedSoft: "#8e8b82",
  danger: "#b42318",
} as const;

export const fonts = {
  reading:
    'var(--font-serif), ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  ui: 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;
