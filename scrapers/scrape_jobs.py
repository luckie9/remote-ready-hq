#!/usr/bin/env python3
"""
RemoteReady HQ job scraper (Playwright).

Priority: Support, Sales, Marketing, Operations (+ Remotive/RemoteOK/Jobicy).
Stamps rrhq_category into description for accurate frontend pill counts.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env.local")

# Live project host that resolves in DNS (typo refs like ujhsltihinwuysikzvhs do not).
_DEFAULT_SUPABASE_URL = "https://ujhsltlhlnwuysikzvhs.supabase.co"


def _sanitize_url(raw: str | None) -> str:
    """
    Normalize a Supabase URL (run #17 working pattern).
    Also accepts a bare project ref from PROJECT_ID_URL → https://{ref}.supabase.co.
    """
    value = (raw or "").strip().strip("'").strip('"')
    if not value:
        return _DEFAULT_SUPABASE_URL
    # Bare project ref (no scheme, no dots) → construct host
    if not re.match(r"^https?://", value, flags=re.I) and "." not in value:
        value = f"https://{value}.supabase.co"
    elif not re.match(r"^https?://", value, flags=re.I):
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


# URL + key resolution at import (run #17 pattern + current GitHub secret aliases).
# ANON_KEY: browser / Playwright / client-side only (never for privileged writes).
# SECRET_KEY: server-side Python SDK inserts only (never send with a browser UA).
SUPABASE_URL = _sanitize_url(
    _env_first("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "PROJECT_ID_URL") or None
)
ANON_KEY = _env_first(
    "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PUBLISHABLE_KEY"
)
SECRET_KEY = _env_first(
    "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SECRET_KEYS"
)

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

# Listing quality gates
MAX_LISTING_AGE_DAYS = 14
_REMOTE_RE = re.compile(
    r"\b(remote|work[\s-]*from[\s-]*home|wfh|distributed|anywhere|"
    r"worldwide|telecommute|fully[\s-]*remote|100%[\s-]*remote)\b",
    re.I,
)
_ONSITE_RE = re.compile(
    r"\b(on[\s-]?site|in[\s-]?office|office[\s-]?based|no\s+remote|"
    r"not\s+remote|must\s+relocate|relocation\s+required)\b",
    re.I,
)
_PLACEHOLDER_COMPANY = frozenset(
    {"", "unknown", "n/a", "na", "none", "null", "-", "tbd", "confidential"}
)
_PLACEHOLDER_URL_RE = re.compile(
    r"(example\.(com|org|net)\b|placeholder|localhost|127\.0\.0\.1)",
    re.I,
)
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
            f"{normalize_apply_url(self.apply_url)}"
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def title_company_key(self) -> str:
        return f"{self.title.strip().lower()}|{self.company.strip().lower()}"


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
    """Canonical apply URL for dedupe + storage (https, no tracking params)."""
    value = (raw or "").strip()
    if not value or value.startswith("/"):
        return ""
    if not re.match(r"^https?://", value, flags=re.I):
        value = "https://" + value.lstrip("/")
    if value.lower().startswith("http://"):
        value = "https://" + value[7:]
    try:
        parsed = urlparse(value)
    except Exception:
        return ""
    if not parsed.netloc:
        return ""
    host = parsed.netloc.lower()
    path = (parsed.path or "").rstrip("/")
    kept = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    kept.sort(key=lambda kv: (kv[0].lower(), kv[1]))
    query = urlencode(kept, doseq=True)
    return urlunparse(("https", host, path, "", query, ""))


# Hosts that are job boards / aggregators, not employer application portals.
_AGGREGATOR_HOSTS = (
    "remotive.com",
    "remoteok.com",
    "remoteok.io",
    "rok.co",
    "jobicy.com",
    "jobi.cy",
    "weworkremotely.com",
    "remote.co",
    "flexjobs.com",
    "indeed.com",
    "linkedin.com",
    "ziprecruiter.com",
    "glassdoor.com",
    "monster.com",
    "simplyhired.com",
    "wellfound.com",
    "otta.com",
    "builtin.com",
    "himalayas.app",
    "workingnomads.com",
)
# Applicant-tracking and company career hosts worth keeping.
_ATS_HOSTS = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "workable.com",
    "bamboohr.com",
    "recruitee.com",
    "teamtailor.com",
    "jobvite.com",
    "icims.com",
    "breezy.hr",
    "comeet.com",
    "personio.com",
    "personio.de",
    "pinpointhq.com",
    "join.com",
    "rippling.com",
    "dover.io",
    "gem.com",
)
_NOISE_HOSTS = (
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "google.com",
    "gstatic.com",
    "schema.org",
    "w3.org",
    "apple.com",
    "mozilla.org",
    "microsoft.com",
    "github.com",
    "medium.com",
    "notion.so",
    "notion.com",
    "wikipedia.org",
    "doubleclick.net",
    "cloudflare.com",
    "cloudflareinsights.com",
    "gravatar.com",
    "play.google.com",
    "apps.apple.com",
)
_CAREER_PATH_RE = re.compile(
    r"/(apply|application|careers?|jobs?|positions?|openings?|opportunit(?:y|ies)?)/",
    re.I,
)
_NOISE_PATH_RE = re.compile(
    r"/(privacy|terms|blog|login|sign-?up|signup|cookie|about|wp-content|static/)",
    re.I,
)
_ANCHOR_RE = re.compile(
    r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>",
    re.I | re.S,
)
_META_REFRESH_RE = re.compile(
    r"http-equiv=[\"']refresh[\"'][^>]*content=[\"'][^\"']*url=([^\"'>\s]+)",
    re.I,
)
_JSONLD_RE = re.compile(
    r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.I | re.S,
)
_MIN_APPLY_SCORE = 40
_APPLY_PAGE_CACHE: dict[str, tuple[str, str]] = {}
_APPLY_RESOLVE_STATS = {"direct": 0, "resolved": 0, "unresolved": 0}


def _host_name(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower().rstrip(".")
    except Exception:
        return ""
    if host.startswith("www."):
        host = host[4:]
    return host


def _host_is(host: str, roots: tuple[str, ...]) -> bool:
    return any(host == root or host.endswith("." + root) for root in roots)


def is_aggregator_url(url: str) -> bool:
    """True for listing-site pages rather than an employer application portal."""
    host = _host_name(url)
    if not host:
        return False
    if host == "arbeitnow.com" or host.endswith(".arbeitnow.com") or host.startswith("arbeitnow."):
        return True
    return _host_is(host, _AGGREGATOR_HOSTS)


def _safe_public_http(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower()
    if not host or host in {"localhost", "metadata.google.internal"} or host.endswith(".internal"):
        return False
    if host in {"127.0.0.1", "0.0.0.0", "::1"}:
        return False
    if host.startswith("169.254.") or host.startswith("10.") or host.startswith("192.168."):
        return False
    return True


def score_apply_url(url: str, anchor_text: str = "") -> int:
    """Higher scores are employer career / ATS links. Aggregator pages score 0."""
    norm = normalize_apply_url(url)
    if not norm or not _safe_public_http(norm):
        return 0
    if _PLACEHOLDER_URL_RE.search(norm) or is_aggregator_url(norm):
        return 0
    host = _host_name(norm)
    if _host_is(host, _NOISE_HOSTS):
        return 0
    path = urlparse(norm).path or "/"
    score = 20
    if _host_is(host, _ATS_HOSTS):
        score += 80
    if _CAREER_PATH_RE.search(path if path.endswith("/") else path + "/"):
        score += 40
    if path in {"", "/"}:
        score += 5
    if _NOISE_PATH_RE.search(path if path.endswith("/") else path + "/"):
        score -= 50
    if re.search(r"\bapply\b", anchor_text or "", re.I):
        score += 25
    return score


def _best_apply_url(candidates: Iterable[tuple[str, str]]) -> str:
    best = ""
    best_score = 0
    for raw, text in candidates:
        norm = normalize_apply_url(raw)
        score = score_apply_url(norm, text)
        if score > best_score:
            best = norm
            best_score = score
    if best_score >= _MIN_APPLY_SCORE:
        return best
    return ""


def _expand_board_urls(url: str) -> list[str]:
    """Prefer known apply endpoints on aggregator listings before the listing itself."""
    norm = normalize_apply_url(url)
    if not norm:
        return []
    ordered = [norm]
    host = _host_name(norm)
    path = urlparse(norm).path or ""
    if host.startswith("arbeitnow.") or host.endswith("arbeitnow.com"):
        if not path.rstrip("/").endswith("/apply"):
            ordered.insert(0, norm.rstrip("/") + "/apply")
    if host.endswith("remoteok.com") and "/l/" not in path:
        match = re.search(r"-(\d+)$", path.rstrip("/"))
        if match:
            ordered.insert(0, f"https://remoteok.com/l/{match.group(1)}")
    deduped: list[str] = []
    for item in ordered:
        if item not in deduped:
            deduped.append(item)
    return deduped


def _b64_decode(value: str) -> bytes:
    pad = "=" * ((4 - len(value) % 4) % 4)
    return base64.b64decode(value + pad)


def _decode_embedded_redirect(page_html: str) -> str:
    """
    Some board interstitial pages hide the next URL in a short script that
    assigns window.location.href. Return an absolute http(s) destination.
    """
    if "window.location.href" not in page_html or "atob" not in page_html:
        return ""
    match = re.search(r"n='([^']+)'.*?split\('([^']+)'\)", page_html, re.S)
    if not match:
        return ""
    blob, marker = match.group(1), match.group(2)
    if marker not in blob:
        return ""
    try:
        step = blob.split(marker)[1]
        first = _b64_decode(step[::-1]).decode("latin1")
        part = first[::-1].split(marker)[1]
        decoded = _b64_decode(part).decode("utf-8", "replace")
        dest = decoded.split(marker)[1].strip()
    except Exception:
        return ""
    if dest.startswith("http://") or dest.startswith("https://"):
        return dest
    return ""


def _jsonld_urls(page_html: str) -> list[str]:
    found: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        org = node.get("hiringOrganization")
        if isinstance(org, dict):
            for key in ("url", "sameAs"):
                value = org.get(key)
                if isinstance(value, str):
                    found.append(value)
                elif isinstance(value, list):
                    found.extend(item for item in value if isinstance(item, str))
        for value in node.values():
            if isinstance(value, (dict, list)):
                walk(value)

    for raw in _JSONLD_RE.findall(page_html):
        try:
            walk(json.loads(html.unescape(raw.strip())))
        except Exception:
            continue
    return found


def _extract_page_candidates(page_html: str, page_url: str) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    for raw in _META_REFRESH_RE.findall(page_html):
        candidates.append((urljoin(page_url, html.unescape(raw.strip())), ""))
    for raw in _jsonld_urls(page_html):
        candidates.append((urljoin(page_url, raw.strip()), ""))
    for href, inner in _ANCHOR_RE.findall(page_html)[:250]:
        text = re.sub(r"<[^>]+>", " ", inner)
        text = re.sub(r"\s+", " ", html.unescape(text)).strip()
        candidates.append((urljoin(page_url, html.unescape(href.strip())), text))
    return candidates


def _fetch_apply_page(url: str) -> tuple[str, str]:
    """GET a public listing/apply URL. Returns (final_url, html)."""
    cached = _APPLY_PAGE_CACHE.get(url)
    if cached is not None:
        return cached
    if not _safe_public_http(url):
        _APPLY_PAGE_CACHE[url] = ("", "")
        return "", ""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            final = response.geturl()
            body = response.read(400_000).decode("utf-8", "replace")
    except Exception:
        final, body = "", ""
    _APPLY_PAGE_CACHE[url] = (final, body)
    return final, body


def _same_site_apply_link(page_url: str, candidates: list[tuple[str, str]]) -> str:
    for href, _text in candidates:
        absolute = normalize_apply_url(urljoin(page_url, href))
        if not absolute or not is_aggregator_url(absolute):
            continue
        path = (urlparse(absolute).path or "").lower()
        if path.rstrip("/").endswith("/apply"):
            return absolute
    return ""


def _unwrap_board_url(
    url: str,
    fetch: Callable[[str], tuple[str, str]],
    depth: int = 0,
) -> str:
    if depth > 1 or not _safe_public_http(url):
        return ""
    try:
        final, body = fetch(url)
    except Exception:
        return ""
    final_norm = normalize_apply_url(final)
    if score_apply_url(final_norm) >= _MIN_APPLY_SCORE:
        return final_norm
    embedded = _decode_embedded_redirect(body or "")
    if embedded and score_apply_url(embedded) >= _MIN_APPLY_SCORE:
        return normalize_apply_url(embedded)
    page_url = final_norm or url
    candidates = _extract_page_candidates(body or "", page_url)
    best = _best_apply_url(candidates)
    if best:
        return best
    apply_link = _same_site_apply_link(page_url, candidates)
    if apply_link and apply_link != url:
        return _unwrap_board_url(apply_link, fetch, depth + 1)
    return ""


def resolve_employer_apply_url(
    *candidates: str,
    description: str = "",
    fetch: Callable[[str], tuple[str, str]] | None = None,
) -> str:
    """
    Pick a company application URL.

    Direct ATS / career links in the payload win. Aggregator listing pages are
    followed only far enough to read a redirect or an embedded employer URL.
    """
    fetch_fn = fetch or _fetch_apply_page
    direct: list[tuple[str, str]] = []
    boards: list[str] = []
    for raw in candidates:
        norm = normalize_apply_url(raw)
        if not norm:
            continue
        if is_aggregator_url(norm):
            if norm not in boards:
                boards.append(norm)
        else:
            direct.append((norm, ""))
    for match in re.findall(r"https?://[^\s\"'<>]+", description or ""):
        cleaned = match.rstrip(").,;")
        norm = normalize_apply_url(cleaned)
        if norm and not is_aggregator_url(norm):
            direct.append((norm, ""))
    chosen = _best_apply_url(direct)
    if chosen:
        _APPLY_RESOLVE_STATS["direct"] += 1
        return chosen

    attempts: list[str] = []
    for board in boards:
        for extra in _expand_board_urls(board):
            if extra not in attempts:
                attempts.append(extra)
    for url in attempts[:3]:
        resolved = _unwrap_board_url(url, fetch_fn)
        if resolved:
            _APPLY_RESOLVE_STATS["resolved"] += 1
            return resolved
    if boards:
        _APPLY_RESOLVE_STATS["unresolved"] += 1
    return ""


def parse_job_datetime(value: object | None) -> datetime | None:
    """Parse common board date formats into an aware UTC datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:  # milliseconds
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return parse_job_datetime(int(text))
    # ISO-8601 (allow trailing Z)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(
            timezone.utc
        )
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, IndexError):
        return None


