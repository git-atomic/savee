import React from "react";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ModeToggle } from "@/components/engine/layout/ModeToggle";
import "../../../globals.css";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "ScrapeSavee Engine",
  description: "Engine Dashboard",
};

export default function EngineRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased text-foreground"
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="relative flex min-h-screen flex-col">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="container flex h-14 max-w-screen-2xl items-center px-4">
                <div className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                  >
                    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
                  </svg>
                  <span className="font-semibold text-lg">Engine UI</span>
                </div>
                <nav className="ml-auto flex items-center gap-6 text-sm">
                  <a
                    href="/admin"
                    className="text-muted-foreground transition-colors hover:text-foreground font-medium"
                  >
                    Payload Admin
                  </a>
                  <ModeToggle />
                </nav>
              </div>
            </header>

            {/* Main Content */}
            <main className="flex-1">{children}</main>

            {/* Footer */}
            <footer className="border-t border-border/40 py-6 mt-12">
              <div className="container flex max-w-screen-2xl items-center justify-center px-4 text-sm text-muted-foreground">
                ScrapeSavee Engine Dashboard • Built with shadcn/ui Maia
              </div>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
