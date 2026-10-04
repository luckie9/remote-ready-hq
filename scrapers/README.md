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

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` — server-side inserts via supabase-py (required for writes)
- `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser/client-safe only

## Run

```bash
python scrape_jobs.py
```

Optional: `SCRAPER_MAX_LISTINGS=20 python scrape_jobs.py`

## Database schema

If tables are missing, run `schema.sql` in the Supabase SQL editor first.

## Behavior

1. Uses Playwright request context against Jobicy / Remotive / RemoteOK / Arbeitnow
2. Normalizes apply URLs (https, host case, strip tracking params) before dedupe
3. Deduplicates in-memory and against existing `jobs.apply_url` rows
4. Upserts with `ignore_duplicates` (fails the run if existing-key fetch or writes fail)
5. Prints a RUN SUMMARY (`fetched` / `deduplicated` / `skipped` / `inserted` / `failed`)
6. Exits non-zero on credential, DB, or critical failures (CI fail-closed)
