# RemoteReady HQ Scrapers

Python + Playwright scraper that pulls remote job listings and upserts them into the Supabase `jobs` table.

## Setup

```bash
cd scrapers
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

Credentials (from `scrapers/.env`, root `.env.local`, or GitHub Secrets):

| Variable | Required | Purpose |
|---|---|---|
| `PROJECT_ID_URL` | yes | Builds `https://{PROJECT_ID_URL}.supabase.co` |
| `SECRET_KEYS` | yes | Server-side supabase-py writes |
| `PUBLISHABLE_KEY` | optional | Logged in preflight; not used for inserts |

Optional volume floors (fail the run if missed after dedupe):

- `SCRAPER_TARGET_MIN` (default `120`)
- `SCRAPER_SUPPORT_MIN` (default `30`)
- `SCRAPER_SALES_MIN` (default `30`)

## Run

```bash
python scrape_jobs.py
```

## Behavior

1. Preflight: print config status (no secret values), DNS/HTTPS reachability, `SECRET_KEYS` auth probe
2. Fetch Jobicy / Remotive / RemoteOK / Arbeitnow (retries HTTP 429/503 with backoff)
3. Normalize apply URLs, dedupe, upsert with `ignore_duplicates`
4. Enforce volume floors; print RUN SUMMARY
5. Exit `0` on success; exit `1` with stack traces on failure
