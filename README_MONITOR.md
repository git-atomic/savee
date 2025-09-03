# Engine Monitor Ops

## Workflow

- `.github/workflows/monitor.yml` runs every 5 minutes (cron) or on manual dispatch.
- It POSTs your CMS monitor endpoint with a Bearer token.
- Optional input `backfill=true` to run deeper sweeps.

## Required Secrets

- `MONITOR_URL`: Full URL to your CMS monitor endpoint, e.g.
  - `https://your-cms-domain.com/api/engine/monitor`
- `ENGINE_MONITOR_TOKEN`: Token that must match the CMS env `ENGINE_MONITOR_TOKEN`.
- Optional: `SLACK_WEBHOOK_URL` to receive failure notifications.

## CMS Env

- `ENGINE_MONITOR_TOKEN`: must match GH secret.
- `MONITOR_MIN_INTERVAL_SECONDS`, `MONITOR_MAX_INTERVAL_SECONDS`, `MONITOR_MAX_PARALLEL`.
- New-only tuning:
  - `STOP_ON_FIRST_OLD` (true for scheduled runs)
  - `MIN_NEW_BEFORE_BREAK` (default 1)
  - `ONLY_OLD_EXIT_STREAK` (default 8)
  - `PROBE_MIN_ITEMS` (default 48)

## Local Test

- `curl -H "Authorization: Bearer $ENGINE_MONITOR_TOKEN" -X POST http://localhost:3000/api/engine/monitor`
- `curl -H "Authorization: Bearer $ENGINE_MONITOR_TOKEN" -X POST "http://localhost:3000/api/engine/monitor?backfill=true"`

## Prod Notes

- Ensure `DATABASE_URL` and `R2_*` are set in CMS.
- Review `runs` table and the Admin Engine view for status and logs.

---

## Alternative: Always‑on free runner (no GitHub Actions)

You can run an always‑on lightweight runner that polls the CMS for pending runs and executes them.

### Option A: Fly.io lite VM (free)

1. Create a tiny VM/app (or Docker) and install Python 3.11
2. Install deps for the worker and Playwright:
   ```bash
   pip install -r apps/worker/requirements.txt
   python -m playwright install --with-deps chromium
   ```
3. Set env vars:
   - CMS_URL=https://your-cms-domain.com
   - ENGINE_MONITOR_TOKEN=...
   - DATABASE_URL=...
   - R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
   - COOKIES_JSON (single line) or COOKIES_PATH
4. Start the runner:
   ```bash
   python -m apps.worker.runner
   ```

### Option B: Oracle Always Free / any Linux VM

Same steps as above. Use systemd or pm2 to keep it alive.

This gives you production‑style, always‑on execution without CI scheduler limits.
