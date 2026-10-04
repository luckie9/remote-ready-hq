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

Credentials are loaded from `scrapers/.env` or the project root `.env.local`:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` (**required** — no hardcoded default)
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` (**required** for writes)

Optional volume floors (fail the run if missed after dedupe):

- `SCRAPER_TARGET_MIN` (default `120`)
- `SCRAPER_SUPPORT_MIN` (default `30`)
- `SCRAPER_SALES_MIN` (default `30`)

## Run

```bash
python scrape_jobs.py
```

## Database schema

If tables are missing, run `schema.sql` in the Supabase SQL editor first.

## Behavior

1. Fetches Jobicy / Remotive / RemoteOK / Arbeitnow JSON APIs (retries HTTP 429/503 with backoff)
2. Normalizes apply URLs before dedupe
3. Deduplicates in-memory and against existing `jobs.apply_url` rows
4. Upserts with `ignore_duplicates` (fails if existing-key fetch or writes fail)
5. Enforces volume floors (`SCRAPER_*_MIN`)
6. Prints a RUN SUMMARY and exits non-zero on credential / DB / volume failures
