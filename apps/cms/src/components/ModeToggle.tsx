"use client";
import { Button } from "@/components/ui/button";
import { useEngineTheme } from "@/components/ThemeProvider";
import * as React from "react";
import { Computer, Moon, Sun } from "lucide-react";

export function ModeToggle() {
  const { theme, resolvedTheme, setTheme } = useEngineTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const is = (t: "system" | "light" | "dark") => theme === t;
  const btn = (
    t: "system" | "light" | "dark",
    icon: React.ReactNode,
    label: string
  ) => (
    <button
      onClick={() => setTheme(t)}
      className={
        is(t)
          ? "inline-flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground"
          : "inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-muted-foreground hover:text-foreground"
      }
      aria-pressed={is(t)}
      title={label}
    >
      {icon}
    </button>
  );

  return (
    <div className="inline-flex items-center gap-1 rounded-2xl border bg-background/60 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/40">
      {btn("system", <Computer className="h-4 w-4" />, "System")}
      {btn("light", <Sun className="h-4 w-4" />, "Light")}
      {btn("dark", <Moon className="h-4 w-4" />, "Dark")}
    </div>
  );
}
