#!/usr/bin/env python3
"""
RemoteReady HQ job scraper (Playwright).

Priority: Support, Sales, Marketing, Operations (+ Remotive/RemoteOK/Jobicy).
Stamps rrhq_category into description for accurate frontend pill counts.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env.local")

# Live project host that resolves in DNS (typo refs like ujhsltihinwuysikzvhs do not).
_DEFAULT_SUPABASE_URL = "https://ujhsltlhlnwuysikzvhs.supabase.co"


def _sanitize_url(raw: str | None) -> str:
    value = (raw or "").strip().strip("'").strip('"')
    if not value:
        return _DEFAULT_SUPABASE_URL
    if not re.match(r"^https?://", value, flags=re.I):
        value = "https://" + value.lstrip("/")
    if value.lower().startswith("http://"):
        value = "https://" + value[7:]
    value = value.rstrip("/")
    host = urlparse(value).netloc.lower()
    # Rewrite known non-resolving typo hosts from CI secrets / older hardcodes
    if host in {
        "ujhsltihinwuysikzvhs.supabase.co",
        "ujhsltlhinwuysikzvhs.supabase.co",
    }:
        return _DEFAULT_SUPABASE_URL
    return value


def _env_first(*names: str) -> str:
    """First non-empty stripped env value among names."""
    for name in names:
        value = os.environ.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


# URL + key resolution at import.
# ANON_KEY: browser / Playwright / client-side only (never for privileged writes).
# SECRET_KEY: server-side Python SDK inserts only (never send with a browser UA).
SUPABASE_URL = _sanitize_url(
    _env_first("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") or None
)
ANON_KEY = _env_first("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")
SECRET_KEY = _env_first("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY")

print(
    f"[scraper] Supabase Client Initialized: URL={SUPABASE_URL}, "
    f"Anon Present={bool(ANON_KEY)}, Secret Present={bool(SECRET_KEY)} "
    f"(secret_len={len(SECRET_KEY)})",
    flush=True,
)


def _log(msg: str) -> None:
    """Stdout logger (unbuffered in CI via PYTHONUNBUFFERED=1)."""
    print(msg, flush=True)


def _log_err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _env_str(*names: str, default: str = "") -> str:
    """First non-empty env var among names (GitHub Actions often sets unset vars to '')."""
    for name in names:
        value = os.environ.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        _log_err(f"[scraper] WARNING: invalid {name}={raw!r}; using default {default}")
        return default


# Re-read from os.environ at runtime (handles empty CI vars safely)
TARGET_MIN = _env_int("SCRAPER_TARGET_MIN", 120)
SUPPORT_MIN = _env_int("SCRAPER_SUPPORT_MIN", 30)
SALES_MIN = _env_int("SCRAPER_SALES_MIN", 30)

REMOTIVE_PRIORITY = [
    ("customer-support", "Support"),
    ("sales", "Sales"),
    ("marketing", "Marketing"),
    ("devops", "Engineering"),
    ("software-dev", "Engineering"),
    ("product", "Product"),
    ("design", "Design"),
    ("human-resources", "Operations"),
    ("finance-legal", "Operations"),
]

JOBICY_PRIORITY = [
    ("support", "Support"),
    ("sales", "Sales"),
    ("marketing", "Marketing"),
    ("operations", "Operations"),
    ("helpdesk", "Support"),
    ("business-development", "Sales"),
]

REMOTEOK_PATHS = [
    ("remote-customer-support-jobs.json", "Support"),
    ("remote-sales-jobs.json", "Sales"),
]

SALES_TITLE = re.compile(
    r"\b(sales|account executive|account manager|sdr|bdr|business development|"
    r"revenue|closer|quota|go[- ]to[- ]market|gtm)\b",
    re.I,
)
SUPPORT_TITLE = re.compile(
    r"\b(support|customer success|customer service|help ?desk|service desk|"
    r"technical support|cx |client success|care specialist|onsite support)\b",
    re.I,
)
MARKETING_TITLE = re.compile(
    r"\b(marketing|copywriter|content|seo|growth|social media|brand manager)\b",
    re.I,
)
OPS_TITLE = re.compile(
    r"\b(operations|ops|coordinator|specialist|assistant|recruiter|people|hr)\b",
    re.I,
)


# Tracking / noise query params stripped during apply_url normalization.
_TRACKING_PARAMS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "ref_src",
    }
)


@dataclass(frozen=True)
class JobListing:
    title: str
    company: str
    location: str
    salary_range: str | None
    description: str
    apply_url: str
    category: str  # Support | Sales | Marketing | Operations | Engineering | Design | Product

    def fingerprint(self) -> str:
        raw = (
            f"{self.title.strip().lower()}|"
            f"{self.company.strip().lower()}|"
            f"{self.apply_url.strip().lower()}"
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class RunStats:
    """Counters for the structured end-of-run summary."""

    fetched: int = 0
    deduplicated: int = 0
    skipped: int = 0
    inserted: int = 0
    failed: int = 0
    critical_error: str | None = None

    @property
    def ok(self) -> bool:
        return self.critical_error is None and self.failed == 0


@dataclass
class WriteResult:
    inserted: int
    skipped: int
    failed: int


class ExistingKeysFetchError(RuntimeError):
    """Raised when the existing apply_url preload cannot be completed safely."""


class CredentialError(RuntimeError):
    """Raised when Supabase URL/secret are missing or fail a connectivity probe."""


def normalize_whitespace(text: str | None) -> str:
    if not text:
        return ""
    no_tags = re.sub(r"<[^>]+>", " ", str(text))
    return re.sub(r"\s+", " ", no_tags).strip()


def strip_description_boilerplate(text: str) -> str:
    """Drop GDPR / board spam / recruiter disclaimers from the tail."""
    cutters = [
        r"(?i)Why Apply Through Jobgether\??",
        r"(?i)How Jobgether works\s*:",
        r"(?i)Data Privacy Notice\s*:",
        r"(?i)By submitting your application, you acknowledge that Jobgether",
        r"(?i)This processing is based on legitimate interest",
        r"(?i)Find more .+ Jobs (?:in .+ )?on Arbeitnow",
        r"#LI-[A-Z0-9-]+\b",
        r"(?i)Please note that we will never request payment or bank account information",
    ]
    out = text
    for pattern in cutters:
        m = re.search(pattern, out)
        if m:
            out = out[: m.start()].rstrip(" .,\n\t")
    out = re.sub(
        r"(?i)\s*You may exercise your rights[\s\S]*$",
        "",
        out,
    )
    return out.strip()


def normalize_description(text: str | None) -> str:
    """Preserve paragraph / list structure instead of collapsing to one line."""
    if not text:
        return ""
    raw = str(text)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|h[1-6]|tr)>", "\n\n", raw)
    raw = re.sub(r"(?i)</li>", "\n", raw)
    raw = re.sub(r"(?i)<li[^>]*>", "• ", raw)
    raw = re.sub(r"(?i)<h[1-6][^>]*>", "\n\n", raw)
    raw = re.sub(r"(?i)</h[1-6]>", "\n", raw)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = (
        raw.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    raw = strip_description_boilerplate(raw)
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r" *\n *", "\n", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def repair_char_joined_location(text: str) -> str:
    """Undo ', '.join(string) artifacts like 'S, w, i, t, z, e, r, l, a, n, d'."""
    parts = text.split(", ")
    if len(parts) < 4:
        return text
    single_ratio = sum(1 for p in parts if len(p) <= 1) / len(parts)
    if single_ratio < 0.8:
        return text
    return "".join(parts)


def normalize_location(location: object | None) -> str:
    if location is None:
        return "Worldwide / Remote"
    if isinstance(location, (list, tuple)):
        parts = [normalize_whitespace(str(x)) for x in location if x]
        text = ", ".join(parts)
    else:
        text = normalize_whitespace(str(location))
    text = repair_char_joined_location(text)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r",\s*", ", ", text)
    text = re.sub(r"^(?:,\s*)+|(?:,\s*)+$", "", text).strip()
    return text or "Worldwide / Remote"


def infer_category(title: str, fallback: str) -> str:
    if SUPPORT_TITLE.search(title):
        return "Support"
    if SALES_TITLE.search(title):
        return "Sales"
    if MARKETING_TITLE.search(title):
        return "Marketing"
    if OPS_TITLE.search(title):
        return "Operations"
    return fallback


def stamp_description(description: str, category: str) -> str:
    body = normalize_description(description)[:4_800]
    return f"rrhq_category:{category}\n{body}"


def normalize_apply_url(raw: str | None) -> str:
    """
    Canonicalize apply URLs for dedupe + DB uniqueness.
    - https scheme, lowercased host
    - strip fragment, trailing slash, common tracking params
    - reject empty / relative paths
    """
    value = (raw or "").strip()
    if not value or value.startswith("/"):
        return ""
    if not re.match(r"^https?://", value, flags=re.I):
        value = "https://" + value.lstrip("/")
    try:
        parsed = urlparse(value)
    except Exception:
        return ""
    if not parsed.netloc:
        return ""
    scheme = "https"
    netloc = parsed.netloc.lower()
    path = (parsed.path or "").rstrip("/")
    kept = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    kept.sort(key=lambda kv: (kv[0].lower(), kv[1]))
    query = urlencode(kept, doseq=True)
    return urlunparse((scheme, netloc, path, "", query, ""))


BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
BROWSER_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

def refresh_supabase_credentials() -> tuple[str, str, str]:
    """Re-read env so late-exported CI vars are picked up. Returns (url, anon, secret)."""
    global SUPABASE_URL, ANON_KEY, SECRET_KEY
    SUPABASE_URL = _sanitize_url(
        _env_first("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") or None
    )
    ANON_KEY = _env_first("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")
    # Prefer SUPABASE_SECRET_KEY; allow legacy service_role secret name in CI.
    SECRET_KEY = _env_first("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    return SUPABASE_URL, ANON_KEY, SECRET_KEY


def supabase_available() -> bool:
    """Secret key present ⇒ treat backend writes as available."""
    url, _anon, secret = refresh_supabase_credentials()
    return bool(url and secret)


def _require_url_and_key(url: str, key: str, *, key_name: str) -> tuple[str, str]:
    """Ensure create_client gets two real non-empty strings."""
    url_s = (url or "").strip()
    key_s = (key or "").strip()
    if not url_s:
        raise ValueError("SUPABASE_URL is empty — cannot create Supabase client")
    if not key_s:
        raise ValueError(
            f"{key_name} is empty — cannot create Supabase client "
            "(expected a non-empty string)"
        )
    if not isinstance(url_s, str) or not isinstance(key_s, str):
        raise TypeError(
            f"create_client requires str url/key, got {type(url_s)!r} / {type(key_s)!r}"
        )
    return url_s, key_s


def get_supabase_admin() -> Client:
    """
    Server-side Supabase client for DB reads/writes.
    Uses SECRET_KEY only via supabase-py (httpx) — never Playwright / browser fetch.
    """
    url, _anon, secret = refresh_supabase_credentials()
    url, secret = _require_url_and_key(
        url, secret, key_name="SUPABASE_SECRET_KEY"
    )
    print(
        f"[scraper] Connecting to Supabase at: {url} "
        f"(supabase-py create_client + SECRET_KEY, key_len={len(secret)})",
        flush=True,
    )
    print(
        f"[scraper] Supabase Client Initialized: URL={url}, "
        f"Anon Present={bool(_anon)}, Secret Present={True}",
        flush=True,
    )
    # Keyword args avoid positional mistakes that raise:
    # Client.__init__() missing 1 required positional argument: 'supabase_key'
    return create_client(supabase_url=url, supabase_key=secret)


def get_supabase_anon() -> Client | None:
    """
    Publishable/anon client for any browser-safe reads.
    Playwright job scraping does not call Supabase; this exists so anon is never
    confused with SECRET_KEY if a client-side helper is added later.
    """
    url, anon, _secret = refresh_supabase_credentials()
    if not anon:
        return None
    url, anon = _require_url_and_key(url, anon, key_name="SUPABASE_ANON_KEY")
    return create_client(supabase_url=url, supabase_key=anon)


def probe_supabase(client: Client | None = None) -> Client:
    """Validate credentials with a lightweight authenticated read. Raises CredentialError."""
    try:
        db = client or get_supabase_admin()
        db.table("jobs").select("apply_url").limit(1).execute()
        return db
    except CredentialError:
        raise
    except Exception as e:
        raise CredentialError(
            f"Supabase credential/probe failed: {type(e).__name__}: {e}"
        ) from e


def make_listing(
    *,
    title: str,
    company: str,
    location: str,
    salary: str | None,
    description: str,
    apply_url: str,
    category: str,
) -> JobListing | None:
    title = normalize_whitespace(title)
    company = normalize_whitespace(company) or "Unknown"
    apply_url = normalize_apply_url(apply_url)
    if not title or not apply_url:
        return None
    cat = infer_category(title, category)
    return JobListing(
        title=title[:200],
        company=company[:120],
        location=normalize_location(location)[:120],
        salary_range=(salary[:80] if salary else None),
        description=stamp_description(description, cat),
        apply_url=apply_url[:1_000],
        category=cat,
    )


def parse_remotive(jobs_raw: list, fallback_cat: str) -> list[JobListing]:
    out: list[JobListing] = []
    for item in jobs_raw:
        salary = normalize_whitespace(item.get("salary")) or None
        listing = make_listing(
            title=item.get("title") or "",
            company=item.get("company_name") or "",
            location=normalize_location(
                item.get("candidate_required_location") or "Worldwide / Remote"
            ),
            salary=salary,
            description=item.get("description") or "",
            apply_url=item.get("url") or item.get("apply_url") or "",
            category=fallback_cat,
        )
        if listing:
            out.append(listing)
    return out


def parse_remoteok(rows: list, fallback_cat: str) -> list[JobListing]:
    out: list[JobListing] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        title = item.get("position") or item.get("title") or ""
        apply_url = (
            item.get("apply_url")
            or item.get("url")
            or (f"https://remoteok.com/remote-jobs/{item['id']}" if item.get("id") else "")
        )
        salary = None
        if item.get("salary_min") or item.get("salary_max"):
            lo = item.get("salary_min") or ""
            hi = item.get("salary_max") or ""
            salary = normalize_whitespace(f"${lo} - ${hi}".strip(" -"))
            if salary in ("$", ""):
                salary = None
        # Prefer tag-based category when present
        tags = " ".join(item.get("tags") or [])
        cat = fallback_cat
        if SUPPORT_TITLE.search(tags) or SUPPORT_TITLE.search(title):
            cat = "Support"
        elif SALES_TITLE.search(tags) or SALES_TITLE.search(title):
            cat = "Sales"
        listing = make_listing(
            title=title,
            company=item.get("company") or "",
            location=normalize_location(item.get("location") or "Worldwide / Remote"),
            salary=salary,
            description=item.get("description") or "",
            apply_url=str(apply_url),
            category=cat,
        )
        if listing:
            out.append(listing)
    return out


def parse_jobicy(jobs_raw: list, fallback_cat: str) -> list[JobListing]:
    out: list[JobListing] = []
    for item in jobs_raw:
        listing = make_listing(
            title=item.get("jobTitle") or item.get("title") or "",
            company=item.get("companyName") or item.get("company") or "",
            location=normalize_location(item.get("jobGeo") or "Worldwide / Remote"),
            salary=None,
            description=item.get("jobDescription") or item.get("jobExcerpt") or "",
            apply_url=item.get("url") or item.get("jobUrl") or "",
            category=fallback_cat,
        )
        if listing:
            out.append(listing)
    return out


def parse_arbeitnow(rows: list) -> list[JobListing]:
    out: list[JobListing] = []
    for item in rows:
        title = item.get("title") or ""
        # Only keep Support / Sales / Marketing / Ops to boost those pillars
        if SUPPORT_TITLE.search(title):
            cat = "Support"
        elif SALES_TITLE.search(title):
            cat = "Sales"
        elif MARKETING_TITLE.search(title):
            cat = "Marketing"
        elif OPS_TITLE.search(title):
            cat = "Operations"
        else:
            continue
        listing = make_listing(
            title=title,
            company=(item.get("company_name") or item.get("company") or "Unknown"),
            location=normalize_location(item.get("location")),
            salary=None,
            description=item.get("description") or "",
            apply_url=item.get("url") or "",
            category=cat,
        )
        if listing:
            out.append(listing)
    return out


def _fetch_source(
    context,
    label: str,
    url: str,
    parser,
) -> list[JobListing]:
    """Fetch one source; log and continue on network/parse failures."""
    try:
        _log(f"[scraper] Fetching target URL: {url}")
        res = context.request.get(
            url,
            timeout=60_000,
            headers=BROWSER_HEADERS,
        )
        if not res.ok:
            print(f"Error scraping target: HTTP {res.status} from {label}", flush=True)
            return []
        payload = res.json()
        parsed = parser(payload)
        _log(f"[scraper] Scraped {len(parsed)} jobs from {label}")
        return parsed
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        return []


def scrape_all() -> list[JobListing]:
    all_jobs: list[JobListing] = []
    _log("[scraper] Launching Playwright Chromium…")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=BROWSER_UA,
            locale="en-US",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "application/json,text/plain,*/*",
            },
        )
        try:
            # 1) Jobicy — high volume Support/Sales/Marketing/Ops
            for tag, cat in JOBICY_PRIORITY:
                url = f"https://jobicy.com/api/v2/remote-jobs?count=100&tag={tag}"
                all_jobs.extend(
                    _fetch_source(
                        context,
                        f"jobicy/{tag}",
                        url,
                        lambda data, c=cat: parse_jobicy(
                            (data or {}).get("jobs") or [], c
                        ),
                    )
                )

            # 2) Remotive priority categories
            for slug, cat in REMOTIVE_PRIORITY:
                url = f"https://remotive.com/api/remote-jobs?category={slug}"
                all_jobs.extend(
                    _fetch_source(
                        context,
                        f"remotive/{slug}",
                        url,
                        lambda data, c=cat: parse_remotive(
                            (data or {}).get("jobs") or [], c
                        ),
                    )
                )

            # 3) RemoteOK sales/support feeds
            for path, cat in REMOTEOK_PATHS:
                url = f"https://remoteok.com/{path}"
                all_jobs.extend(
                    _fetch_source(
                        context,
                        f"remoteok/{path}",
                        url,
                        lambda data, c=cat: parse_remoteok(
                            data if isinstance(data, list) else [], c
                        ),
                    )
                )

            # 4) RemoteOK general
            all_jobs.extend(
                _fetch_source(
                    context,
                    "remoteok/api",
                    "https://remoteok.com/api",
                    lambda data: parse_remoteok(
                        data if isinstance(data, list) else [], "Engineering"
                    ),
                )
            )

            # 5) Arbeitnow — filter to Support/Sales/Marketing/Ops
            all_jobs.extend(
                _fetch_source(
                    context,
                    "arbeitnow",
                    "https://www.arbeitnow.com/api/job-board-api",
                    lambda data: parse_arbeitnow((data or {}).get("data") or []),
                )
            )
        finally:
            context.close()
            browser.close()
    _log(f"[scraper] Fetching complete — raw total {len(all_jobs)} jobs")
    return all_jobs


def deduplicate(jobs: Iterable[JobListing]) -> list[JobListing]:
    """Dedupe on normalized apply_url + title/company fingerprint."""
    by_fp: dict[str, JobListing] = {}
    by_url: set[str] = set()
    for job in jobs:
        url_key = normalize_apply_url(job.apply_url)
        if not url_key:
            continue
        # Rebuild listing if URL needed re-normalization (defensive).
        if url_key != job.apply_url:
            job = JobListing(
                title=job.title,
                company=job.company,
                location=job.location,
                salary_range=job.salary_range,
                description=job.description,
                apply_url=url_key,
                category=job.category,
            )
        fp = job.fingerprint()
        if fp in by_fp or url_key in by_url:
            continue
        by_fp[fp] = job
        by_url.add(url_key)
    return list(by_fp.values())


def fetch_existing_keys(client: Client) -> set[str]:
    """
    Load existing normalized apply_url keys.
    Raises ExistingKeysFetchError on any failure — never returns a partial/empty
    set that would be mistaken for an empty database.
    """
    existing: set[str] = set()
    page_size = 1_000
    start = 0
    while True:
        try:
            end = start + page_size - 1
            resp = (
                client.table("jobs")
                .select("apply_url")
                .range(start, end)
                .execute()
            )
            rows = resp.data or []
        except Exception as e:
            raise ExistingKeysFetchError(
                f"failed loading existing apply_url keys at offset={start}: "
                f"{type(e).__name__}: {e}"
            ) from e
        if not isinstance(rows, list):
            raise ExistingKeysFetchError(
                f"unexpected response type for apply_url page at offset={start}: "
                f"{type(rows)!r}"
            )
        for row in rows:
            url = normalize_apply_url(row.get("apply_url") or "")
            if url:
                existing.add(url)
        if len(rows) < page_size:
            break
        start += page_size
    return existing


def count_jobs(client: Client | None = None) -> int:
    """Count jobs via supabase-py (SECRET_KEY) — never browser User-Agent."""
    try:
        db = client or get_supabase_admin()
        resp = db.table("jobs").select("id", count="exact").limit(1).execute()
        if resp.count is not None:
            return int(resp.count)
        return len(resp.data or [])
    except Exception as e:
        _log_err(f"[db] count_jobs failed: {e}")
        return 0


def to_row(job: JobListing) -> dict:
    apply_url = normalize_apply_url(job.apply_url)
    return {
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "salary": job.salary_range,
        "description": job.description,
        "apply_url": apply_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def insert_jobs(jobs: list[JobListing], client: Client | None = None) -> WriteResult:
    """
    Upsert new jobs via supabase-py + SECRET_KEY only.
    Aborts (raises) if existing-key fetch fails — never treats that as empty DB.
    Uses ignore_duplicates as a race-safe safety net on unique apply_url conflicts.
    """
    _log("[db] Loading existing apply_url keys from database…")
    db = client or get_supabase_admin()
    existing = fetch_existing_keys(db)
    _log(f"[db] Found {len(existing)} existing jobs in Supabase")

    fresh: list[JobListing] = []
    for job in jobs:
        key = normalize_apply_url(job.apply_url)
        if not key:
            continue
        if key in existing:
            continue
        if key != job.apply_url:
            job = JobListing(
                title=job.title,
                company=job.company,
                location=job.location,
                salary_range=job.salary_range,
                description=job.description,
                apply_url=key,
                category=job.category,
            )
        fresh.append(job)
        existing.add(key)  # prevent intra-run duplicates across batches

    skipped = len(jobs) - len(fresh)
    if not fresh:
        _log("[db] No new jobs to write (all duplicates)")
        return WriteResult(inserted=0, skipped=skipped, failed=0)

    rows = [to_row(j) for j in fresh]
    inserted = 0
    failed = 0
    batch_size = 40
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        batch_num = i // batch_size + 1
        try:
            # ignore_duplicates → ON CONFLICT DO NOTHING against any unique index
            # (including jobs_apply_url_uidx on lower(apply_url)). Race-safe.
            db.table("jobs").upsert(batch, ignore_duplicates=True).execute()
            inserted += len(batch)
            _log(f"[db] Upserted batch {batch_num} (+{len(batch)})")
        except Exception as e:
            failed += len(batch)
            _log_err(
                f"[db] Batch {batch_num} FAILED ({len(batch)} rows): "
                f"{type(e).__name__}: {e}"
            )

    _log(
        f"[db] Write complete — inserted/upserted={inserted} "
        f"skipped={skipped} failed={failed}"
    )
    return WriteResult(inserted=inserted, skipped=skipped, failed=failed)


def category_breakdown(jobs: list[JobListing]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for j in jobs:
        counts[j.category] = counts.get(j.category, 0) + 1
    return counts


def print_run_summary(stats: RunStats) -> None:
    status = "OK" if stats.ok else "FAILED"
    lines = [
        "========== RUN SUMMARY ==========",
        f"fetched:       {stats.fetched}",
        f"deduplicated:  {stats.deduplicated}",
        f"skipped:       {stats.skipped}",
        f"inserted:      {stats.inserted}",
        f"failed:        {stats.failed}",
        f"status:        {status}",
    ]
    if stats.critical_error:
        lines.append(f"error:         {stats.critical_error}")
    lines.append("=================================")
    print("\n".join(lines), flush=True)


def main() -> int:
    """
    Fail closed: non-zero exit on credential failure, existing-key fetch failure,
    insert/upsert failures, or other critical errors.
    """
    stats = RunStats()
    _log(f"[scraper] RemoteReady HQ scraper — {datetime.now(timezone.utc).isoformat()}")
    _log(f"[scraper] cwd={Path.cwd()} script={Path(__file__).resolve()}")

    url, anon, secret = refresh_supabase_credentials()
    print(
        f"[scraper] Supabase Client Initialized: URL={url}, "
        f"Anon Present={bool(anon)}, Secret Present={bool(secret)} "
        f"(secret_len={len(secret)})",
        flush=True,
    )

    db: Client | None = None
    try:
        if not secret:
            raise CredentialError(
                "missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) — "
                "cannot write to the database"
            )
        db = probe_supabase()
        _log("[scraper] create_client + credential probe OK")
    except Exception as e:
        stats.critical_error = str(e)
        _log_err(f"[scraper] Credential validation failed: {e}")
        print_run_summary(stats)
        return 1

    try:
        _log("[scraper] Starting scrape_all()…")
        try:
            scraped = scrape_all()
        except Exception as e:
            stats.critical_error = f"scrape_all failed: {e}"
            _log_err(f"[scraper] {stats.critical_error}")
            print_run_summary(stats)
            return 1

        stats.fetched = len(scraped)
        unique = deduplicate(scraped)
        stats.deduplicated = len(unique)
        _log(f"[scraper] Scraped {stats.fetched} → {stats.deduplicated} after dedupe.")
        _log(f"[scraper] Category mix: {category_breakdown(unique)}")

        if not unique:
            stats.critical_error = "no jobs scraped from any source this run"
            _log_err(f"[scraper] {stats.critical_error}")
            print_run_summary(stats)
            return 1

        priority = sorted(
            unique,
            key=lambda j: (
                0 if j.category in ("Support", "Sales") else 1,
                j.title,
            ),
        )
        _log("[db] Upserting into Supabase…")
        print(f"[scraper] Connecting to Supabase at: {SUPABASE_URL}", flush=True)
        try:
            result = insert_jobs(priority, client=db)
        except ExistingKeysFetchError as e:
            stats.critical_error = str(e)
            _log_err(f"[db] {stats.critical_error}")
            print_run_summary(stats)
            return 1
        except Exception as e:
            stats.critical_error = f"database write failed: {e}"
            _log_err(f"[db] {stats.critical_error}")
            print_run_summary(stats)
            return 1

        stats.inserted = result.inserted
        stats.skipped = result.skipped
        stats.failed = result.failed
        total = count_jobs(db)
        _log(
            f"[db] Inserted {result.inserted}; skipped {result.skipped}; "
            f"failed {result.failed}. DB total={total}."
        )

        if result.failed > 0:
            stats.critical_error = (
                f"{result.failed} job row(s) failed during upsert"
            )
            print_run_summary(stats)
            return 1

        # Fresh jobs existed after DB dedupe but nothing landed — treat as failure.
        fresh_expected = stats.deduplicated - stats.skipped
        if fresh_expected > 0 and stats.inserted == 0:
            stats.critical_error = (
                f"{fresh_expected} new job(s) expected but inserted=0"
            )
            print_run_summary(stats)
            return 1

    except Exception as e:
        stats.critical_error = f"critical error: {e}"
        _log_err(f"[scraper] {stats.critical_error}")
        print_run_summary(stats)
        return 1

    print_run_summary(stats)
    print(f"Scrape completed. Inserted {stats.inserted} new jobs.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        print(f"[scraper] Fatal: {e}", flush=True)
        print_run_summary(
            RunStats(critical_error=str(e), failed=0)
        )
        raise SystemExit(1) from e
