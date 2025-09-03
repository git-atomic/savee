import os
import sys
import time
import json
import subprocess
from typing import Any, Dict, List


CMS_URL = os.getenv("CMS_URL", "").rstrip("/")
ENGINE_MONITOR_TOKEN = os.getenv("ENGINE_MONITOR_TOKEN") or os.getenv("ENGINE_MONITOR_BEARER")
POLL_INTERVAL_SEC = int(os.getenv("RUNNER_POLL_INTERVAL_SEC", "20"))
MAX_PARALLEL = int(os.getenv("RUNNER_MAX_PARALLEL", os.getenv("JOB_CONCURRENCY", "2")))


def _log(msg: str) -> None:
    print(f"[runner] {msg}", flush=True)


def _fetch_pending() -> List[Dict[str, Any]]:
    if not CMS_URL:
        _log("CMS_URL not set; nothing to do")
        return []
    import urllib.request
    import urllib.error

    url = f"{CMS_URL}/api/engine/pending"
    if ENGINE_MONITOR_TOKEN:
        url = f"{url}?token={ENGINE_MONITOR_TOKEN}"
    req = urllib.request.Request(url)
    if ENGINE_MONITOR_TOKEN:
        req.add_header("Authorization", f"Bearer {ENGINE_MONITOR_TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("pending") or []
    except urllib.error.HTTPError as e:
        _log(f"pending HTTPError {e.code}")
    except Exception as e:
        _log(f"pending error: {e}")
    return []


def _run_job(run: Dict[str, Any]) -> int:
    url = run.get("url")
    run_id = str(run.get("runId"))
    max_items = str(run.get("maxItems") or 0)
    if not url or not run_id:
        return 0
    _log(f"running runId={run_id} url={url} max={max_items}")
    return subprocess.call(
        [
            sys.executable,
            "-m",
            "app.cli",
            "--start-url",
            url,
            "--max-items",
            max_items,
            "--run-id",
            run_id,
        ]
    )


def main() -> int:
    _log("runner starting")
    if not CMS_URL:
        _log("CMS_URL is required")
        return 1
    while True:
        runs = _fetch_pending()
        if runs:
            # Execute sequentially or with basic parallel cap
            # For simplicity and lower memory footprint, run sequentially here
            for r in runs[:MAX_PARALLEL]:
                code = _run_job(r)
                if code != 0:
                    _log(f"job failed with code {code}")
                    # continue to next, do not exit
        else:
            _log("no pending runs; sleeping")
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    raise SystemExit(main())


