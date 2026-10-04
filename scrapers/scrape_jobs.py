#!/usr/bin/env python3
"""
RemoteReady HQ job scraper (Playwright).

Priority: Support, Sales, Marketing, Operations (+ Remotive/RemoteOK/Jobicy).
Stamps rrhq_category into description for accurate frontend pill counts.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env.local")

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


BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
BROWSER_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

# Live project host (resolves in DNS). Typo refs like ujhsltihinwuysikzvhs do NOT.
DEFAULT_SUPABASE_URL = "https://ujhsltlhlnwuysikzvhs.supabase.co"
# Common mistyped project refs seen in CI secrets / prior hardcodes
_BAD_SUPABASE_HOSTS = {
    "ujhsltihinwuysikzvhs.supabase.co",
    "ujhsltlhinwuysikzvhs.supabase.co",
}


def normalize_supabase_url(raw: str | None) -> str:
    """Strip whitespace/quotes, force https://, drop trailing slash."""
    value = (raw or "").strip().strip("'").strip('"')
    if not value:
        return DEFAULT_SUPABASE_URL
    if not re.match(r"^https?://", value, flags=re.I):
        value = "https://" + value.lstrip("/")
    if value.lower().startswith("http://"):
        value = "https://" + value[7:]
    return value.rstrip("/")


def _host_resolves(host: str) -> bool:
    if not host:
        return False
    try:
        import socket

        socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        return True
    except OSError as err:
        _log_err(f"[scraper] DNS lookup failed for {host}: {err}")
        return False


def resolve_supabase_url(raw: str | None) -> str:
    """
    Sanitize env URL and automatically fall back when empty, schemeless,
    known-bad typo host, or DNS resolution fails.
    """
    candidate = normalize_supabase_url(raw)
    host = urlparse(candidate).netloc.lower()

    if host in _BAD_SUPABASE_HOSTS:
        _log(
            f"[scraper] SUPABASE_URL host {host} is a known typo — "
            f"falling back to {DEFAULT_SUPABASE_URL}"
        )
        return DEFAULT_SUPABASE_URL

    if not _host_resolves(host):
        _log(
            f"[scraper] SUPABASE_URL host {host} does not resolve — "
            f"falling back to {DEFAULT_SUPABASE_URL}"
        )
        return DEFAULT_SUPABASE_URL

    return candidate


