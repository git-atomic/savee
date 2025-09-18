"use client";

import * as React from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ModeToggle } from "@/components/ModeToggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, Pencil, Trash2, Check, X, Clock } from "lucide-react";
import { useEnginePortalContainer } from "@/lib/engine-portal";

type SourceType = "home" | "pop" | "user";

type JobData = {
  id: string;
  runId?: string;
  url: string;
  sourceType: SourceType;
  username?: string;
  maxItems: number;
  status: "active" | "running" | "paused" | "error" | "completed";
  runStatus?: string;
  counters: {
    found: number;
    uploaded: number;
    errors: number;
    skipped?: number;
  };
  lastRun?: string;
  nextRun?: string;
  intervalSeconds?: number;
  disableBackoff?: boolean;
  effectiveIntervalSeconds?: number;
  backoffMultiplier?: number;
};

type EngineMetrics = {
  queued: number;
  running: number;
  paused: number;
  workerParallelism: number;
  active?: number;
};

type LogEntry = {
  timestamp: string;
  type: "STARTING" | "FETCH" | "SCRAPE" | "COMPLETE" | "WRITE/UPLOAD" | "ERROR";
  url: string;
  status: "success" | "error" | "pending" | string;
  timing?: string;
  message?: string;
};

type EngineLimits = {
  success: boolean;
  r2: { totalObjects: number; totalSizeBytes: number; usagePercent: number; softLimitGb: number; nearLimit: boolean };
  db: { blocks: number; sources: number; runs: number; softLimitBlocks: number; nearLimit: boolean };
};

