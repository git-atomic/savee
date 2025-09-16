"use client";
import * as React from "react";

type Theme = "light" | "dark" | "system";

type Ctx = {
  theme: Theme; // selected
  resolvedTheme: "light" | "dark"; // effective
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const EngineThemeContext = React.createContext<Ctx | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Determine initial theme synchronously to reduce FOUC
  const getInitial = React.useCallback<() => Theme>(() => {
    try {
      if (typeof window !== "undefined") {
        const saved =
          (localStorage.getItem("engine-theme") as Theme | null) || undefined;
        if (saved === "dark" || saved === "light" || saved === "system")
          return saved;
        // Respect server-rendered hint if present
        const html = document.documentElement;
        const hinted = html.getAttribute("data-theme");
        if (hinted === "dark") return "dark";
        return "system";
      }
    } catch {}
    return "system";
  }, []);

  const [theme, setThemeState] = React.useState<Theme>(getInitial);
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(
    "light"
  );

  // Compute resolved theme and apply html class
  const applyResolved = React.useCallback((selected: Theme) => {
    try {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      const effective: "light" | "dark" =
        selected === "system" ? (prefersDark ? "dark" : "light") : selected;
      setResolvedTheme(effective);
      const html = document.documentElement;
      if (effective === "dark") html.classList.add("dark");
      else html.classList.remove("dark");
    } catch {}
  }, []);

  React.useEffect(() => {
    applyResolved(theme);
    try {
      localStorage.setItem("engine-theme", theme);
    } catch {}
  }, [theme, applyResolved]);

  // Listen to system theme changes when in system mode
  React.useEffect(() => {
    if (theme !== "system") return;
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyResolved("system");
      mq.addEventListener?.("change", handler);
      // Safari
      mq.addListener?.(handler as any);
      return () => {
        mq.removeEventListener?.("change", handler);
        mq.removeListener?.(handler as any);
      };
    } catch {}
  }, [theme, applyResolved]);

  const value: Ctx = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (t: Theme) => setThemeState(t),
      toggle: () =>
        setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    }),
    [theme, resolvedTheme]
  );

  return (
    <EngineThemeContext.Provider value={value}>
      {/* Do not set class here; we manage html class directly for Tailwind dark variants */}
      <div suppressHydrationWarning>{children}</div>
    </EngineThemeContext.Provider>
  );
}

export function useEngineTheme(): Ctx {
  const ctx = React.useContext(EngineThemeContext);
  if (!ctx) throw new Error("useEngineTheme must be used inside ThemeProvider");
  return ctx;
}
