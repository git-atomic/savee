import json
import os
import subprocess as sp
import sys


def main() -> int:
    resp_path = "/tmp/resp.json"
    if not os.path.exists(resp_path):
        print("No /tmp/resp.json found")
        return 0
    with open(resp_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    runs = data.get("startedDetails") or []
    if not runs:
        print("No runs to execute")
        return 0
    for r in runs:
        url = r.get("url")
        run_id = str(r.get("runId"))
        max_items = r.get("maxItems") or 0
        print("running:", run_id, url, max_items)
        code = sp.call([
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
        if code != 0:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


