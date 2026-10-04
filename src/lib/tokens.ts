/**
 * Design tokens for the Aether chat UI.
 * Display serif is Cormorant Garamond. Assistant prose is Source Serif 4.
 * UI chrome stays Inter. Runtime themes live in globals.css
 * (light parchment default / dark charcoal).
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
  prose:
    'var(--font-prose), "Source Serif 4", Georgia, Cambria, "Times New Roman", Times, serif',
  sc: 'var(--font-sc), "Cormorant SC", Georgia, serif',
  ui: 'var(--font-ui), "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'var(--font-mono), "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

/**
 * Assistant answer prose. Light and dark are separate palettes:
 * dark stays a warm charcoal with cream ink, not a flipped parchment.
 * Contrast is measured against the real canvas and code surfaces.
 */
export const prose = {
  mobileSize: "17px",
  desktopSize: "18px",
  lineHeight: "1.58",
  measure: "66ch",
  strongWeight: 650,
  light: {
    textPrimary: "#14110e",
    codeBg: "#e3dcd0",
    codeBlockBg: "#efe8dc",
    canvas: "#faf7f1",
  },
  dark: {
    textPrimary: "#f3eee3",
    codeBg: "#322d24",
    codeBlockBg: "#241f18",
    canvas: "#17150f",
  },
} as const;
