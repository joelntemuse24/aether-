"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** dark = default charcoal; light = warm parchment; white = brighter near-white canvas. */
export type Theme = "dark" | "light" | "white";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Parchment" },
  { id: "white", label: "White" },
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
  /** True for warm parchment or bright white (not dark). */
  isLightSurface: boolean;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  setAccent: (a: AccentId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = "aether:theme";
const ACCENT_KEY = "aether:accent";

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "white";
}

function isAccent(value: string | null): value is AccentId {
  return (
    value === "default" ||
    value === "mono" ||
    value === "sky" ||
    value === "burgundy"
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [accent, setAccentState] = useState<AccentId>("default");

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (isTheme(storedTheme)) {
      setThemeState(storedTheme);
    }
    const storedAccent = localStorage.getItem(ACCENT_KEY);
    if (isAccent(storedAccent)) {
      setAccentState(storedAccent);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
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
    () =>
      setThemeState((prev) => {
        if (prev === "dark") return "light";
        if (prev === "light") return "white";
        return "dark";
      }),
    [],
  );

  const isLightSurface = theme === "light" || theme === "white";

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
