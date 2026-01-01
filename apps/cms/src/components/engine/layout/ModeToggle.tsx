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
      <div className="flex bg-muted/50 p-0.5 rounded-full relative items-center border border-border/50 h-[38px] w-[116px] opacity-0" />
    )
  }

  return (
    <div className="flex bg-muted/50 p-0.5 rounded-full relative items-center border border-border/50">
      {themes.map((t) => {
        const isActive = theme === t.id
        const Icon = t.icon

        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              "relative flex items-center justify-center h-7 w-9 z-10 transition-colors duration-200 outline-none rounded-full",
              isActive 
                ? "text-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={t.label}
          >
            {isActive && (
              <motion.div
                layoutId="active-theme-bg"
                className="absolute inset-0 bg-background rounded-full border border-border/50"
                transition={{
                  type: "spring",
                  stiffness: 450,
                  damping: 30,
                  mass: 0.8
                }}
              />
            )}
            <Icon className="h-[15px] w-[15px] z-20 relative" strokeWidth={2} />
          </button>
        )
      })}
    </div>
  )
}
