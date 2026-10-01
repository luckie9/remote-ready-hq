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
- `SUPABASE_SECRET_KEY` (preferred for inserts) or publishable key if RLS allows

## Run

```bash
python scrape_jobs.py
```

Optional: `SCRAPER_MAX_LISTINGS=20 python scrape_jobs.py`

## Database schema

If tables are missing, run `schema.sql` in the Supabase SQL editor first.

## Behavior

1. Uses Playwright request context against Remotive (all major categories) + RemoteOK
   (Remotive’s free API returns a small shared set; RemoteOK expands volume to 100+)
2. Extracts title, company, location, salary, description, apply URL
3. Deduplicates in-memory and against existing `jobs.apply_url` rows
4. Inserts only new rows into Supabase