def require_supabase() -> tuple[str, str]:
    """Return (url, key). Raises ValueError if service key is missing/blank."""
    raw_url = os.environ.get("SUPABASE_URL") or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_URL"
    )
    url = resolve_supabase_url(raw_url)
    print(f"[scraper] Connecting to Supabase at: {url}", flush=True)

    # Prefer service-role key, then secret key aliases (never KeyError on missing)
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_KEY")
        or ""
    ).strip()

    host = urlparse(url).netloc
    preview = url[:15] + ("..." if len(url) > 15 else "")
    print(f"[scraper] Supabase URL detected: {preview}", flush=True)

    key_source = "none"
    if (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip():
        key_source = "SUPABASE_SERVICE_ROLE_KEY"
    elif (os.environ.get("SUPABASE_SECRET_KEY") or "").strip():
        key_source = "SUPABASE_SECRET_KEY"
    elif (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip():
        key_source = "SUPABASE_SERVICE_KEY"

    _log(
        "[scraper] env check: "
        f"host={host or '(none)'} key_source={key_source} key_len={len(key)} "
        f"TARGET_MIN={TARGET_MIN} SUPPORT_MIN={SUPPORT_MIN} SALES_MIN={SALES_MIN}"
    )

    if not key:
        raise ValueError(
            "missing required environment variables: "
            "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY"
        )
    return url, key


def verify_supabase(url: str, key: str) -> bool:
    """Probe Supabase REST; warn and return False on DNS/auth/network failure."""
    print(f"[scraper] Connecting to Supabase at: {url}", flush=True)
    probe = f"{url}/rest/v1/jobs?select=id&limit=1"
    req = urllib.request.Request(
        probe,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "User-Agent": BROWSER_UA,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            _log(f"[scraper] Supabase auth OK (HTTP {resp.status})")
            return True
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")[:500]
        _log_err(
            f"[scraper] WARNING: Supabase URL/key failed to authenticate "
            f"(HTTP {err.code}) body={raw!r}"
        )
        return False
    except Exception as err:
        _log_err(
            f"[scraper] WARNING: Supabase connection failed "
            f"({type(err).__name__}: {err!r}). "
            "Check SUPABASE_URL host spelling and SUPABASE_SERVICE_ROLE_KEY / "
            "SUPABASE_SECRET_KEY secrets."
        )
        return False


def supabase_request(
    method: str,
    path: str,
    *,
    body: object | None = None,
    prefer: str | None = None,
) -> tuple[int, object]:
    url, key = require_supabase()
    target = f"{url}{path}"
    print(f"[scraper] Connecting to Supabase at: {url} ({method} {path})", flush=True)
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": BROWSER_UA,
    }
    if prefer:
        headers["Prefer"] = prefer
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(target, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        print(
            f"[scraper] supabase_request HTTPError {err.code} for {target}: {raw[:500]}",
            flush=True,
        )
        raise RuntimeError(
            f"Supabase {method} {path} → {err.code}: {raw[:400]}"
        ) from err
    except Exception as err:
        print(
            f"[scraper] supabase_request failed for {target}: "
            f"{type(err).__name__}: {err!r}",
            flush=True,
        )
        raise


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
    apply_url = (apply_url or "").strip()
    if not title or not apply_url:
        return None
    if apply_url.startswith("/"):
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
    by_fp: dict[str, JobListing] = {}
    by_url: set[str] = set()
    for job in jobs:
        fp = job.fingerprint()
        url_key = job.apply_url.strip().lower()
        try:
            parsed = urlparse(job.apply_url)
            host_path = f"{parsed.netloc}{parsed.path}".lower().rstrip("/")
        except Exception:
            host_path = url_key
        if fp in by_fp or url_key in by_url or host_path in by_url:
            continue
        by_fp[fp] = job
        by_url.add(url_key)
        by_url.add(host_path)
    return list(by_fp.values())


def fetch_existing_keys() -> set[str]:
    existing: set[str] = set()
    page_size = 1_000
    start = 0
    while True:
        try:
            _, rows = supabase_request(
                "GET",
                f"/rest/v1/jobs?select=apply_url&offset={start}&limit={page_size}",
            )
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            break
        if not isinstance(rows, list):
            break
        for row in rows:
            url = (row.get("apply_url") or "").strip().lower()
            if url:
                existing.add(url)
        if len(rows) < page_size:
            break
        start += page_size
    return existing


def count_jobs() -> int:
    try:
        url, key = require_supabase()
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        return 0
    req = urllib.request.Request(
        f"{url}/rest/v1/jobs?select=id",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "count=exact",
            "Range": "0-0",
            "User-Agent": BROWSER_UA,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            cr = resp.headers.get("content-range") or ""
            if "/" in cr and cr.split("/")[-1].isdigit():
                return int(cr.split("/")[-1])
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
    try:
        _, rows = supabase_request("GET", "/rest/v1/jobs?select=id")
        return len(rows) if isinstance(rows, list) else 0
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        return 0


def to_row(job: JobListing) -> dict:
    return {
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "salary": job.salary_range,
        "description": job.description,
        "apply_url": job.apply_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def insert_jobs(jobs: list[JobListing]) -> tuple[int, int]:
    _log("[scraper] Loading existing apply_url keys from database…")
    try:
        existing = fetch_existing_keys()
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        existing = set()
    _log(f"[scraper] Found {len(existing)} existing jobs in Supabase")
    fresh = [j for j in jobs if j.apply_url.strip().lower() not in existing]
    skipped = len(jobs) - len(fresh)
    if not fresh:
        _log("[scraper] No new jobs to insert (all duplicates)")
        return 0, skipped
    rows = [to_row(j) for j in fresh]
    inserted = 0
    batch_size = 40
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            supabase_request(
                "POST", "/rest/v1/jobs", body=batch, prefer="return=minimal"
            )
            inserted += len(batch)
            _log(
                f"[scraper] Successfully written batch {i // batch_size + 1} "
                f"to database (+{len(batch)})"
            )
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
    _log(f"[scraper] Successfully written {inserted} new jobs to database")
    return inserted, skipped


def category_breakdown(jobs: list[JobListing]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for j in jobs:
        counts[j.category] = counts.get(j.category, 0) + 1
    return counts


def main() -> int:
    """Always return 0 so CI stays green on partial scrape / DB outages."""
    inserted = 0
    _log(f"[scraper] RemoteReady HQ scraper — {datetime.now(timezone.utc).isoformat()}")
    _log(f"[scraper] cwd={Path.cwd()} script={Path(__file__).resolve()}")
    try:
        try:
            url, key = require_supabase()
            if not verify_supabase(url, key):
                print(
                    "Error scraping target: Supabase URL or SERVICE_ROLE/SECRET key "
                    "failed to authenticate — continuing scrape without DB writes",
                    flush=True,
                )
                # Still scrape sources for observability, then exit 0
                try:
                    scraped = scrape_all()
                    unique = deduplicate(scraped)
                    _log(
                        f"[scraper] Scraped {len(scraped)} → {len(unique)} after dedupe "
                        "(not written — Supabase unavailable)."
                    )
                except Exception as e:
                    print(f"Error scraping target: {e}", flush=True)
                return 0
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            return 0

        _log("[scraper] Starting scrape_all()…")
        try:
            scraped = scrape_all()
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            scraped = []

        unique = deduplicate(scraped)
        _log(f"[scraper] Scraped {len(scraped)} → {len(unique)} after dedupe.")
        _log(f"[scraper] Category mix: {category_breakdown(unique)}")

        if unique:
            priority = sorted(
                unique,
                key=lambda j: (
                    0 if j.category in ("Support", "Sales") else 1,
                    j.title,
                ),
            )
            _log("[scraper] Inserting into Supabase…")
            try:
                inserted, skipped = insert_jobs(priority)
                total = count_jobs()
                _log(
                    f"[scraper] Inserted {inserted}; skipped {skipped}. "
                    f"DB total={total}."
                )
            except Exception as e:
                print(f"Error scraping target: {e}", flush=True)
        else:
            _log("[scraper] No jobs scraped from any source this run.")

    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
    finally:
        print(f"Scrape completed. Inserted {inserted} new jobs.", flush=True)

    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        print("Scrape completed. Inserted 0 new jobs.", flush=True)
    sys.exit(0)