def is_fresh_enough(posted_at: object | None, *, max_age_days: int = MAX_LISTING_AGE_DAYS) -> bool:
    """True if unknown date (keep) or posted within max_age_days."""
    dt = parse_job_datetime(posted_at)
    if dt is None:
        return True
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    return dt >= cutoff


def is_remote_listing(
    location: str,
    title: str,
    description: str = "",
    *,
    remote_hint: bool | None = None,
    extra: str = "",
) -> bool:
    """Keep only remote-friendly roles; drop clear on-site-only listings."""
    if remote_hint is False:
        return False
    if remote_hint is True:
        return True
    blob = f"{location}\n{title}\n{description}\n{extra}"
    if _ONSITE_RE.search(blob) and not _REMOTE_RE.search(blob):
        return False
    if _REMOTE_RE.search(blob):
        return True
    loc = (location or "").strip().lower()
    if not loc or loc in {"worldwide / remote", "worldwide", "anywhere", "remote"}:
        return True
    # Specific city/region without remote signal → treat as non-remote
    return False


def is_valid_record(title: str, company: str, apply_url: str) -> bool:
    """Require title, company, and a direct employer application link."""
    t = normalize_whitespace(title)
    c = normalize_whitespace(company)
    u = normalize_apply_url(apply_url)
    if not t or not c or not u:
        return False
    if c.lower() in _PLACEHOLDER_COMPANY:
        return False
    if _PLACEHOLDER_URL_RE.search(u) or is_aggregator_url(u):
        return False
    if score_apply_url(u) < _MIN_APPLY_SCORE:
        return False
    return True


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
    # Run #17 names first; also accept current GitHub secrets.
    SUPABASE_URL = _sanitize_url(
        _env_first("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "PROJECT_ID_URL")
        or None
    )
    ANON_KEY = _env_first(
        "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PUBLISHABLE_KEY"
    )
    SECRET_KEY = _env_first(
        "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SECRET_KEYS"
    )
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


def make_listing(
    *,
    title: str,
    company: str,
    location: str,
    salary: str | None,
    description: str,
    apply_url: str,
    category: str,
    posted_at: object | None = None,
    remote_hint: bool | None = None,
    remote_extra: str = "",
) -> JobListing | None:
    title = normalize_whitespace(title)
    company = normalize_whitespace(company)
    apply_url = normalize_apply_url(apply_url)
    if not is_valid_record(title, company, apply_url):
        return None
    if not is_fresh_enough(posted_at):
        return None
    loc = normalize_location(location)
    if not is_remote_listing(
        loc, title, description or "", remote_hint=remote_hint, extra=remote_extra
    ):
        return None
    cat = infer_category(title, category)
    return JobListing(
        title=title[:200],
        company=company[:120],
        location=loc[:120],
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
            apply_url=resolve_employer_apply_url(
                item.get("apply_url") or "",
                item.get("url") or "",
                description=item.get("description") or "",
            ),
            category=fallback_cat,
            posted_at=item.get("publication_date") or item.get("pub_date"),
            remote_hint=True,  # Remotive is remote-only
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
        apply_candidates = [
            item.get("apply_url") or "",
            item.get("url") or "",
        ]
        if item.get("id"):
            apply_candidates.insert(0, f"https://remoteok.com/l/{item['id']}")
        apply_url = resolve_employer_apply_url(
            *apply_candidates,
            description=item.get("description") or "",
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
            posted_at=item.get("date") or item.get("epoch"),
            remote_hint=True,  # RemoteOK is remote-only
            remote_extra=tags,
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
            apply_url=resolve_employer_apply_url(
                item.get("jobUrl") or "",
                item.get("url") or "",
                description=(item.get("jobDescription") or "")
                + "\n"
                + (item.get("jobExcerpt") or ""),
            ),
            category=fallback_cat,
            posted_at=item.get("pubDate") or item.get("jobPubDate"),
            remote_hint=True,  # Jobicy remote-jobs API
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
        remote_hint = item.get("remote")
        if isinstance(remote_hint, str):
            remote_hint = remote_hint.strip().lower() in {"1", "true", "yes"}
        elif remote_hint is not None:
            remote_hint = bool(remote_hint)
        listing = make_listing(
            title=title,
            company=(item.get("company_name") or item.get("company") or ""),
            location=normalize_location(item.get("location")),
            salary=None,
            description=item.get("description") or "",
            apply_url=resolve_employer_apply_url(
                item.get("url") or "",
                description=item.get("description") or "",
            ),
            category=cat,
            posted_at=item.get("created_at") or item.get("published_at"),
            remote_hint=remote_hint if remote_hint is not None else None,
            remote_extra=" ".join(item.get("tags") or [])
            if isinstance(item.get("tags"), list)
            else "",
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
    _log(
        "[scraper] Apply links: "
        f"direct={_APPLY_RESOLVE_STATS['direct']} "
        f"resolved={_APPLY_RESOLVE_STATS['resolved']} "
        f"unresolved_board_pages={_APPLY_RESOLVE_STATS['unresolved']}"
    )
    return all_jobs


def _url_dedupe_keys(apply_url: str) -> set[str]:
    """Normalized URL keys used to detect duplicates across sources/runs."""
    keys: set[str] = set()
    norm = normalize_apply_url(apply_url)
    if not norm:
        return keys
    keys.add(norm)
    try:
        parsed = urlparse(norm)
        host_path = f"{parsed.netloc}{parsed.path}".lower().rstrip("/")
        if host_path:
            keys.add(host_path)
    except Exception:
        pass
    return keys


def deduplicate(jobs: Iterable[JobListing]) -> list[JobListing]:
    """
    In-memory dedupe by:
      - fingerprint(title|company|normalized_url)
      - normalized apply_url / host+path
      - title|company (same role at same company)
    """
    by_fp: dict[str, JobListing] = {}
    seen_urls: set[str] = set()
    seen_tc: set[str] = set()
    for job in jobs:
        if not is_valid_record(job.title, job.company, job.apply_url):
            continue
        # Re-normalize URL onto the listing if needed
        norm_url = normalize_apply_url(job.apply_url)
        if norm_url != job.apply_url:
            job = JobListing(
                title=job.title,
                company=job.company,
                location=job.location,
                salary_range=job.salary_range,
                description=job.description,
                apply_url=norm_url,
                category=job.category,
            )
        fp = job.fingerprint()
        tc = job.title_company_key()
        url_keys = _url_dedupe_keys(job.apply_url)
        if fp in by_fp or tc in seen_tc or (url_keys & seen_urls):
            continue
        by_fp[fp] = job
        seen_tc.add(tc)
        seen_urls |= url_keys
    return list(by_fp.values())


def fetch_existing_keys(
    client: Client | None = None,
) -> tuple[set[str], set[str]]:
    """
    Load existing apply_url + title|company keys from Supabase.
    Returns (url_keys, title_company_keys).
    """
    existing_urls: set[str] = set()
    existing_tc: set[str] = set()
    page_size = 1_000
    start = 0
    try:
        db = client or get_supabase_admin()
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        return existing_urls, existing_tc
    while True:
        try:
            end = start + page_size - 1
            resp = (
                db.table("jobs")
                .select("apply_url,title,company")
                .range(start, end)
                .execute()
            )
            rows = resp.data or []
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            break
        if not isinstance(rows, list):
            break
        for row in rows:
            existing_urls |= _url_dedupe_keys(row.get("apply_url") or "")
            title = normalize_whitespace(row.get("title") or "").lower()
            company = normalize_whitespace(row.get("company") or "").lower()
            if title and company:
                existing_tc.add(f"{title}|{company}")
        if len(rows) < page_size:
            break
        start += page_size
    return existing_urls, existing_tc


def purge_placeholder_jobs(client: Client | None = None) -> int:
    """Delete dummy seed rows whose apply URL is example.com or a placeholder."""
    try:
        db = client or get_supabase_admin()
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        return 0

    ids: list[str] = []
    page_size = 1_000
    start = 0
    while True:
        try:
            end = start + page_size - 1
            resp = (
                db.table("jobs")
                .select("id,apply_url")
                .range(start, end)
                .execute()
            )
            rows = resp.data or []
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            return 0
        if not isinstance(rows, list):
            break
        for row in rows:
            url = row.get("apply_url") or ""
            if _PLACEHOLDER_URL_RE.search(url):
                row_id = row.get("id")
                if row_id:
                    ids.append(str(row_id))
        if len(rows) < page_size:
            break
        start += page_size

    deleted = 0
    batch_size = 100
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        try:
            resp = db.table("jobs").delete().in_("id", batch).execute()
            deleted += len(resp.data or batch)
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
    _log(f"[scraper] Purged {deleted} placeholder/example.com job rows")
    return deleted


def count_jobs(client: Client | None = None) -> int:
    """Count jobs via supabase-py (SECRET_KEY) — never browser User-Agent."""
    try:
        db = client or get_supabase_admin()
        resp = db.table("jobs").select("id", count="exact").limit(1).execute()
        if resp.count is not None:
            return int(resp.count)
        return len(resp.data or [])
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
        "apply_url": normalize_apply_url(job.apply_url) or job.apply_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def insert_jobs(jobs: list[JobListing]) -> tuple[int, int]:
    """
    Insert new jobs via supabase-py + SECRET_KEY only.
    Validates required fields and skips URL / title+company duplicates.
    """
    _log("[scraper] Loading existing apply_url / title+company keys from database…")
    try:
        db = get_supabase_admin()
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        return 0, len(jobs)
    try:
        existing_urls, existing_tc = fetch_existing_keys(db)
    except Exception as e:
        print(f"Error scraping target: {e}", flush=True)
        existing_urls, existing_tc = set(), set()
    _log(
        f"[scraper] Found {len(existing_urls)} URL keys and "
        f"{len(existing_tc)} title+company keys in Supabase"
    )

    fresh: list[JobListing] = []
    skipped = 0
    for job in jobs:
        if not is_valid_record(job.title, job.company, job.apply_url):
            skipped += 1
            continue
        norm_url = normalize_apply_url(job.apply_url)
        url_keys = _url_dedupe_keys(norm_url)
        tc = f"{job.title.strip().lower()}|{job.company.strip().lower()}"
        if (url_keys & existing_urls) or tc in existing_tc:
            skipped += 1
            continue
        if norm_url != job.apply_url:
            job = JobListing(
                title=job.title,
                company=job.company,
                location=job.location,
                salary_range=job.salary_range,
                description=job.description,
                apply_url=norm_url,
                category=job.category,
            )
        fresh.append(job)
        # Prevent intra-batch duplicates in the same nightly run
        existing_urls |= url_keys
        existing_tc.add(tc)

    if not fresh:
        _log("[scraper] No new jobs to insert (all duplicates or invalid)")
        return 0, skipped

    rows = [to_row(j) for j in fresh]
    inserted = 0
    batch_size = 40
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            # ignore_duplicates guards races against unique apply_url index
            db.table("jobs").upsert(batch, ignore_duplicates=True).execute()
            inserted += len(batch)
            _log(
                f"[scraper] Successfully written batch {i // batch_size + 1} "
                f"to database (+{len(batch)})"
            )
        except Exception as e:
            # Fallback to plain insert if upsert API mismatches
            try:
                db.table("jobs").insert(batch).execute()
                inserted += len(batch)
                _log(
                    f"[scraper] Successfully written batch {i // batch_size + 1} "
                    f"via insert (+{len(batch)})"
                )
            except Exception as e2:
                print(f"Error scraping target: {e2} (upsert: {e})", flush=True)
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

    # Re-read credentials after CI exports; SECRET_KEY ⇒ attempt server-side writes
    url, anon, secret = refresh_supabase_credentials()
    print(
        f"[scraper] Supabase Client Initialized: URL={url}, "
        f"Anon Present={bool(anon)}, Secret Present={bool(secret)} "
        f"(secret_len={len(secret)})",
        flush=True,
    )
    can_write = supabase_available()
    if not can_write:
        print(
            "[scraper] WARNING: SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY missing "
            "— will scrape but cannot write.",
            flush=True,
        )
    else:
        # Fail fast with a clear error if create_client cannot be constructed.
        try:
            get_supabase_admin()
            _log("[scraper] create_client(supabase_url=…, supabase_key=…) OK")
            purge_placeholder_jobs()
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            can_write = False

    try:
        _log("[scraper] Starting scrape_all()…")
        try:
            scraped = scrape_all()
        except Exception as e:
            print(f"Error scraping target: {e}", flush=True)
            scraped = []

        unique = deduplicate(scraped)
        _log(
            f"[scraper] Scraped {len(scraped)} → {len(unique)} after filters/dedupe "
            f"(≤{MAX_LISTING_AGE_DAYS}d, remote-only, title+company+url required)."
        )
        _log(f"[scraper] Category mix: {category_breakdown(unique)}")

        if unique and can_write:
            priority = sorted(
                unique,
                key=lambda j: (
                    0 if j.category in ("Support", "Sales") else 1,
                    j.title,
                ),
            )
            _log("[scraper] Inserting into Supabase…")
            print(f"[scraper] Connecting to Supabase at: {SUPABASE_URL}", flush=True)
            try:
                inserted, skipped = insert_jobs(priority)
                total = count_jobs()
                _log(
                    f"[scraper] Inserted {inserted}; skipped {skipped}. "
                    f"DB total={total}."
                )
            except Exception as e:
                print(f"Error scraping target: {e}", flush=True)
        elif unique and not can_write:
            _log(
                f"[scraper] Scraped {len(scraped)} → {len(unique)} after filters/dedupe "
                "(not written — SUPABASE_SECRET_KEY missing)."
            )
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
