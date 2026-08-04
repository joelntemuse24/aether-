"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** light = warm parchment; dark = warm brownish charcoal. System preference is ignored. */
export type Theme = "dark" | "light";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Accent palette ids. `default` is the current clay/terracotta. */
export type AccentId = "default" | "mono" | "sky" | "burgundy";

export const ACCENTS: {
  id: AccentId;
  label: string;
  /** Swatch color shown in Settings (dark-theme approx). */
  swatch: string;
}[] = [
  { id: "default", label: "Default", swatch: "#a83232" },
  { id: "mono", label: "Mono", swatch: "#e8e4d9" },
  { id: "sky", label: "Sky", swatch: "#3b82f6" },
  { id: "burgundy", label: "Burgundy", swatch: "#7a1f3d" },
];

type ThemeContextValue = {
  theme: Theme;
  accent: AccentId;
  /** True for warm parchment (not dark charcoal). */
  isLightSurface: boolean;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setAccent: (a: AccentId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = "aether:theme";
const ACCENT_KEY = "aether:accent";
/** Drop White; never follow prefers-color-scheme. */
const THEME_MAP_KEY = "aether:theme-map-v4";

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light";
}

function isAccent(value: string | null): value is AccentId {
  return (
    value === "default" ||
    value === "mono" ||
    value === "sky" ||
    value === "burgundy"
  );
}

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    if (!localStorage.getItem(THEME_MAP_KEY)) {
      const prev = localStorage.getItem(THEME_KEY);
      // Retired "white" → Light. Do not consult prefers-color-scheme.
      if (prev === "white") {
        localStorage.setItem(THEME_KEY, "light");
      }
      localStorage.setItem(THEME_MAP_KEY, "1");
    }
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // ignore
  }
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [accent, setAccentState] = useState<AccentId>("default");

  useEffect(() => {
    setThemeState(readInitialTheme());
    const storedAccent = localStorage.getItem(ACCENT_KEY);
    if (isAccent(storedAccent)) {
      setAccentState(storedAccent);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // :root CSS = parchment Light. Only Dark sets an attribute.
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
    // Belt: never leave a host/legacy class claiming dark paint.
    root.classList.remove("dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === "default") {
      root.removeAttribute("data-accent");
    } else {
      root.setAttribute("data-accent", accent);
    }
    localStorage.setItem(ACCENT_KEY, accent);
  }, [accent]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const setAccent = useCallback((a: AccentId) => setAccentState(a), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  const isLightSurface = theme === "light";

  return (
    <ThemeContext.Provider
      value={{ theme, accent, isLightSurface, toggleTheme, setTheme, setAccent }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
