"use client";

import React, { useState, useEffect, useRef } from "react";
import { parseSaveeUrl } from "../lib/url-utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ModeToggle } from "@/components/ModeToggle";

// Types
interface JobData {
  id: string;
  runId?: string; // Run ID for fetching logs
  url: string;
  sourceType: "home" | "pop" | "user";
  username?: string;
  maxItems: number;
  status: "active" | "running" | "paused" | "error" | "completed";
  runStatus?: string; // Separate run status for pause badge
  counters: {
    found: number;
    uploaded: number;
    errors: number;
    skipped?: number;
  };
  lastRun?: string;
  nextRun?: string;
  error?: string;
  // New: per-job schedule
  intervalSeconds?: number;
  disableBackoff?: boolean;
  effectiveIntervalSeconds?: number;
  backoffMultiplier?: number;
}

interface LogEntry {
  timestamp: string;
  type: "STARTING" | "FETCH" | "SCRAPE" | "COMPLETE" | "WRITE/UPLOAD" | "ERROR";
  url: string;
  status: "✓" | "❌" | "⏳";
  timing?: string;
  message?: string;
}

interface EngineMetrics {
  queued: number;
  running: number;
  paused: number;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  workerParallelism: number;
}

export default function EngineView() {
  // Form state
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<"home" | "pop" | "user">("home");
  const [maxItems, setMaxItems] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Jobs state
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [isAutoScroll, setIsAutoScroll] = useState<Record<string, boolean>>({});
  const logsContainerRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const logsEndRef = useRef<Record<string, HTMLDivElement | null>>({});
  const jobsRef = useRef<JobData[]>([]); // Ref to access current jobs in intervals
  const [, setEditingJob] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<EngineMetrics | null>(null);
  const [jobQuery, setJobQuery] = useState<string>("");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    jobId: string;
    confirmUrl: string;
    deleteFromDb: boolean;
    deleteFromR2: boolean;
    deleteUsers: boolean;
  } | null>(null);

  // Safe date helpers
  const parseDate = (value?: string | number | Date | null) => {
    if (!value) return null;
    const d = new Date(value as any);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDateTime = (value?: string | number | Date | null) => {
    const d = parseDate(value);
    if (!d) return "—";
    try {
      return d.toLocaleString();
    } catch {
      return "—";
    }
  };

  const formatDateOnly = (value?: string | number | Date | null) => {
    const d = parseDate(value);
    if (!d) return "—";
    try {
      return d.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  const formatTimeOnly = (value?: string | number | Date | null) => {
    const d = parseDate(value);
    if (!d) return "—";
    try {
      return d.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  // Format seconds to a compact human string (e.g., 90 -> 1m 30s, 3600 -> 1h)
  const formatSeconds = (total?: number) => {
    const s = Number(total || 0);
    if (!Number.isFinite(s) || s <= 0) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0 && m === 0 && sec === 0) return `${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0 && sec === 0) return `${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  const renderBackoffChip = (job: JobData) => {
    const multiplier = Math.max(1, Number(job.backoffMultiplier || 1));
    if (multiplier <= 1) return null;
    return (
      <div
        className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] whitespace-nowrap"
        title="Backoff multiplier applied from recent errors or zero uploads"
      >
        Backoff: x{multiplier}
      </div>
    );
  };

  // Countdown helpers
  const computeDueInSeconds = (nextRun?: string) => {
    if (!nextRun) return undefined;
    const d = parseDate(nextRun);
    if (!d) return undefined;
    const diff = Math.max(0, Math.floor((d.getTime() - Date.now()) / 1000));
    return diff;
  };
  const formatDueIn = (secs?: number) => {
    if (secs === undefined) return "—";
    if (secs === 0) return "due now";
    return formatSeconds(secs);
  };

  // Auto-detect source type from URL
  useEffect(() => {
    if (!url) return;
    const parsed = parseSaveeUrl(url);
    if (parsed.isValid) setSourceType(parsed.sourceType);
  }, [url]);

  // Fetch jobs data
  const fetchJobs = async () => {
    try {
      const response = await fetch("/api/engine/jobs");
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs || []);
        jobsRef.current = data.jobs || []; // Update ref for interval access
      }
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    }
  };

  // Fetch metrics
  const fetchMetrics = async () => {
    try {
      const response = await fetch("/api/engine/metrics", {
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.success) setMetrics(data as EngineMetrics);
      }
    } catch (error) {
      console.error("Failed to fetch metrics:", error);
    }
  };

  // Start a new job
  const startJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/engine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          maxItems: maxItems || undefined,
          sourceType,
        }),
      });

      if (response.ok) {
        setUrl("");
        setMaxItems("");
        setSourceType("home");
        fetchJobs();
      } else {
        console.error("Failed to start job");
      }
    } catch (error) {
      console.error("Error starting job:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Note: Generic controlJob removed - using specific pauseJob/resumeJob/runNowJob functions instead

  // Auto-scroll (follow tail) when at bottom; pause following if user scrolls up
  useEffect(() => {
    Object.keys(logs).forEach((jobId) => {
      if (!expandedJobs.has(jobId)) return;
      const auto = isAutoScroll[jobId] ?? true;
      const container = logsContainerRef.current[jobId];
      if (auto && container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [logs, expandedJobs, isAutoScroll]);

  // Toggle job logs
  const toggleJobLogs = (jobId: string) => {
    const newExpanded = new Set(expandedJobs);
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId);
      // Close SSE for this job if open
      const job = jobsRef.current.find((j) => j.id === jobId);
      const runId = job?.runId;
      if (runId && sseRef.current[runId]) {
        try {
          sseRef.current[runId]?.close();
        } catch {}
        sseRef.current[runId] = null;
      }
    } else {
      newExpanded.add(jobId);
      // Find the job and use its runId for fetching logs
      const job = jobsRef.current.find((j) => j.id === jobId);
      if (job && job.runId) {
        fetchJobLogs(job.runId);
      }
      // enable follow by default when opening
      setIsAutoScroll((prev) => ({ ...prev, [jobId]: true }));
    }
    setExpandedJobs(newExpanded);
  };

  // SSE subscription map and aborters
  const sseRef = useRef<Record<string, EventSource | null>>({});

  // Fetch snapshot + attach SSE stream
  const fetchJobLogs = async (runId: string) => {
    // 1) initial snapshot for fast paint
    try {
      const response = await fetch(`/api/engine/logs?runId=${runId}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        const job = jobsRef.current.find((j) => j.runId === runId);
        if (job) setLogs((prev) => ({ ...prev, [job.id]: data.logs || [] }));
      }
    } catch (e) {
      // non-fatal
    }

    // 2) attach SSE for true realtime
    try {
      // Close existing
      Object.entries(sseRef.current).forEach(([k, es]) => {
        if (k === runId && es) {
          try {
            es.close();
          } catch {}
          sseRef.current[k] = null;
        }
      });
      const es = new EventSource(
        `/api/engine/logs/stream?runId=${encodeURIComponent(runId)}`
      );
      sseRef.current[runId] = es;
      es.onmessage = (ev) => {
        // Only process named events in onmessage if server uses default event
        try {
          const job = jobsRef.current.find((j) => j.runId === runId);
          if (!job) return;
          const data = JSON.parse(ev.data || "{}");
          if (!data || !data.type) return;
          setLogs((prev) => {
            const arr = (prev[job.id] || []).slice();
            arr.push({
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type,
              url: data.url || "",
              status: data.status || "",
              timing: data.timing,
              message: data.message,
            });
            return { ...prev, [job.id]: arr };
          });
        } catch {}
      };
      es.addEventListener("log", (ev: MessageEvent) => {
        try {
          const job = jobsRef.current.find((j) => j.runId === runId);
          if (!job) return;
          const data = JSON.parse(ev.data || "{}");
          setLogs((prev) => {
            const arr = (prev[job.id] || []).slice();
            arr.push({
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type,
              url: data.url || "",
              status: data.status || "",
              timing: data.timing,
              message: data.message,
            });
            return { ...prev, [job.id]: arr };
          });
        } catch {}
      });
      es.addEventListener("heartbeat", () => {
        /* keepalive indicator if needed */
      });
      es.onerror = () => {
        /* fallback is periodic polling already in place */
      };
    } catch (e) {
      // Ignore; fallback polling remains
    }
  };

  // Control job functions
  const pauseJob = async (jobId: string) => {
    try {
      const response = await fetch("/api/engine/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", jobId }),
      });
      if (response.ok) {
        fetchJobs(); // Refresh job list
      }
    } catch (error) {
      console.error("Pause job error:", error);
    }
  };

  const resumeJob = async (jobId: string) => {
    try {
      const response = await fetch("/api/engine/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", jobId }),
      });
      if (response.ok) {
        fetchJobs(); // Refresh job list
      }
    } catch (error) {
      console.error("Resume job error:", error);
    }
  };

  const runNowJob = async (jobId: string) => {
    try {
      const response = await fetch("/api/engine/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now", jobId }),
      });
      if (response.ok) {
        fetchJobs(); // Refresh job list
      }
    } catch (error) {
      console.error("Run now job error:", error);
    }
  };

  const deleteJob = async (jobId: string) => {
    if (!deleteConfirm) return;

    // Find the job to get its URL for validation
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job) {
      alert("Job not found");
      return;
    }

    // Validate URL confirmation
    if (deleteConfirm.confirmUrl !== job.url) {
      alert("URL confirmation does not match. Please type the exact URL.");
      return;
    }

    try {
      const response = await fetch(`/api/engine/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteFromDb: deleteConfirm.deleteFromDb,
          deleteFromR2: deleteConfirm.deleteFromR2,
          deleteUsers: deleteConfirm.deleteUsers,
        }),
      });

      if (response.ok) {
        fetchJobs(); // Refresh job list
        setDeleteConfirm(null); // Close modal
      } else {
        const errorData = await response.json();
        alert(`Failed to delete job: ${errorData.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Delete job error:", error);
      alert("Failed to delete job. Please try again.");
    }
  };

  // Simple edit flow via prompts: allow changing URL and/or Max Items
  const editJob = async (jobId: string, currentUrl: string) => {
    const urlInput = window.prompt(
      "Edit job: Enter new URL or leave blank to only change Max Items",
      currentUrl || "https://savee.com/"
    );
    const urlValue = (urlInput || "").trim();
    const maxStr = window.prompt("Max Items (0 = unlimited):", "0");
    const maxNum = maxStr ? parseInt(maxStr, 10) : 0;
    try {
      const payload: any = { action: "edit", jobId };
      if (urlValue && urlValue !== currentUrl) payload.newUrl = urlValue;
      if (!Number.isNaN(maxNum)) payload.newMaxItems = maxNum;
      const resp = await fetch("/api/engine/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        fetchJobs();
        alert("Job updated and restarted.");
      } else {
        const err = await resp.json().catch(() => ({}));
        alert(`Failed to update job${err?.error ? `: ${err.error}` : ""}`);
      }
    } catch (e) {
      console.error("Edit job error:", e);
      alert("Failed to update job. Please try again.");
    }
  };

  // Save schedule config
  // (removed legacy modal; inline controls handle schedule updates)

  // Inline schedule updater (Engine page inputs)
  const updateScheduleInline = async (
    jobId: string,
    intervalValue?: string,
    adaptiveBackoff?: boolean
  ) => {
    const payload: any = {};
    if (typeof intervalValue !== "undefined") {
      const trimmed = String(intervalValue).trim();
      if (trimmed.length > 0) {
        const parsed = parseInt(trimmed, 10);
        if (!Number.isNaN(parsed)) payload.intervalSeconds = parsed;
      } else {
        // Empty means remove override (clear field on server)
        payload.intervalSeconds = null as any;
      }
    }
    if (typeof adaptiveBackoff === "boolean") {
      payload.disableBackoff = !adaptiveBackoff;
    }
    try {
      const resp = await fetch(`/api/engine/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        fetchJobs();
      } else {
        const err = await resp.json().catch(() => ({}));
        console.error("Schedule update failed", err);
      }
    } catch (e) {
      console.error("Schedule update error:", e);
    }
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "running":
        return "bg-blue-100 text-blue-800";
      case "paused":
        return "bg-yellow-100 text-yellow-800";
      case "error":
        return "bg-red-100 text-red-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  // Get source type display
  const getSourceTypeDisplay = (type: string, username?: string) => {
    switch (type) {
      case "home":
        return "Home Feed";
      case "pop":
        return "Popular";
      case "user":
        return `User: ${username || "Unknown"}`;
      default:
        return type;
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchJobs();
    fetchMetrics();
  }, []);

  // Set up real-time polling - separate from jobs dependency
  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs();
      fetchMetrics();
      // Fetch logs for expanded jobs using runId
      expandedJobs.forEach((jobId) => {
        const currentJobs = jobsRef.current; // Use ref to get current jobs
        const job = currentJobs.find((j) => j.id === jobId);
        if (job && job.runId) {
          fetchJobLogs(job.runId);
        }
      });
    }, 1000); // Poll every 1 second for real-time updates

    return () => clearInterval(interval);
  }, [expandedJobs]); // Only depend on expandedJobs, not jobs

  return (
    <ThemeProvider>
      <div className="max-w-6xl mx-auto p-6 space-y-8" suppressHydrationWarning>
        {/* Header */}
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>Scraping Engine</CardTitle>
              <CardDescription>
                Manage and monitor your Savee scraping jobs
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <ModeToggle />
            </div>
          </CardHeader>
          {metrics && (
            <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md border bg-muted/40 p-2">
                Queued: {metrics.queued}
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                Running: {metrics.running}
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                Paused: {metrics.paused}
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                Workers: {metrics.workerParallelism}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Add New Job Form */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Add New Job</h2>
          <form onSubmit={startJob} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* URL Input */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Savee.it URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://savee.it, https://savee.it/pop, https://savee.it/username"
                  className="input"
                  required
                />
              </div>

              {/* Source Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type (Auto-detected)
                </label>
                <select
                  value={sourceType}
                  onChange={(e) =>
                    setSourceType(e.target.value as "home" | "pop" | "user")
                  }
                  className="select"
                >
                  <option value="home">Home Feed</option>
                  <option value="pop">Popular</option>
                  <option value="user">User Profile</option>
                </select>
              </div>

              {/* Max Items */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Items (blank = all)
                </label>
                <input
                  type="number"
                  value={maxItems}
                  onChange={(e) =>
                    setMaxItems(
                      e.target.value === "" ? "" : parseInt(e.target.value)
                    )
                  }
                  placeholder="All found"
                  min="1"
                  className="input"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !url.trim()}
              className="btn btn-primary disabled:bg-gray-400"
            >
              {isSubmitting ? "Adding Job..." : "Add Job"}
            </button>
          </form>
        </div>

        {/* Jobs List */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-4">
            <CardTitle>Jobs ({jobs.length})</CardTitle>
            <Input
              placeholder="Search jobs (url or username)"
              className="w-full max-w-xs"
              value={jobQuery}
              onChange={(e) => setJobQuery(e.currentTarget.value)}
            />
          </CardHeader>

          {jobs.length === 0 ? (
            <CardContent className="text-center text-muted-foreground">
              No jobs yet. Add your first job above.
            </CardContent>
          ) : (
            <CardContent className="space-y-6">
              {jobs
                .filter((j) => {
                  if (!jobQuery.trim()) return true;
                  const q = jobQuery.trim().toLowerCase();
                  return (
                    (j.url || "").toLowerCase().includes(q) ||
                    (j.username || "").toLowerCase().includes(q)
                  );
                })
                .map((job) => (
                  <Card key={job.id}>
                    {/* Job Header */}
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Badge className="font-mono">
                              {job.status.toUpperCase()}
                            </Badge>
                            {/* Pause Badge - Show when run is paused */}
                            {job.runStatus === "paused" && (
                              <Badge variant="secondary" className="gap-1">
                                <span>⏸</span>PAUSED
                              </Badge>
                            )}
                            <span className="text-sm text-gray-600">
                              {getSourceTypeDisplay(
                                job.sourceType,
                                job.username
                              )}
                            </span>
                          </div>
                          <div className="text-sm font-mono text-gray-800">
                            {job.url}
                          </div>
                          <div
                            className="text-xs text-gray-500 mt-1"
                            title={`Last completed: ${formatDateTime(job.lastRun)}\nNext scheduled: ${formatDateTime(job.nextRun)}`}
                          >
                            Next scheduled: {formatDateTime(job.nextRun)}{" "}
                            <Badge variant="outline" className="ml-1">
                              due in{" "}
                              {formatDueIn(computeDueInSeconds(job.nextRun))}
                            </Badge>
                          </div>
                        </div>

                        {/* Job Controls */}
                        <div className="flex items-center gap-2">
                          {/* Pause Button - Available for active AND running jobs, but not if already paused */}
                          {(job.status === "active" ||
                            job.status === "running") &&
                            job.runStatus !== "paused" && (
                              <button
                                onClick={() => pauseJob(job.id)}
                                className="btn"
                                title="Pause Job"
                              >
                                Pause
                              </button>
                            )}

                          {/* Resume Button - Only for paused jobs */}
                          {(job.status === "paused" ||
                            job.runStatus === "paused") && (
                            <button
                              onClick={() => resumeJob(job.id)}
                              className="btn"
                              title="Resume Job"
                            >
                              Resume
                            </button>
                          )}

                          {/* Run Now Button - Only for active jobs */}
                          {job.status === "active" && (
                            <button
                              onClick={() => runNowJob(job.id)}
                              className="btn"
                              title="Run Now"
                            >
                              Run Now
                            </button>
                          )}

                          {/* Edit Button - Always visible; works via prompt; prefer paused */}
                          <button
                            onClick={() => editJob(job.id, job.url)}
                            className="btn"
                            title="Edit URL and/or Max Items, then restart"
                          >
                            Edit
                          </button>

                          {/* Info Button */}
                          <button
                            className="btn"
                            title={`Last run: ${formatDateTime(job.lastRun)}\nNext: ${formatDateTime(job.nextRun)}`}
                          >
                            Info
                          </button>
                          {/* Inline schedule controls */}
                          <div className="flex items-center gap-3 ml-2">
                            <div className="flex flex-col">
                              <input
                                type="number"
                                min={10}
                                placeholder="Interval (s)"
                                defaultValue={
                                  (job.intervalSeconds ??
                                    job.effectiveIntervalSeconds ??
                                    undefined) as any
                                }
                                onBlur={(e) =>
                                  updateScheduleInline(
                                    job.id,
                                    e.currentTarget.value,
                                    undefined
                                  )
                                }
                                className="input w-28"
                                title="Override interval in seconds (blank=global)"
                              />
                              <span className="text-[10px] text-gray-500">
                                seconds (base)
                              </span>
                            </div>
                            {/* Effective interval chip */}
                            <div className="flex items-center gap-2">
                              <div
                                className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-[11px] whitespace-nowrap"
                                title="Base interval used to schedule the next run (override or global)"
                              >
                                Base interval:{" "}
                                {formatSeconds(
                                  job.effectiveIntervalSeconds ??
                                    job.intervalSeconds ??
                                    0
                                )}
                              </div>
                              {renderBackoffChip(job)}
                            </div>
                            <label
                              className="flex items-center gap-1 text-xs text-gray-700"
                              title="Adaptive backoff reduces frequency after errors/zero-uploads"
                            >
                              <input
                                type="checkbox"
                                defaultChecked={!job.disableBackoff}
                                onChange={(e) =>
                                  updateScheduleInline(
                                    job.id,
                                    undefined,
                                    e.currentTarget.checked
                                  )
                                }
                              />
                              Adaptive
                            </label>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() =>
                              setDeleteConfirm({
                                jobId: job.id,
                                confirmUrl: "",
                                deleteFromDb: true,
                                deleteFromR2: true,
                                deleteUsers: true,
                              })
                            }
                            className="btn btn-danger"
                            title="Delete Job (requires URL confirmation)"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </CardHeader>

                    {/* Counters */}
                    <CardContent className="flex items-center gap-6 text-sm">
                      <span className="text-green-600">
                        <strong>{job.counters.uploaded}</strong> uploaded
                      </span>
                      <span className="text-blue-600">
                        <strong>{job.counters.found}</strong> processed
                      </span>
                      {(job.counters.skipped ?? 0) > 0 && (
                        <span className="text-gray-600">
                          <strong>{job.counters.skipped}</strong> skipped
                        </span>
                      )}
                      {job.counters.errors > 0 && (
                        <span className="text-red-600">
                          <strong>{job.counters.errors}</strong> errors
                        </span>
                      )}
                      <span className="text-gray-600">
                        Max: <strong>{job.maxItems}</strong>
                      </span>
                    </CardContent>

                    {/* Error Message */}
                    {job.status === "error" && job.error && (
                      <CardContent className="bg-red-50 border border-red-200 rounded-md p-3">
                        <div className="text-red-800 text-sm font-medium">
                          Error:
                        </div>
                        <div className="text-red-700 text-sm">{job.error}</div>
                      </CardContent>
                    )}

                    {/* Logs Toggle */}
                    <CardFooter>
                      <button
                        onClick={() => toggleJobLogs(job.id)}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-800 text-sm"
                      >
                        <span
                          className={`transform transition-transform ${expandedJobs.has(job.id) ? "rotate-90" : ""}`}
                        >
                          ▶
                        </span>
                        Logs
                      </button>
                    </CardFooter>

                    {/* Logs Content */}
                    {expandedJobs.has(job.id) && (
                      <CardContent className="mt-2">
                        <div className="bg-gray-900 rounded-lg border border-gray-700">
                          <div className="px-4 py-3 bg-gray-800 rounded-t-lg border-b border-gray-700">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-gray-100">
                                Real-time Logs
                              </h4>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                <span className="text-xs text-gray-400">
                                  Live
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    logsEndRef.current[job.id]?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "end",
                                    });
                                    setIsAutoScroll((prev) => ({
                                      ...prev,
                                      [job.id]: true,
                                    }));
                                  }}
                                >
                                  Jump to latest
                                </Button>
                              </div>
                            </div>
                          </div>

                          <ScrollArea className="max-h-80">
                            <div className="p-4 space-y-3">
                              {logs[job.id]?.length ? (
                                logs[job.id].map((log, idx) => (
                                  <div
                                    key={idx}
                                    className="font-mono text-sm text-gray-200 bg-gray-900/70 border border-gray-700 rounded px-3 py-2"
                                  >
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="inline-flex items-center px-2 py-1 rounded bg-gray-700 text-gray-300 text-xs">
                                        [{formatDateOnly(log.timestamp)} |{" "}
                                        {formatTimeOnly(log.timestamp)}]
                                      </span>
                                      <Badge variant="secondary">
                                        ({log.type})
                                      </Badge>
                                      <span className="text-gray-200 flex-1 min-w-0 truncate">
                                        {log.url || log.message}
                                      </span>
                                      {log.status && (
                                        <Badge className="font-mono">
                                          ({log.status})
                                        </Badge>
                                      )}
                                      {log.timing && (
                                        <Badge
                                          variant="outline"
                                          className="font-mono"
                                        >
                                          (⏱ {log.timing})
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="p-8 text-center text-gray-500">
                                  No logs available
                                </div>
                              )}
                              <div
                                ref={(el) => {
                                  if (el) logsEndRef.current[job.id] = el;
                                }}
                              />
                            </div>
                          </ScrollArea>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
            </CardContent>
          )}
        </Card>

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Confirm Deletion</h3>
              <p className="text-gray-600 mb-4">
                Type the exact URL to confirm deletion:
              </p>
              <input
                type="text"
                value={deleteConfirm.confirmUrl}
                onChange={(e) =>
                  setDeleteConfirm({
                    ...deleteConfirm,
                    confirmUrl: e.target.value,
                  })
                }
                placeholder="Enter URL to confirm"
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-4"
              />

              {/* Deletion Options */}
              <div className="mb-6">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  What to delete:
                </p>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={deleteConfirm.deleteFromDb}
                      onChange={(e) =>
                        setDeleteConfirm({
                          ...deleteConfirm,
                          deleteFromDb: e.target.checked,
                        })
                      }
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">
                      Delete from Database (jobs, runs, logs)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={deleteConfirm.deleteFromR2}
                      onChange={(e) =>
                        setDeleteConfirm({
                          ...deleteConfirm,
                          deleteFromR2: e.target.checked,
                        })
                      }
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">
                      Delete from R2 Storage (all scraped media)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={deleteConfirm.deleteUsers}
                      onChange={(e) =>
                        setDeleteConfirm({
                          ...deleteConfirm,
                          deleteUsers: e.target.checked,
                        })
                      }
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">
                      Delete Users (savee_users and user_blocks)
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => deleteJob(deleteConfirm.jobId)}
                  disabled={
                    !deleteConfirm.deleteFromDb &&
                    !deleteConfirm.deleteFromR2 &&
                    !deleteConfirm.deleteUsers
                  }
                  className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md"
                >
                  Delete Selected
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-4 py-2 rounded-md"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule Edit Modal */}
        {/* (removed legacy schedule modal) */}
      </div>
    </ThemeProvider>
  );
}
