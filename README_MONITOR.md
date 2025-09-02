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
- Monitor runs will spawn workers on the CMS host.
- Review `runs` table and the Admin Engine view for status and logs.
