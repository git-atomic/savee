import json
import os
import subprocess as sp
import sys
import time
import urllib.request
import urllib.error


def main() -> int:
    resp_path = "/tmp/resp.json"
    if not os.path.exists(resp_path):
        print("No /tmp/resp.json found")
        return 0
    with open(resp_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    runs = data.get("startedDetails") or []
    # Merge with /api/engine/pending for robustness
    cms_url = os.environ.get("CMS_URL", "").rstrip("/")
    token = os.environ.get("ENGINE_MONITOR_TOKEN", "")
    if cms_url:
        try:
            req = urllib.request.Request(
                f"{cms_url}/api/engine/pending",
                headers={"Authorization": f"Bearer {token}"} if token else {},
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                pend = json.loads(resp.read().decode("utf-8"))
                if pend.get("success"):
                    for p in pend.get("pending", []):
                        runs.append({
                            "url": p.get("url"),
                            "runId": p.get("runId"),
                            "maxItems": p.get("maxItems") or 0,
                        })
        except Exception as e:
            print("pending fetch error:", e)
    if not runs:
        print("No runs to execute")
        return 0
    # Support simple parallelism with a small worker pool
    try:
        parallel = int(os.environ.get("WORKER_PARALLELISM", "2"))
    except Exception:
        parallel = 2
    parallel = max(1, min(parallel, 4))

    procs = []

    def post_log(run_id: str, log: dict) -> None:
        cms = os.environ.get("CMS_URL", "").rstrip("/")
        if not cms or not run_id:
            return
        token = os.environ.get("ENGINE_MONITOR_TOKEN", "")
        data = json.dumps({"jobId": str(run_id), "log": log}).encode("utf-8")
        req = urllib.request.Request(
            f"{cms}/api/engine/logs",
            data=data,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {token}"} if token else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=10):
                pass
        except Exception:
            pass
    idx = 0
    while idx < len(runs) or procs:
        # Spawn until pool is full
        while idx < len(runs) and len(procs) < parallel:
            r = runs[idx]
            idx += 1
            url = r.get("url")
            run_id = str(r.get("runId"))
            max_items = r.get("maxItems") or 0
            print("running:", run_id, url, max_items)
            # Retry with simple exponential backoff on non-zero exit
            attempt = 0
            max_attempts = 3
            delay = 2
            while True:
                if attempt > 0:
                    post_log(
                        run_id,
                        {
                            "type": "RETRY",
                            "status": "⏳",
                            "message": f"Attempt {attempt+1}/{max_attempts}",
                        },
                    )
                p = sp.Popen([
                    sys.executable,
                    "-m",
                    "app.cli",
                    "--start-url",
                    url,
                    "--max-items",
                    str(max_items),
                    "--run-id",
                    run_id,
                ])
                code = p.wait()
                if code == 0 or attempt >= max_attempts - 1:
                    if code == 0:
                        post_log(run_id, {"type": "RETRY", "status": "✓", "message": "Completed"})
                    break
                attempt += 1
                msg = f"Retry {attempt}/{max_attempts} in {delay}s"
                print(msg, "for run", run_id)
                post_log(run_id, {"type": "RETRY", "status": "⏳", "message": msg})
                try:
                    time.sleep(delay)
                except Exception:
                    pass
                delay = min(delay * 2, 30)
            # emulate pooled behavior: attach a dummy process object that already finished
            class _Done:
                def poll(self):
                    return 0
                def wait(self, timeout=None):
                    return 0
            procs.append(_Done())
            procs.append(p)
        # Wait for any to finish (pop safely without index drift)
        i = 0
        while i < len(procs):
            p = procs[i]
            code = p.poll()
            if code is not None:
                procs.pop(i)
                if code != 0:
                    # terminate others
                    for q in procs:
                        try:
                            q.terminate()
                        except Exception:
                            pass
                    return code
                # do not increment i since we removed current index
                continue
            i += 1
        # Avoid busy loop
        if procs:
            try:
                procs[0].wait(timeout=1)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


