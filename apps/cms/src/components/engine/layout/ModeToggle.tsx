"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

const themes = [
  { id: "system", icon: Monitor, label: "System theme" },
  { id: "light", icon: Sun, label: "Light theme" },
  { id: "dark", icon: Moon, label: "Dark theme" },
]

export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="rounded-full bg-muted/50 relative flex p-0.25 text-center" />
    )
  }

  return (
    <div className="rounded-full bg-muted/50 relative flex p-0.25 text-center items-center border border-border/10">
      {themes.map((t) => {
        const isActive = theme === t.id
        const Icon = t.icon

        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              "relative inline-flex cursor-pointer items-center justify-center rounded-full leading-none transition-colors duration-200 z-10 outline-none px-3 py-2",
              isActive 
                ? "text-foreground" 
                : "text-muted-foreground hover:text-foreground/80"
            )}
            aria-label={t.label}
          >
            {isActive && (
              <motion.div
                layoutId="active-theme-pill"
                className="absolute inset-0 rounded-full bg-background border border-border"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 30,
                  mass: 0.8
                }}
              />
            )}
            <Icon className="h-[15px] w-[15px] z-20 relative" strokeWidth={2.5} />
          </button>
        )
      })}
    </div>
  )
}
