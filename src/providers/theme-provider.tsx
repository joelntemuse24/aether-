"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** dark = prod parchment; light = Figma Make light; white = near-white. */
export type Theme = "dark" | "light" | "white";

export const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Parchment" },
  { id: "light", label: "Light" },
  { id: "white", label: "White" },
];

/** Accent palette ids. `default` is the current clay/terracotta. */
export type AccentId = "default" | "mono" | "sky" | "burgundy";

export const ACCENTS: {
  id: AccentId;
  label: string;
  /** Swatch color shown in Settings. */
  swatch: string;
}[] = [
  { id: "default", label: "Default", swatch: "#d4734f" },
  { id: "mono", label: "Mono", swatch: "#1a1714" },
  { id: "sky", label: "Sky", swatch: "#2563eb" },
  { id: "burgundy", label: "Burgundy", swatch: "#8b2348" },
];

type ThemeContextValue = {
  theme: Theme;
  accent: AccentId;
  /** All current appearance modes use light paper surfaces. */
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

  const isLightSurface = true;

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
