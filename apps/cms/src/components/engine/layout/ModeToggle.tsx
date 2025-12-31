"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

const themes = [
  { id: "system", icon: Monitor, label: "System" },
  { id: "light", icon: Sun, label: "Light" },
  { id: "dark", icon: Moon, label: "Dark" },
]

export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex bg-muted/50 p-1.5 rounded-full h-[46px] w-[130px] items-center justify-between pointer-events-none opacity-50" />
    )
  }

  return (
    <div className="flex bg-muted/40 backdrop-blur-sm p-1.5 rounded-full relative items-center shadow-inner border border-border/50">
      {themes.map((t) => {
        const isActive = theme === t.id
        const Icon = t.icon

        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              "relative flex items-center justify-center h-8 w-10 z-10 transition-colors duration-300 outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-full",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
            )}
            aria-label={`Set ${t.label} theme`}
          >
            {isActive && (
              <motion.div
                layoutId="active-theme-pill"
                className="absolute inset-0 bg-background shadow-sm rounded-full border border-border/40"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 30,
                }}
              />
            )}
            <motion.div
              initial={false}
              animate={{
                scale: isActive ? 1.1 : 1,
                rotate: isActive ? 0 : -10,
              }}
              className="z-20 flex items-center justify-center"
            >
              <Icon className="h-[18px] w-[18px]" />
            </motion.div>
          </button>
        )
      })}
    </div>
  )
}