export default function EngineUI() {
  const [metrics, setMetrics] = React.useState<EngineMetrics | null>(null);
  const [jobs, setJobs] = React.useState<JobData[]>([]);
  const [query, setQuery] = React.useState("");
  const [limits, setLimits] = React.useState<EngineLimits | null>(null);
  const [forceStart, setForceStart] = React.useState(false);
  type StatusKey = "active" | "running" | "paused" | "stopped" | "error" | "completed";
  const STATUS_OPTIONS: { key: StatusKey; label: string; dot: string }[] = [
    { key: "running", label: "Running", dot: "bg-emerald-500" },
    { key: "active", label: "Active", dot: "bg-blue-500" },
    { key: "paused", label: "Paused", dot: "bg-zinc-500" },
    { key: "stopped", label: "Stopped", dot: "bg-purple-500" },
    { key: "error", label: "Error", dot: "bg-red-500" },
    { key: "completed", label: "Completed", dot: "bg-sky-500" },
  ];
  const [selectedStatuses, setSelectedStatuses] = React.useState<
    Record<StatusKey, boolean>
  >({
    running: true,
    active: true,
    paused: true,
    stopped: true,
    error: true,
    completed: true,
  });

  // Add Jobs state
  const [url, setUrl] = React.useState("");
  const [sourceType, setSourceType] = React.useState<SourceType>("home");
  const [maxItems, setMaxItems] = React.useState<number | "">("");
  const [submitting, setSubmitting] = React.useState(false);

  // Tabs state with hydration-safe mounting guard
  const [activeTab, setActiveTab] = React.useState<"add" | "all">("add");
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
    const resolveFromPath = () => {
      if (typeof window === "undefined") return;
      const p = window.location.pathname;
      setActiveTab(p.endsWith("/engine/jobs") ? "all" : "add");
    };
    resolveFromPath();
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", resolveFromPath);
      return () => window.removeEventListener("popstate", resolveFromPath);
    }
  }, []);

  // Infer source type (home | pop | user) from URL-like input
  const inferSourceTypeFromUrl = React.useCallback(
    (input: string): SourceType => {
      const raw = (input || "").trim();
      if (raw.length === 0) return "home";
      const lower = raw.toLowerCase();
      try {
        let u: URL;
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
          u = new URL(lower);
        } else if (lower.startsWith("/")) {
          // relative path like /pop or /username
          u = new URL(lower, "https://savee.it");
        } else if (/[a-z0-9.-]+\.[a-z]{2,}/.test(lower)) {
          // looks like a domain (e.g. savee.com, savee.it/pop)
          u = new URL(`https://${lower}`);
        } else {
          // treat as path or username (e.g. pop, username)
          u = new URL(`https://savee.it/${lower}`);
        }
        const path = (u.pathname || "/").replace(/\/+$/, "");
        if (path === "" || path === "/") return "home";
        const first = path.split("/").filter(Boolean)[0] || "";
        if (first === "pop" || first === "popular") return "pop";
        return "user";
      } catch {
        // Fallback to simple heuristics if URL parsing failed
        if (lower === "pop" || lower === "/pop" || lower.includes("/pop"))
          return "pop";
        if (
          lower === "popular" ||
          lower === "/popular" ||
          lower.includes("/popular")
        )
          return "pop";
        if (
          lower === "/" ||
          lower === "" ||
          lower === "savee.com" ||
          lower === "savee.it"
        )
          return "home";
        return "user";
      }
    },
    []
  );

  // Auto-detect source type whenever URL changes
  React.useEffect(() => {
    if (!url) return;
    const inferred = inferSourceTypeFromUrl(url);
    if (inferred !== sourceType) setSourceType(inferred);
  }, [url, inferSourceTypeFromUrl]);

  // Data fetchers (reuse EngineView endpoints)
  const fetchMetrics = React.useCallback(async () => {
    try {
      const r = await fetch("/api/engine/metrics", { cache: "no-store" });
      if (r.ok) setMetrics(await r.json());
    } catch {}
  }, []);

  const fetchLimits = React.useCallback(async () => {
    try {
      const r = await fetch("/api/engine/limits", { cache: "no-store" });
      if (r.ok) setLimits(await r.json());
    } catch {}
  }, []);

  const fetchJobs = React.useCallback(async () => {
    try {
      const r = await fetch("/api/engine/jobs");
      if (r.ok) {
        const data = await r.json();
        setJobs(data.jobs || []);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    fetchMetrics();
    fetchLimits();
    fetchJobs();
    const t = setInterval(() => {
      fetchMetrics();
      fetchLimits();
      fetchJobs();
    }, 1500);
    return () => clearInterval(t);
  }, [fetchMetrics, fetchLimits, fetchJobs]);

  // Compute active sources locally for the "Active" stat (metrics API does not return it)
  const activeCount = React.useMemo(
    () => jobs.filter((j) => j.status === "active").length,
    [jobs]
  );

  // Live fallbacks derived from jobs when metrics may be unavailable or stale
  const runningCount = React.useMemo(
    () =>
      jobs.filter((j) => j.status === "running" || j.runStatus === "running")
        .length,
    [jobs]
  );
  const pausedCount = React.useMemo(
    () => jobs.filter((j) => j.status === "paused").length,
    [jobs]
  );
  const errorJobsCount = React.useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status === "error" ||
          j.runStatus === "error" ||
          (j.counters?.errors || 0) > 0
      ).length,
    [jobs]
  );

  const startJob: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/engine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          maxItems: maxItems || undefined,
          sourceType,
        }),
      });
      if (r.ok) {
        setUrl("");
        setMaxItems("");
        setSourceType("home");
        fetchJobs();
        // Auto-switch to All Jobs and sync URL so controls are visible immediately
        try {
          const next = "/admin/engine/jobs";
          if (
            typeof window !== "undefined" &&
            window.location.pathname !== next
          ) {
            window.history.pushState({}, "", next);
          }
          setActiveTab("all");
        } catch {}
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stat = (color: string, label: string, value?: number) => (
    <div className="flex items-center gap-3 rounded-[11px] border bg-card p-3 shadow-sm">
      <span className={cn("inline-block h-3.5 w-3.5 rounded-full", color)} />
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="ml-auto inline-flex items-center rounded-[11px] border px-2 py-0.5 text-xs font-semibold">
        {value ?? 0}
      </span>
    </div>
  );

  return (
    <ThemeProvider>
      <div className="engine-view min-h-screen bg-background text-foreground">
        {/* Top nav header */}
        <div className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 rounded bg-primary" />
              <span className="text-lg font-semibold">Engine</span>
            </div>
            <ModeToggle />
          </div>
        </div>

        <div className="mx-auto max-w-7xl p-6 space-y-6">
          {/* Capacity banner */}
          {limits && (limits.r2?.nearLimit || limits.db?.nearLimit) && (
            <div className="rounded-[12px] border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <b>Near capacity</b> — R2 {Math.round(limits.r2.usagePercent)}% of {limits.r2.softLimitGb} GB
                  {" · "}DB blocks {limits.db.blocks}/{limits.db.softLimitBlocks}
                </div>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <Switch checked={forceStart} onCheckedChange={(v) => setForceStart(Boolean(v))} />
                    Force start
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {stat(
              "bg-emerald-500",
              "Running",
              jobs.length ? runningCount : metrics?.running
            )}
            {stat("bg-blue-500", "Active", activeCount)}
            {stat("bg-amber-500", "Queued", metrics?.queued)}
            {stat("bg-sky-500", "Workers", metrics?.workerParallelism)}
            {stat(
              "bg-zinc-500",
              "Paused",
              jobs.length ? pausedCount : metrics?.paused
            )}
            {stat("bg-red-500", "Errors", jobs.length ? errorJobsCount : 0)}
          </div>

          {/* Tabs with URL sync */}
          <Tabs
            defaultValue="add"
            value={mounted ? activeTab : undefined}
            onValueChange={(v) => {
              const next =
                v === "all" ? "/admin/engine/jobs" : "/admin/engine/add";
              if (
                typeof window !== "undefined" &&
                window.location.pathname !== next
              ) {
                window.history.pushState({}, "", next);
              }
              setActiveTab(v as "add" | "all");
            }}
            className="w-full"
          >
            <div className="border-b border-border">
              <TabsList className="h-auto w-full justify-start rounded-none bg-transparent p-0">
                <TabsTrigger
                  value="add"
                  className="relative rounded-none border-b-2 border-transparent px-6 py-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  Add Jobs
                </TabsTrigger>
                <TabsTrigger
                  value="all"
                  className="relative rounded-none border-b-2 border-transparent px-6 py-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  All Jobs
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="add" className="mt-6 space-y-4">
              <Card className="relative flex max-h-[600px] flex-col overflow-hidden rounded-[11px] bg-card text-sm font-medium leading-5 tracking-normal shadow-sm">
                <CardHeader>
                  <CardTitle>Add a new job</CardTitle>
                  <CardDescription>Start a scraping run</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={startJob} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <div className="lg:col-span-2 space-y-2">
                        <Label htmlFor="url">Savee URL</Label>
                        <Input
                          id="url"
                          type="url"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://savee.it | /pop | /username"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={sourceType}
                          onValueChange={(v) => setSourceType(v as SourceType)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="home">Home</SelectItem>
                            <SelectItem value="pop">Popular</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="max">Max Items (blank = all)</Label>
                        <Input
                          id="max"
                          type="number"
                          value={maxItems}
                          onChange={(e) =>
                            setMaxItems(
                              e.target.value === ""
                                ? ""
                                : parseInt(e.target.value)
                            )
                          }
                          min={1}
                        />
                      </div>
                    </div>
                    <Button type="submit" disabled={submitting || !url.trim()}>
                      {submitting ? "Adding..." : "Add Job"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="all" className="mt-6 space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
                <h2 className="text-lg font-semibold">All Jobs</h2>
                <div className="flex w-full max-w-2xl items-center gap-3 md:justify-end">
                  <Input
                    placeholder="Search by URL or username"
                    className="w-full"
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                  />
                  <StatusFilter
                    options={STATUS_OPTIONS}
                    selected={selectedStatuses}
                    onChange={setSelectedStatuses}
                  />
                </div>
              </div>
              <div className="space-y-4">
                {jobs
                  .filter((j) => {
                    const q = query.trim().toLowerCase();
                    const matchesQuery = q
                      ? (j.url || "").toLowerCase().includes(q) ||
                        (j.username || "").toLowerCase().includes(q)
                      : true;
                    const matchesStatus =
                      selectedStatuses[j.status as StatusKey] ?? true;
                    return matchesQuery && matchesStatus;
                  })
                  .map((j) => (
                    <EngineJobCard key={j.id} job={j} refresh={fetchJobs} limits={limits} />
                  ))}
                {jobs.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm">
                    No jobs yet.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Portal host for all Radix portals to maintain .engine-view scoping */}
        <div id="engine-portal-host" />
      </div>
    </ThemeProvider>
  );
}

// Minimal Job Card built with shadcn, uses EngineView endpoints for controls
function EngineJobCard({
  job,
  refresh,
  limits,
}: {
  job: JobData;
  refresh: () => void;
  limits?: EngineLimits | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [editUrl, setEditUrl] = React.useState<string>(job.url || "");
  const [editMax, setEditMax] = React.useState<string>(
    typeof job.maxItems === "number" ? String(job.maxItems) : ""
  );
  const [confirmText, setConfirmText] = React.useState("");
  const [delDb, setDelDb] = React.useState(true);
  const [delR2, setDelR2] = React.useState(true);
  const [delUsers, setDelUsers] = React.useState(true);
  const logsEndRef = React.useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = React.useState(true);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const esRef = React.useRef<EventSource | null>(null);
  const pollRef = React.useRef<any>(null);
  const reconnectRef = React.useRef<any>(null);
  const [forceRunToggle, setForceRunToggle] = React.useState(false);

  // Normalize URL equality for delete confirmation (ignore protocol and trailing slash)
  const canDelete = React.useMemo(() => {
    const normalize = (s: string) => {
      const raw = (s || "").trim();
      if (!raw) return "";
      try {
        const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        return `${u.hostname}${u.pathname}`.replace(/\/+$/, "");
      } catch {
        return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      }
    };
    return normalize(confirmText) === normalize(job.url || "");
  }, [confirmText, job.url]);

  const confirmHost = React.useMemo(() => {
    try {
      return new URL(job.url || "").hostname;
    } catch {
      return (
        (job.url || "").replace(/^https?:\/\//, "").split("/")[0] || "this job"
      );
    }
  }, [job.url]);

  const fetchSnapshot = React.useCallback(async (runId?: string) => {
    if (!runId) return;
    try {
      const res = await fetch(
        `/api/engine/logs?runId=${encodeURIComponent(runId)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      }
    } catch {}
  }, []);

  const attachStream = React.useCallback((runId?: string) => {
    if (!runId) return;
    try {
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
        esRef.current = null;
      }
      const es = new EventSource(
        `/api/engine/logs/stream?runId=${encodeURIComponent(runId)}`
      );
      esRef.current = es;
      const push = (p: any) => {
        if (!p || !p.type) return;
        setLogs((prev) => [
          ...prev,
          {
            timestamp: p.timestamp || new Date().toISOString(),
            type: p.type,
            url: p.url || "",
            status: p.status || "",
            timing: p.timing,
            message: p.message,
          },
        ]);
      };
      es.onmessage = (ev) => {
        try {
          push(JSON.parse(ev.data || "{}"));
        } catch {}
      };
      es.addEventListener("log", (ev: MessageEvent) => {
        try {
          push(JSON.parse(ev.data || "{}"));
        } catch {}
      });
      es.onerror = () => {
        // Close and attempt a lightweight reconnect after a short backoff
        try {
          es.close();
        } catch {}
        esRef.current = null;
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
        }
        reconnectRef.current = setTimeout(() => attachStream(runId), 2000);
      };
    } catch {}
  }, []);

  const refreshLogs = React.useCallback(async () => {
    if (!job.runId) return;
    await fetchSnapshot(job.runId);
    if (!esRef.current && job.runId) attachStream(job.runId);
  }, [job.runId, fetchSnapshot, attachStream]);

  React.useEffect(() => {
    if (open && job.runId) {
      fetchSnapshot(job.runId);
      attachStream(job.runId);
      // Also poll periodically as a safety net and after run completes
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(
        () => fetchSnapshot(job.runId as string),
        3000
      );
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
        esRef.current = null;
      }
    };
  }, [open, job.runId, fetchSnapshot, attachStream]);

  React.useEffect(() => {
    if (!open) return;
    if (!autoFollow) return; // respect user choice; do not force scroll
    try {
      const el = logsEndRef.current as HTMLElement | null;
      if (!el) return;
      const viewport = el.closest(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement | null;
      if (!viewport) return;
      const threshold = 80; // px from bottom to count as bottom
      const atBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
        threshold;
      if (atBottom) {
        viewport.scrollTop = viewport.scrollHeight; // scroll only inside viewport
      }
    } catch {}
  }, [logs, open, autoFollow]);

  // When user scrolls up in the log viewport, automatically turn off auto-follow; re-enable when near bottom
  React.useEffect(() => {
    if (!open) return;
    const el = logsEndRef.current as HTMLElement | null;
    if (!el) return;
    const viewport = el.closest(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;
    if (!viewport) return;
    const onScroll = () => {
      const threshold = 80;
      const atBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
        threshold;
      setAutoFollow(atBottom);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true } as any);
    onScroll();
    return () => viewport.removeEventListener("scroll", onScroll as any);
  }, [open]);
  const pause = async () => {
    await fetch("/api/engine/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause", jobId: job.id }),
    });
    refresh();
  };
  const resume = async () => {
    await fetch("/api/engine/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume", jobId: job.id }),
    });
    refresh();
  };
  const runNow = async () => {
    const url = "/api/engine/control";
    const body: any = { action: "run_now", jobId: job.id };
    if (forceRunToggle || limits?.r2?.nearLimit || limits?.db?.nearLimit) body.force = true;
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    refresh();
  };
  const forceRun = async () => {
    await fetch("/api/engine/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_now", jobId: job.id, force: true }),
    });
    refresh();
  };
  const stop = async () => {
    await fetch("/api/engine/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", jobId: job.id }),
    });
    refresh();
  };
  const cancelRun = async () => {
    // Prefer force cancel through run_now, but provide direct cancel for UX
    await fetch("/api/engine/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause", jobId: job.id }),
    });
    refresh();
  };

  return (
    <Card className="relative flex max-h-[600px] flex-col overflow-hidden rounded-[11px] bg-card text-sm font-medium leading-5 tracking-normal shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              job.status === "running"
                ? "bg-emerald-500"
                : job.status === "paused"
                  ? "bg-zinc-500"
                  : job.status === "error"
                    ? "bg-red-500"
                    : "bg-blue-500"
            )}
          />
          <span className="font-mono truncate" title={job.url}>
            {job.url}
          </span>
          {job.username && (
            <Badge variant="secondary" className="ml-2">
              User: {job.username}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs space-y-1">
                    <div>
                      Last run:{" "}
                      {job.lastRun
                        ? new Date(job.lastRun).toLocaleString()
                        : "—"}
                    </div>
                    <div>Status: {job.status}</div>
                    <div>
                      Next:{" "}
                      {job.nextRun
                        ? new Date(job.nextRun).toLocaleString()
                        : "—"}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-xs">
          <span className="capitalize">{job.sourceType}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4 text-sm">
        <Badge variant="secondary">Uploaded {job.counters.uploaded}</Badge>
        <Badge variant="outline">Processed {job.counters.found}</Badge>
        {(job.counters.skipped ?? 0) > 0 && (
          <Badge variant="outline">Skipped {job.counters.skipped}</Badge>
        )}
        {job.counters.errors > 0 && (
          <Badge variant="destructive">Errors {job.counters.errors}</Badge>
        )}
        <Badge variant="outline">
          Max {typeof job.maxItems === "number" ? job.maxItems : "∞"}
        </Badge>
      </CardContent>
      <CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          Last: {job.lastRun ? new Date(job.lastRun).toLocaleString() : "—"}
        </span>
        <span>
          Next: {job.nextRun ? new Date(job.nextRun).toLocaleString() : "—"}
        </span>
        <Badge variant="outline">
          Base {job.effectiveIntervalSeconds ?? job.intervalSeconds ?? 0}s
        </Badge>
        {job.backoffMultiplier && job.backoffMultiplier > 1 && (
          <Badge variant="secondary">Backoff x{job.backoffMultiplier}</Badge>
        )}
        <IntervalEditor job={job} onUpdated={refresh} />
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        {job.runStatus !== "paused" &&
          (job.status === "active" || job.status === "running") && (
            <Button size="sm" variant="outline" onClick={pause}>
              Pause
            </Button>
          )}
        {job.runStatus === "stale" && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              if (!job.runId) return;
              await fetch(`/api/engine/runs/${job.runId}/reconcile`, {
                method: "POST",
              });
              refresh();
            }}
          >
            Reconcile
          </Button>
        )}
        {(job.status === "paused" || job.runStatus === "paused") && (
          <Button size="sm" variant="outline" onClick={resume}>
            Resume
          </Button>
        )}
        {job.status === "active" && (
          <>
            <Button size="sm" onClick={runNow}>
              Run Now
            </Button>
            <Button size="sm" variant="outline" onClick={forceRun}>
              Force Run
            </Button>
          </>
        )}
        {(job.status === "running" || job.runStatus === "running") && (
          <Button size="sm" variant="outline" onClick={cancelRun}>
            Cancel Run
          </Button>
        )}
        {(job.status === "running" || job.status === "active") && (
          <Button size="sm" variant="destructive" onClick={stop}>
            Stop
          </Button>
        )}
        <label className="ml-auto inline-flex items-center gap-2 text-xs">
          <Switch checked={forceRunToggle} onCheckedChange={(v) => setForceRunToggle(Boolean(v))} />
          Force
        </label>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide Logs" : "View Logs"}
        </Button>
      </CardFooter>
      {open && (
        <CardContent>
          <div className="rounded-[11px] border bg-card shadow-sm">
            <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-3 text-xs backdrop-blur supports-[backdrop-filter]:bg-background/75 rounded-t-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-medium">Logs</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={autoFollow}
                      onCheckedChange={(v) => setAutoFollow(Boolean(v))}
                    />
                    Auto-follow
                  </label>
                  <Button size="sm" variant="outline" onClick={refreshLogs}>
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      logsEndRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "end",
                      })
                    }
                  >
                    Jump to latest
                  </Button>
                </div>
              </div>
            </div>
            <ScrollArea className="h-64">
              <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 rounded-t-[11px]">
                <div className="grid grid-cols-[160px_140px_1fr_120px_120px] items-center px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div>Time</div>
                  <div>Stage</div>
                  <div>URL</div>
                  <div>Status</div>
                  <div>Duration</div>
                </div>
              </div>
              <Table>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No logs yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log, idx) => {
                      const raw = String(log.status || "").trim();
                      const lower = raw.toLowerCase();
                      const norm =
                        raw === "✓" ||
                        lower === "success" ||
                        lower === "completed" ||
                        lower === "ok"
                          ? "success"
                          : raw === "✗" ||
                              lower === "error" ||
                              lower === "failed" ||
                              raw === "❌"
                            ? "error"
                            : raw === "⏳" ||
                                raw === "🕒" ||
                                lower === "pending" ||
                                lower === "running" ||
                                lower === "starting"
                              ? "pending"
                              : "pending";
                      const stageStyles: Record<string, string> = {
                        STARTING:
                          "bg-muted text-muted-foreground border-border",
                        FETCH:
                          "bg-blue-500/15 text-blue-400 border-blue-500/30",
                        SCRAPE:
                          "bg-amber-500/15 text-amber-400 border-amber-500/30",
                        COMPLETE:
                          "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                        "WRITE/UPLOAD":
                          "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
                      };

                      return (
                        <TableRow key={idx} className="border-0">
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-[11px] border px-2.5 py-0.5 text-xs font-semibold",
                                stageStyles[log.type] ||
                                  "bg-muted text-foreground/80 border-border"
                              )}
                            >
                              {log.type}
                            </span>
                          </TableCell>
                          <TableCell>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <code
                                    className="font-mono text-sm text-muted-foreground block max-w-[420px] truncate"
                                    title={log.url || log.message}
                                  >
                                    {log.url || log.message || "—"}
                                  </code>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {log.url || log.message}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="text-center">
                            <span
                              className="inline-flex items-center justify-center"
                              aria-label={raw || "status"}
                            >
                              {norm === "success" ? (
                                <Check className="mx-auto h-4 w-4 text-emerald-500" />
                              ) : norm === "error" ? (
                                <X className="mx-auto h-4 w-4 text-red-500" />
                              ) : (
                                <Clock className="mx-auto h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {log.timing || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <div ref={logsEndRef} />
            </ScrollArea>
          </div>
        </CardContent>
      )}
      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (v) {
            setEditUrl(job.url || "");
            setEditMax(
              typeof job.maxItems === "number" ? String(job.maxItems) : ""
            );
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
            <DialogDescription>
              Update URL, max items, or type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`edit-url-${job.id}`}>URL</Label>
              <Input
                id={`edit-url-${job.id}`}
                value={editUrl}
                onChange={(e) => setEditUrl(e.currentTarget.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`edit-max-${job.id}`}>Max Items</Label>
                <Input
                  id={`edit-max-${job.id}`}
                  type="number"
                  value={editMax}
                  onChange={(e) => setEditMax(e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select defaultValue={job.sourceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home">Home</SelectItem>
                    <SelectItem value="pop">Popular</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  const payload: any = { action: "edit", jobId: job.id };
                  const trimmedUrl = (editUrl || "").trim();
                  if (trimmedUrl && trimmedUrl !== job.url) {
                    payload.newUrl = trimmedUrl;
                  }
                  const trimmedMax = (editMax || "").trim();
                  if (trimmedMax === "") {
                    payload.newMaxItems = ""; // explicit clear -> server sets to null
                  } else {
                    const n = parseInt(trimmedMax, 10);
                    if (!Number.isNaN(n)) {
                      payload.newMaxItems = n;
                    }
                  }
                  await fetch("/api/engine/control", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                } catch {}
                setEditOpen(false);
                refresh();
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Job</DialogTitle>
            <DialogDescription>
              This will permanently delete the job and related resources like
              database records, storage files, and user data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor={`confirm-${job.id}`}
                className="text-sm font-medium"
              >
                To confirm, type “{job.url}”
              </Label>
              <Input
                id={`confirm-${job.id}`}
                placeholder={job.url}
                value={confirmText}
                onChange={(e) => setConfirmText(e.currentTarget.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`db-${job.id}`}
                  checked={delDb}
                  onCheckedChange={(v) => setDelDb(Boolean(v))}
                />
                <Label htmlFor={`db-${job.id}`} className="text-sm">
                  Delete from Database
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`r2-${job.id}`}
                  checked={delR2}
                  onCheckedChange={(v) => setDelR2(Boolean(v))}
                />
                <Label htmlFor={`r2-${job.id}`} className="text-sm">
                  Delete from R2 Storage
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`users-${job.id}`}
                  checked={delUsers}
                  onCheckedChange={(v) => setDelUsers(Boolean(v))}
                />
                <Label htmlFor={`users-${job.id}`} className="text-sm">
                  Delete related Users
                </Label>
              </div>
            </div>
            {!canDelete && (
              <div className="flex items-center gap-2 rounded-[12px] border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                <span className="text-lg">!</span>
                Deleting {confirmHost} cannot be undone.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canDelete}
              onClick={async () => {
                setDeleteOpen(false);
                try {
                  await fetch(`/api/engine/jobs/${job.id}`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      deleteFromDb: delDb,
                      deleteFromR2: delR2,
                      deleteUsers: delUsers,
                    }),
                  });
                } catch {}
                setConfirmText("");
                refresh();
              }}
            >
              Delete Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function IntervalEditor({
  job,
  onUpdated,
}: {
  job: JobData;
  onUpdated: () => void;
}) {
  const [intervalVal, setIntervalVal] = React.useState<string>(
    String(job.intervalSeconds ?? job.effectiveIntervalSeconds ?? "")
  );
  const [adaptive, setAdaptive] = React.useState<boolean>(
    !(job.disableBackoff ?? false)
  );

  const save = async (payload: any) => {
    try {
      const res = await fetch(`/api/engine/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) onUpdated();
    } catch {}
  };

  return (
    <div className="ml-auto flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Input
          className="w-28 h-8"
          type="number"
          placeholder="Interval (s)"
          value={intervalVal}
          onChange={(e) => setIntervalVal(e.currentTarget.value)}
          onBlur={() => {
            const trimmed = intervalVal.trim();
            if (trimmed === "") return save({ intervalSeconds: null });
            const n = parseInt(trimmed, 10);
            if (!Number.isNaN(n)) save({ intervalSeconds: n });
          }}
        />
        <span className="text-[10px] text-muted-foreground">seconds</span>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Switch
          checked={adaptive}
          onCheckedChange={(v) => {
            setAdaptive(Boolean(v));
            save({ disableBackoff: !v });
          }}
        />
        Adaptive
      </label>
    </div>
  );
}

type StatusFilterProps = {
  options: { key: string; label: string; dot: string }[];
  selected: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
};

function StatusFilter({ options, selected, onChange }: StatusFilterProps) {
  const activeCount = options.filter((o) => selected[o.key]).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="inline-flex h-10 gap-2">
          <span className="flex items-center -space-x-1">
            {options.map((o) => (
              <span
                key={o.key}
                className={cn(
                  "h-3 w-3 rounded-full border border-background/20",
                  o.dot
                )}
              />
            ))}
          </span>
          <span className="text-sm">Status</span>
          <Badge variant="secondary" className="ml-1">
            {activeCount}/{options.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="box-border p-2 w-[var(--radix-popper-anchor-width)] min-w-0"
      >
        <div className="space-y-1">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              className="flex w-full cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 hover:bg-accent transition-colors text-left"
              onClick={() =>
                onChange({ ...selected, [o.key]: !selected[o.key] })
              }
            >
              <span className={cn("h-3.5 w-3.5 rounded-full", o.dot)} />
              <span className="flex-1 text-sm">{o.label}</span>
              {selected[o.key] && <Check className="h-4 w-4 text-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
