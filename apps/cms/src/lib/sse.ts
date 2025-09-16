// Simple in-memory SSE hub keyed by runId
// Works within a single Next.js server instance

type Subscriber = {
  id: string;
  send: (payload: string) => void;
  close: () => void;
};

const runIdToSubs = new Map<string, Set<Subscriber>>();

function ensureSet(runId: string): Set<Subscriber> {
  let s = runIdToSubs.get(runId);
  if (!s) {
    s = new Set();
    runIdToSubs.set(runId, s);
  }
  return s;
}

export function subscribe(runId: string, sub: Subscriber) {
  ensureSet(runId).add(sub);
  return () => {
    try {
      ensureSet(runId).delete(sub);
    } catch {}
  };
}

export function publish(runId: string, event: string, data: unknown) {
  const subs = runIdToSubs.get(runId);
  if (!subs || subs.size === 0) return;
  const json = JSON.stringify(data ?? {});
  const payload = `event: ${event}\n` + `data: ${json}\n\n`;
  for (const sub of subs) {
    try {
      sub.send(payload);
    } catch {
      /* ignore broken pipes */
    }
  }
}

export function createSSEStream(runId: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const sub: Subscriber = {
        id: Math.random().toString(36).slice(2),
        send,
        close: () => {
          try {
            controller.close();
          } catch {}
        },
      };
      const unsub = subscribe(runId, sub);

      // Initial comment and hello
      send(`: connected to run ${runId}\n\n`);
      send(`event: hello\n` + `data: {"ok":true}\n\n`);

      const hb = setInterval(() => {
        try {
          send(`event: heartbeat\n` + `data: {"t":${Date.now()}}\n\n`);
        } catch {}
      }, 15000);

      // Cleanup when stream is cancelled
      // Note: cancel() receives a reason, but we just cleanup
      (controller as any).signal?.addEventListener?.("abort", () => {
        clearInterval(hb);
        unsub();
      });
    },
    cancel() {
      // no-op; handled above
    },
  });
  return stream;
}



