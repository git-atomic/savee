"use client";

import React, { useState, useEffect } from "react";

// Types
interface JobData {
  id: string;
  url: string;
  sourceType: "home" | "pop" | "user";
  username?: string;
  maxItems: number;
  status: "active" | "running" | "paused" | "error" | "completed";
  counters: {
    found: number;
    uploaded: number;
    errors: number;
  };
  lastRun?: string;
  nextRun?: string;
  error?: string;
}

interface LogEntry {
  timestamp: string;
  type: "STARTING" | "FETCH" | "SCRAPE" | "COMPLETE" | "WRITE/UPLOAD" | "ERROR";
  url: string;
  status: "✓" | "❌";
  timing?: string;
  message?: string;
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
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [, setEditingJob] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    jobId: string;
    confirmUrl: string;
  } | null>(null);

  // Auto-detect source type from URL
  useEffect(() => {
    if (!url) return;

    const urlLower = url.toLowerCase().trim();
    if (
      urlLower.includes("savee.it/pop") ||
      urlLower.includes("savee.it/popular")
    ) {
      setSourceType("pop");
    } else if (
      urlLower === "https://savee.it" ||
      urlLower === "savee.it" ||
      urlLower === "https://savee.it/"
    ) {
      setSourceType("home");
    } else if (urlLower.includes("savee.it/")) {
      setSourceType("user");
    }
  }, [url]);

  // Fetch jobs data
  const fetchJobs = async () => {
    try {
      const response = await fetch("/api/engine/jobs");
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
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

  // Job control actions
  const controlJob = async (
    jobId: string,
    action: "pause" | "resume" | "run_now"
  ) => {
    try {
      const response = await fetch("/api/engine/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      if (response.ok) {
        fetchJobs();
      }
    } catch (error) {
      console.error("Job control error:", error);
    }
  };

  // Delete job
  const deleteJob = async (jobId: string) => {
    if (!deleteConfirm || deleteConfirm.jobId !== jobId) return;

    const job = jobs.find((j) => j.id === jobId);
    if (!job || deleteConfirm.confirmUrl !== job.url) {
      alert("URL confirmation does not match");
      return;
    }

    try {
      const response = await fetch(`/api/engine/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchJobs();
        setDeleteConfirm(null);
      }
    } catch (error) {
      console.error("Delete job error:", error);
    }
  };

  // Toggle job logs
  const toggleJobLogs = (jobId: string) => {
    const newExpanded = new Set(expandedJobs);
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId);
    } else {
      newExpanded.add(jobId);
      fetchJobLogs(jobId);
    }
    setExpandedJobs(newExpanded);
  };

  // Fetch job logs
  const fetchJobLogs = async (jobId: string) => {
    try {
      const response = await fetch(`/api/engine/logs?jobId=${jobId}`);
      if (response.ok) {
        const data = await response.json();
        setLogs((prev) => ({ ...prev, [jobId]: data.logs || [] }));
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
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

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scraping Engine</h1>
        <p className="text-gray-600">
          Manage and monitor your Savee.it scraping jobs
        </p>
      </div>

      {/* Add New Job Form */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !url.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md font-medium"
          >
            {isSubmitting ? "Adding Job..." : "Add Job"}
          </button>
        </form>
      </div>

      {/* Jobs List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Jobs ({jobs.length})</h2>
        </div>

        {jobs.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No jobs yet. Add your first job above.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {jobs.map((job) => (
              <div key={job.id} className="p-6">
                {/* Job Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}
                      >
                        {job.status.toUpperCase()}
                      </span>
                      <span className="text-sm text-gray-600">
                        {getSourceTypeDisplay(job.sourceType, job.username)}
                      </span>
                    </div>
                    <div className="text-sm font-mono text-gray-800">
                      {job.url}
                    </div>
                  </div>

                  {/* Job Controls */}
                  <div className="flex items-center gap-2">
                    {/* Pause/Resume */}
                    {job.status === "active" && (
                      <button
                        onClick={() => controlJob(job.id, "pause")}
                        className="text-yellow-600 hover:text-yellow-700 text-sm"
                      >
                        Pause
                      </button>
                    )}
                    {job.status === "paused" && (
                      <button
                        onClick={() => controlJob(job.id, "resume")}
                        className="text-green-600 hover:text-green-700 text-sm"
                      >
                        Resume
                      </button>
                    )}

                    {/* Run Now */}
                    {job.status === "active" && (
                      <button
                        onClick={() => controlJob(job.id, "run_now")}
                        className="text-blue-600 hover:text-blue-700 text-sm"
                      >
                        Run Now
                      </button>
                    )}

                    {/* Info Tooltip */}
                    <button
                      title={`Last run: ${job.lastRun || "Never"}\\nNext run: ${job.nextRun || "N/A"}`}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ℹ️
                    </button>

                    {/* Edit (only if paused) */}
                    {job.status === "paused" && (
                      <button
                        onClick={() => setEditingJob(job.id)}
                        className="text-gray-600 hover:text-gray-700 text-sm"
                      >
                        Edit
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() =>
                        setDeleteConfirm({ jobId: job.id, confirmUrl: "" })
                      }
                      className="text-red-600 hover:text-red-700 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Counters */}
                <div className="flex items-center gap-6 mb-4 text-sm">
                  <span className="text-green-600">
                    <strong>{job.counters.uploaded}</strong> uploaded
                  </span>
                  <span className="text-blue-600">
                    <strong>{job.counters.found}</strong> found
                  </span>
                  {job.counters.errors > 0 && (
                    <span className="text-red-600">
                      <strong>{job.counters.errors}</strong> errors
                    </span>
                  )}
                  <span className="text-gray-600">
                    Max: <strong>{job.maxItems}</strong>
                  </span>
                </div>

                {/* Error Message */}
                {job.status === "error" && job.error && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                    <div className="text-red-800 text-sm font-medium">
                      Error:
                    </div>
                    <div className="text-red-700 text-sm">{job.error}</div>
                  </div>
                )}

                {/* Logs Toggle */}
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

                {/* Logs Content */}
                {expandedJobs.has(job.id) && (
                  <div className="mt-4 bg-gray-50 rounded-md p-4 max-h-64 overflow-y-auto">
                    <div className="font-mono text-xs space-y-1">
                      {logs[job.id]?.length ? (
                        logs[job.id].map((log, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-gray-500">
                              {log.timestamp}
                            </span>
                            <span
                              className={`${log.type === "ERROR" ? "text-red-600" : "text-gray-700"}`}
                            >
                              [{log.type}] {log.message || log.url}
                            </span>
                            {log.status && (
                              <span
                                className={
                                  log.status === "✓"
                                    ? "text-green-600"
                                    : "text-red-600"
                                }
                              >
                                {log.status}
                              </span>
                            )}
                            {log.timing && (
                              <span className="text-blue-600">
                                ⏱: {log.timing}
                              </span>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-gray-500">No logs available</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
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
            <div className="flex gap-3">
              <button
                onClick={() => deleteJob(deleteConfirm.jobId)}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md"
              >
                Delete
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
    </div>
  );
}
