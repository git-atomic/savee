"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ModeToggle } from "@/components/ModeToggle";
import { cn } from "@/lib/utils";

export default function EngineSandbox() {
  const [val, setVal] = React.useState("");
  const [checked, setChecked] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  // Demo request rows (table view)
  const requests = React.useMemo(
    () => [
      {
        at: "2025-09-13T20:45:15.840Z",
        method: "POST",
        status: 200,
        host: "visualcms.vercel.app",
        path: "/api/engine/logs",
        msg: "",
      },
      {
        at: "2025-09-13T20:45:14.140Z",
        method: "POST",
        status: 200,
        host: "visualcms.vercel.app",
        path: "/api/engine/logs",
        msg: "",
      },
      {
        at: "2025-09-13T20:45:10.390Z",
        method: "POST",
        status: 200,
        host: "visualcms.vercel.app",
        path: "/api/engine/logs",
        msg: "",
      },
      {
        at: "2025-09-13T20:45:09.610Z",
        method: "POST",
        status: 200,
        host: "visualcms.vercel.app",
        path: "/api/engine/logs",
        msg: "",
      },
      {
        at: "2025-09-13T20:45:08.850Z",
        method: "POST",
        status: 200,
        host: "visualcms.vercel.app",
        path: "/api/engine/logs",
        msg: "",
      },
      {
        at: "2025-09-13T20:45:08.090Z",
        method: "POST",
        status: 200,
        host: "visualcms.vercel.app",
        path: "/api/engine/logs",
        msg: "",
      },
    ],
    []
  );

  // Demo engine events (merged into Requests table)
  const engineEvents = React.useMemo(
    () => [
      {
        at: "2025-09-13T21:41:44.000Z",
        stage: "STARTING",
        url: "https://savee.com",
        status: "pending",
      },
      {
        at: "2025-09-13T21:41:45.000Z",
        stage: "STARTING",
        url: "https://savee.com",
        status: "done",
      },
      {
        at: "2025-09-13T21:42:43.000Z",
        stage: "FETCH",
        url: "https://savee.com/i/DPyi737",
        status: "pending",
      },
      {
        at: "2025-09-13T21:42:44.000Z",
        stage: "FETCH",
        url: "https://savee.com/i/DPyi737",
        status: "done",
        duration: "2.30s",
      },
      {
        at: "2025-09-13T21:42:45.000Z",
        stage: "SCRAPE",
        url: "https://savee.com/i/DPyi737",
        status: "pending",
      },
      {
        at: "2025-09-13T21:42:46.000Z",
        stage: "SCRAPE",
        url: "https://savee.com/i/DPyi737",
        status: "done",
        duration: "0.83s",
      },
      {
        at: "2025-09-13T21:42:47.000Z",
        stage: "COMPLETE",
        url: "https://savee.com/i/DPyi737",
        status: "pending",
      },
      {
        at: "2025-09-13T21:42:53.000Z",
        stage: "COMPLETE",
        url: "https://savee.com/i/DPyi737",
        status: "done",
        duration: "5.96s",
      },
      {
        at: "2025-09-13T21:42:55.000Z",
        stage: "COMPLETE",
        url: "https://savee.com/i/DPyi737",
        status: "done",
        duration: "12.76s",
      },
      {
        at: "2025-09-13T21:42:55.000Z",
        stage: "WRITE/UPLOAD",
        url: "https://savee.com/i/DPyi737",
        status: "done",
        duration: "1.00s",
      },
    ],
    []
  );

  const formatTimeLabel = React.useCallback((iso: string) => {
    const d = new Date(iso);
    const months = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const ms2 = String(Math.floor(d.getUTCMilliseconds() / 10)).padStart(
      2,
      "0"
    );
    return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}.${ms2}`;
  }, []);
  const stageStyles: Record<string, string> = React.useMemo(
    () => ({
      STARTING: "bg-muted text-muted-foreground border-border",
      FETCH: "bg-blue-500/15 text-blue-400 border-blue-500/30",
      SCRAPE: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      COMPLETE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      "WRITE/UPLOAD": "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    }),
    []
  );
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground p-6 transition-colors">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Engine Sandbox</h1>
            <ModeToggle />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Form Elements</CardTitle>
              <CardDescription>Input, Select, Switch, Checkbox</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="input">Input</Label>
                <Input
                  id="input"
                  placeholder="Type something"
                  value={val}
                  onChange={(e) => setVal(e.currentTarget.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="select">Select</Label>
                  <Select>
                    <SelectTrigger id="select">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a">Option A</SelectItem>
                      <SelectItem value="b">Option B</SelectItem>
                      <SelectItem value="c">Option C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="switch"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                  <Label htmlFor="switch">Enable feature</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="check"
                    checked={checked}
                    onCheckedChange={(v) => setChecked(Boolean(v))}
                  />
                  <Label htmlFor="check">Accept terms</Label>
                </div>
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => toast.success("Submitted!")}>
                      Submit
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Show a success toast</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  This is a popover. It can hold content.
                </PopoverContent>
              </Popover>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button variant="secondary">Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm action</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    This is a dialog using shadcn styles.
                  </p>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        setOpen(false);
                        toast("Done");
                      }}
                    >
                      Continue
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardFooter>
          </Card>

          <Separator />

          {/* Unified Engine Activity (Requests-style) */}
          <Card>
            <CardHeader>
              <CardTitle>Engine Activity</CardTitle>
              <CardDescription>Stages, URLs and durations</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion
                type="single"
                collapsible
                defaultValue="engine-activity"
              >
                <AccordionItem value="engine-activity">
                  <AccordionTrigger>Show latest</AccordionTrigger>
                  <AccordionContent>
                    <TooltipProvider>
                      <ScrollArea className="h-56 w-full rounded-md border">
                        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
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
                            {engineEvents.map((row, i) => {
                              const statusIcon =
                                row.status === "done" ? "✓" : "⏳";
                              return (
                                <TableRow
                                  key={i}
                                  className="hover:bg-transparent"
                                >
                                  <TableCell>
                                    <time
                                      dateTime={row.at}
                                      className="font-mono text-xs text-muted-foreground"
                                    >
                                      {formatTimeLabel(row.at)}
                                    </time>
                                  </TableCell>
                                  <TableCell>
                                    <span
                                      className={cn(
                                        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold",
                                        stageStyles[row.stage] ||
                                          "bg-muted text-foreground/80 border-border"
                                      )}
                                    >
                                      {row.stage}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <code
                                          className="font-mono text-sm text-muted-foreground block max-w-[420px] truncate"
                                          title={row.url}
                                        >
                                          {row.url}
                                        </code>
                                      </TooltipTrigger>
                                      <TooltipContent>{row.url}</TooltipContent>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {statusIcon}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {row.duration || "—"}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </TooltipProvider>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Table + Badge</CardTitle>
                <CardDescription>Mini data table</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { id: 1, status: "ok", msg: "Processed" },
                      { id: 2, status: "warn", msg: "Slow" },
                      { id: 3, status: "error", msg: "Failed" },
                    ].map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.id}</TableCell>
                        <TableCell>
                          {r.status === "ok" && <Badge>OK</Badge>}
                          {r.status === "warn" && (
                            <Badge variant="secondary">WARN</Badge>
                          )}
                          {r.status === "error" && (
                            <Badge variant="destructive">ERROR</Badge>
                          )}
                        </TableCell>
                        <TableCell>{r.msg}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Skeletons</CardTitle>
              <CardDescription>Loading placeholders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                onClick={() => {
                  setLoading(true);
                  setTimeout(() => setLoading(false), 1200);
                }}
              >
                Toggle Loading
              </Button>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No loading right now.
                </p>
              )}
            </CardContent>
          </Card>

          <Toaster richColors position="bottom-right" />
        </div>
      </div>
    </ThemeProvider>
  );
}
