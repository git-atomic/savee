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
          "min-h-screen bg-background font-sans antialiased text-foreground transition-colors duration-300"
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
            <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
              <div className="container flex h-[64px] max-w-screen-2xl items-center justify-between px-8 mx-auto">
                <div className="flex items-center gap-12">
                  <a href="/admin/engine" className="flex items-center hover:opacity-80 transition-opacity">
                    <svg className="w-[95.37px] lg:w-[95.75px] text-foreground" viewBox="0 0 132 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M15.606.04c.253-.053.515-.053.768 0 .286.06.555.214 1.093.52l13.036 7.446c.538.307.807.46 1.003.675q.103.114.186.244l-15.138 5.944c-.201.092-.302.139-.413.156a1 1 0 0 1-.301 0c-.112-.017-.213-.064-.414-.156L.288 8.925q.083-.13.186-.244c.196-.215.465-.368 1.003-.675L14.513.56c.537-.306.807-.46 1.093-.52m-2.939 20.438c.164.127.247.192.311.275a1 1 0 0 1 .138.243c.038.097.049.198.071.4L15.93 35.96a2 2 0 0 1-.323-.038c-.286-.06-.555-.214-1.093-.521L1.477 27.956C.94 27.65.67 27.496.474 27.28a1.8 1.8 0 0 1-.384-.658C0 26.348 0 26.04 0 25.426V10.537c0-.614 0-.922.09-1.197q.054-.165.139-.315zM31.75 9.024q.086.15.14.315c.09.275.09.583.09 1.197v14.89c0 .614 0 .922-.09 1.197a1.8 1.8 0 0 1-.384.657c-.196.215-.465.369-1.003.676l-13.036 7.445c-.538.307-.807.46-1.093.52a2 2 0 0 1-.323.039l2.742-14.564c.022-.202.033-.303.07-.4a1 1 0 0 1 .139-.243c.064-.083.147-.147.311-.275zM131.784 27h-12.275V9.5h12.225v3.1h-8.475v3.975h7.875v3.05h-7.875V23.9h8.525zm-31.22 0V9.5h4.75l4.375 7.65q.725 1.35 1.15 2.3.45.926.925 2.1h.95a26 26 0 0 1-.275-2.7q-.05-1.474-.05-3.6V9.5h3.675V27h-4.725l-4.4-7.675a62 62 0 0 1-1.15-2.225 72 72 0 0 1-.925-2.175h-.95q.2 1.275.25 2.75.075 1.475.075 3.7V27zm-3.45 0h-3.825V9.5h3.825zm-15.703.35q-2.45 0-4.175-1.1-1.7-1.1-2.6-3.1-.875-2-.875-4.675 0-4.375 2.275-6.85t6.45-2.475q2.226 0 4 .775 1.8.75 2.8 2.175 1 1.4.975 3.325h-4.125q-.1-1.65-.95-2.275-.825-.65-2.8-.65-1.75 0-2.65.45t-1.3 1.7q-.375 1.225-.375 3.725t.375 3.725q.4 1.226 1.325 1.65.925.425 2.8.425 1.55 0 2.425-.325.9-.35 1.3-1.15.426-.8.4-2.275h-3.925v-2.9h7.7V27h-2.875l-.2-1.725h-.925q-.7.926-1.975 1.5-1.25.575-3.075.575M55.69 27V9.5h4.75l4.376 7.65q.725 1.35 1.15 2.3.45.926.925 2.1h.95a26 26 0 0 1-.275-2.7q-.05-1.474-.05-3.6V9.5h3.675V27h-4.725l-4.4-7.675a63 63 0 0 1-1.15-2.225 72 72 0 0 1-.925-2.175h-.95q.2 1.275.25 2.75.075 1.475.075 3.7V27zM53 27H40.725V9.5H52.95v3.1h-8.475v3.975h7.875v3.05h-7.875V23.9H53z" fill="currentColor"/>
                    </svg>
                  </a>
                  <nav className="flex items-center gap-10 pt-0.5">
                    <a
                      href="/admin/engine"
                      className="text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Dashboard
                    </a>
                    <a
                      href="/admin/collections"
                      className="text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Collections
                    </a>
                    <a
                      href="/admin/collections/jobs"
                      className="text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Jobs
                    </a>
                    <a
                      href="/admin/globals/settings"
                      className="text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Settings
                    </a>
                  </nav>
                </div>
                <div className="flex items-center gap-6">
                  <div className="h-4 w-px bg-border" />
                  <ModeToggle />
                </div>
              </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 px-8 py-6">{children}</main>

            {/* Footer */}
            <footer className="border-t border-border/40 py-6">
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
