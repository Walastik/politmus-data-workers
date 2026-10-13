"""Polite, bounded crawler for officials' websites.

Finds the pages where an official lists the issues they stand for (an
"Issues" / "Priorities" index and its child pages) and returns them as cleaned
text. Rules:

- one host only (the official's site, after any initial redirect)
- robots.txt is honored; a fixed delay separates requests to the host
- HTML only, size-capped, no JavaScript, no file downloads, query strings
  only on issue-like paths
- 403 / bot walls are recorded as "blocked", never worked around

bs4 and trafilatura are imported lazily so the API image (which imports
services/ but never crawls) does not need them.
"""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import Callable
from urllib import robotparser
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit

import httpx

DEFAULT_USER_AGENT = (
    "PolitmusBot/1.0 (+https://politmus.com; reads public issue pages of "
    "elected officials)"
)
DEFAULT_DELAY_SECONDS = 3.0
DEFAULT_MAX_PAGES = 20
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_PAGE_BYTES = 2_000_000
MAX_PAGE_TEXT_CHARS = 60_000
MAX_RETRIES = 3
MAX_INDEX_PAGES = 3
# Below this much text across all pages the site likely renders with JS.
MIN_SITE_TEXT_CHARS = 300
# Pages shorter than this (empty stubs, placeholder lists) are not sent to the model.
MIN_PAGE_TEXT_CHARS = 120

# Paths probed when the homepage nav has no issue-like link.
COMMON_ISSUE_PATHS = (
    "/issues",
    "/issues-and-legislation",
    "/priorities",
    "/on-the-issues",
    "/legislation",
)

# Anchor-text / path phrases that mark a page about policy positions.
POSITIVE_TERMS = {
    "on the issues": 12,
    "where i stand": 12,
    "issues": 10,
    "issue": 8,
    "priorities": 10,
    "priority": 8,
    "fighting for": 8,
    "agenda": 7,
    "policies": 7,
    "policy": 6,
    "legislative": 5,
    "legislation": 5,
    "congress": 3,
}

# First path segments that are never position pages (news, constituent
# services, forms). Matched as prefixes so media-center, newsroom, etc. count.
NEGATIVE_SEGMENT_PREFIXES = (
    "about",
    "academ",
    "accessib",
    "blog",
    "calendar",
    "casework",
    "community-project",
    "constituent",
    "contact",
    "district",
    "email",
    "event",
    "flag",
    "form",
    "grant",
    "help",
    "intern",
    "job",
    "login",
    "media",
    "newsletter",
    "news",
    "office",
    "passport",
    "photo",
    "press",
    "privacy",
    "rss",
    "schedul",
    "search",
    "services",
    "sign-up",
    "signup",
    "subscribe",
    "tour",
    "video",
)

# Never position pages wherever they appear in a path, even under /issues/:
# earmark / funding request lists, forms, contests, and site boilerplate.
NEGATIVE_PATH_SUBSTRINGS = (
    "community-project",
    "appropriations-request",
    "funding-request",
    "earmark",
    "nomination",
    "application-form",
    "app-challenge",
    "competition",
    "internship",
    "privacy",
    "accessibility",
    "flag-request",
    "tour-request",
    "press-release",
    "newsletter",
    "casework",
)

# Anchor text that marks a non-position link even if it also says "policy" etc.
NEGATIVE_ANCHOR_TERMS = (
    "privacy",
    "accessibility",
    "competition",
    "app challenge",
    "nomination",
    "internship",
    "flag request",
    "tour request",
    "newsletter",
    "press release",
    "contact",
)

SKIP_EXTENSIONS = (
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip",
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".mp3", ".mp4", ".mov",
    ".ics", ".xml", ".json", ".css", ".js",
)

_WS_RE = re.compile(r"\s+")


@dataclass
class CrawlConfig:
    user_agent: str = DEFAULT_USER_AGENT
    delay_seconds: float = DEFAULT_DELAY_SECONDS
    max_pages: int = DEFAULT_MAX_PAGES
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS


@dataclass
class CrawledPage:
    url: str
    page_kind: str  # home | issues_index | issue_detail
    title: str | None
    text: str
    content_hash: str
    http_status: int


@dataclass
class CrawlResult:
    # ok | no_website | no_issue_pages | blocked | needs_js | failed
    status: str
    start_url: str | None = None
    pages: list[CrawledPage] = field(default_factory=list)
    error: str | None = None


@dataclass
class _Response:
    status_code: int
    headers: httpx.Headers
    body: bytes
    encoding: str | None

    @property
    def is_redirect(self) -> bool:
        return self.status_code in (301, 302, 303, 307, 308)

    @property
    def text(self) -> str:
        return self.body.decode(self.encoding or "utf-8", errors="replace")


@dataclass
class _Fetch:
    url: str
    status: int
    html: str | None = None
    error: str | None = None


@dataclass
class LinkCandidate:
    url: str
    text: str
    score: int


def normalize_start_url(url: str | None) -> str | None:
    value = (url or "").strip()
    if not value:
        return None
    if value.startswith("//"):
        value = "https:" + value
    if not value.lower().startswith(("http://", "https://")):
        value = "https://" + value
    parts = urlsplit(value)
    if not parts.netloc:
        return None
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", "", ""))


def host_key(host: str) -> str:
    host = (host or "").lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clean_link(base_url: str, href: str | None, allowed_host: str) -> str | None:
    """Absolute, same-host, fragment-free http(s) URL, or None."""
    if not href:
        return None
    href = href.strip()
    if href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None
    absolute, _ = urldefrag(urljoin(base_url, href))
    parts = urlsplit(absolute)
    if parts.scheme not in ("http", "https"):
        return None
    if host_key(parts.netloc) != allowed_host:
        return None
    path = parts.path or "/"
    if path.lower().endswith(SKIP_EXTENSIONS):
        return None
    if len(path) > 1:
        path = path.rstrip("/")
    query = ""
    if parts.query:
        # Older House/Senate CMSs address issues as /issues/issue/?IssueID=123.
        # Keep queries only there; elsewhere they are search/calendar traps.
        if score_link(urlunsplit((parts.scheme, parts.netloc, path, "", "")), "") <= 0:
            return None
        query = parts.query
    return urlunsplit((parts.scheme, parts.netloc.lower(), path, query, ""))


def path_segments(url: str) -> list[str]:
    return [s for s in urlsplit(url).path.lower().split("/") if s]


def _is_issue_segment(segment: str) -> bool:
    words = segment.replace("-", " ").replace("_", " ")
    return any(
        weight >= 5 and re.search(rf"\b{re.escape(term)}\b", words)
        for term, weight in POSITIVE_TERMS.items()
    )


def is_negative_path(url: str) -> bool:
    """News, services, forms, and boilerplate paths.

    Prefix rules apply to every segment until an issue-like segment appears
    (so /public/index.cfm/news-releases is out but /issues/help, a Senate
    committee page, is kept). Substring rules apply everywhere.
    """
    segments = path_segments(url)
    for segment in segments:
        if any(term in segment for term in NEGATIVE_PATH_SUBSTRINGS):
            return True
    for segment in segments:
        if _is_issue_segment(segment):
            break
        if segment.startswith(NEGATIVE_SEGMENT_PREFIXES):
            return True
    return False


def score_link(url: str, text: str) -> int:
    """Higher means more likely to be an issues / priorities page."""
    if is_negative_path(url):
        return 0
    anchor = _WS_RE.sub(" ", (text or "").lower()).strip()
    if any(term in anchor for term in NEGATIVE_ANCHOR_TERMS):
        return 0
    path = " ".join(path_segments(url)).replace("-", " ").replace("_", " ")
    score = 0
    for term, weight in POSITIVE_TERMS.items():
        if term in anchor:
            score = max(score, weight + 2)
        if re.search(rf"\b{re.escape(term)}\b", path):
            score = max(score, weight)
    return score


def extract_links(html: str, base_url: str, allowed_host: str) -> list[tuple[str, str]]:
    """(url, anchor text) for every same-host link, first occurrence wins."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    seen: dict[str, str] = {}
    for anchor in soup.find_all("a", href=True):
        url = clean_link(base_url, anchor.get("href"), allowed_host)
        if not url or url in seen:
            continue
        text = _WS_RE.sub(" ", anchor.get_text(" ", strip=True)).strip()
        seen[url] = text or (anchor.get("title") or "")
    return list(seen.items())


def page_title(html: str) -> str | None:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    if soup.title and soup.title.string:
        return _WS_RE.sub(" ", soup.title.string).strip() or None
    return None


def html_to_text(html: str, url: str | None = None) -> str:
    """Main content as markdown-ish text, keeping headings for chunking."""
    import trafilatura

    text = trafilatura.extract(
        html,
        url=url,
        output_format="markdown",
        include_formatting=True,
        include_links=False,
        include_images=False,
        include_tables=True,
        favor_recall=True,
    )
    if not text:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "nav", "header", "footer", "noscript"]):
            tag.decompose()
        text = soup.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    if len(text) > MAX_PAGE_TEXT_CHARS:
        text = text[:MAX_PAGE_TEXT_CHARS]
    return text


def _is_under(url: str, parent: str) -> bool:
    """True when url's path sits below parent's path."""
    child, base = path_segments(url), path_segments(parent)
    return bool(base) and len(child) > len(base) and child[: len(base)] == base


class SiteCrawler:
    """Crawls one official's site at a time with a shared polite client."""

    def __init__(
        self,
        config: CrawlConfig | None = None,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        log: Callable[[str], None] = print,
    ):
        self.config = config or CrawlConfig()
        self._client = client or httpx.Client(
            headers={
                "User-Agent": self.config.user_agent,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            },
            timeout=httpx.Timeout(self.config.timeout_seconds, connect=10.0),
            follow_redirects=False,
        )
        self._sleep = sleep
        self._clock = clock
        self._log = log
        self._last_request: dict[str, float] = {}
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}

    def close(self) -> None:
        self._client.close()

    # -- HTTP -------------------------------------------------------------

    def _pace(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            wait = self.config.delay_seconds - (self._clock() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_request[host] = self._clock()

    def _raw_get(self, url: str) -> _Response | Exception:
        """One paced GET (no redirects), size-capped, retrying 429/5xx."""
        host = host_key(urlsplit(url).netloc)
        delay = max(self.config.delay_seconds, 1.0)
        last: _Response | Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            self._pace(host)
            try:
                with self._client.stream("GET", url) as response:
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_PAGE_BYTES:
                            break
                    last = _Response(
                        response.status_code,
                        response.headers,
                        bytes(body[:MAX_PAGE_BYTES]),
                        response.charset_encoding,
                    )
            except httpx.HTTPError as exc:
                last = exc
                if attempt < MAX_RETRIES:
                    self._sleep(delay)
                    delay *= 2
                continue
            if last.status_code == 429 or last.status_code >= 500:
                retry_after = last.headers.get("Retry-After")
                try:
                    wait = float(retry_after) if retry_after else delay
                except ValueError:
                    wait = delay
                if attempt < MAX_RETRIES:
                    self._sleep(min(wait, 120.0))
                    delay *= 2
                    continue
            return last
        return last  # type: ignore[return-value]

    def _get(self, url: str, allowed_host: str | None, max_redirects: int = 5) -> _Fetch:
        """GET following redirects only while they stay on allowed_host.

        With allowed_host None (the homepage) the first hop may change host;
        the caller then adopts the final host.
        """
        current = url
        for _ in range(max_redirects + 1):
            if not self.allowed(current, allowed_host):
                return _Fetch(current, 0, error="disallowed by robots.txt")
            result = self._raw_get(current)
            if isinstance(result, Exception):
                return _Fetch(current, 0, error=f"{type(result).__name__}: {result}")
            if result.is_redirect:
                location = result.headers.get("Location")
                if not location:
                    return _Fetch(current, result.status_code, error="redirect without Location")
                target, _ = urldefrag(urljoin(current, location))
                target_host = host_key(urlsplit(target).netloc)
                if allowed_host is not None and target_host != allowed_host:
                    return _Fetch(current, result.status_code, error=f"off-site redirect to {target}")
                current = target
                continue
            content_type = result.headers.get("Content-Type", "")
            if result.status_code == 200 and "html" not in content_type.lower():
                return _Fetch(current, result.status_code, error=f"not HTML ({content_type})")
            if result.status_code != 200:
                return _Fetch(current, result.status_code, error=f"HTTP {result.status_code}")
            return _Fetch(current, 200, html=result.text)
        return _Fetch(current, 0, error="too many redirects")

    # -- robots.txt -------------------------------------------------------

    def _robots_for(self, scheme: str, netloc: str) -> robotparser.RobotFileParser | None:
        """Parsed robots.txt for a host, or None when it could not be read.

        Like major crawlers: 4xx means no rules, 401/403 means stay out, and
        a 5xx or network error means stay out for this run.
        """
        key = f"{scheme}://{netloc}"
        if key in self._robots:
            return self._robots[key]
        parser: robotparser.RobotFileParser | None = robotparser.RobotFileParser()
        url = f"{key}/robots.txt"
        result: _Response | Exception = Exception("not fetched")
        for _ in range(4):
            result = self._raw_get(url)
            if isinstance(result, _Response) and result.is_redirect and result.headers.get("Location"):
                url = urljoin(url, result.headers["Location"])
                continue
            break
        if isinstance(result, Exception) or result.status_code >= 500 or result.is_redirect:
            parser = None
        elif result.status_code in (401, 403):
            parser.disallow_all = True
        elif result.status_code >= 400:
            parser.allow_all = True
        else:
            parser.parse(result.text.splitlines())
        self._robots[key] = parser
        return parser

    def robots_reachable(self, url: str) -> bool:
        parts = urlsplit(url)
        return self._robots_for(parts.scheme, parts.netloc) is not None

    def allowed(self, url: str, allowed_host: str | None = None) -> bool:
        parts = urlsplit(url)
        if allowed_host is not None and host_key(parts.netloc) != allowed_host:
            return False
        parser = self._robots_for(parts.scheme, parts.netloc)
        if parser is None:
            return False
        return parser.can_fetch(self.config.user_agent, url)

    # -- crawl ------------------------------------------------------------

    def _page(self, fetch: _Fetch, kind: str) -> CrawledPage:
        text = html_to_text(fetch.html or "", fetch.url)
        return CrawledPage(
            url=fetch.url,
            page_kind=kind,
            title=page_title(fetch.html or ""),
            text=text,
            content_hash=content_hash(text),
            http_status=fetch.status,
        )

    def crawl(
        self,
        website_url: str | None,
        select_links_fn: Callable[[list[LinkCandidate]], list[str]] | None = None,
    ) -> CrawlResult:
        """Discover and fetch an official's issue pages.

        select_links_fn is an optional fallback (e.g. a small LLM call) given
        the homepage's links when no heuristic match is found.
        """
        start = normalize_start_url(website_url)
        if not start:
            return CrawlResult(status="no_website")

        if not self.allowed(start):
            if not self.robots_reachable(start):
                return CrawlResult(status="failed", start_url=start, error="robots.txt unreachable")
            return CrawlResult(status="blocked", start_url=start, error="robots.txt disallows the homepage")
        home = self._get(start, allowed_host=None)
        if home.html is None:
            status = "blocked" if home.status in (401, 403) else "failed"
            return CrawlResult(status=status, start_url=start, error=home.error)
        host = host_key(urlsplit(home.url).netloc)
        if not self.allowed(home.url, host):
            return CrawlResult(status="blocked", start_url=start, error="robots.txt disallows the homepage")

        max_pages = max(1, self.config.max_pages)
        fetched: dict[str, CrawledPage] = {}
        index_html: dict[str, str] = {}
        home_page = self._page(home, "home")

        candidates = sorted(
            (
                LinkCandidate(url, text, score_link(url, text))
                for url, text in extract_links(home.html, home.url, host)
                if url != home.url
            ),
            key=lambda c: (-c.score, len(c.url)),
        )
        positive = [c for c in candidates if c.score > 0]
        index_urls = [c.url for c in positive[:MAX_INDEX_PAGES]]
        # Other issue-like nav links (e.g. a menu of /legislation/<topic>
        # pages) are read as issue pages after the index pages' children.
        nav_extras = positive[MAX_INDEX_PAGES:]

        if not index_urls:
            base = urlsplit(home.url)
            for path in COMMON_ISSUE_PATHS:
                probe = urlunsplit((base.scheme, base.netloc, path, "", ""))
                result = self._get(probe, allowed_host=host)
                if result.html is not None:
                    index_html[result.url] = result.html
                    index_urls = [result.url]
                    break

        if not index_urls and select_links_fn is not None:
            pool = [c for c in candidates if not is_negative_path(c.url)][:80]
            if pool:
                try:
                    chosen = select_links_fn(pool)
                except Exception as exc:  # a fallback only; never fail the crawl on it
                    self._log(f"  link selection fallback failed: {exc}")
                    chosen = []
                pool_urls = {c.url for c in pool}
                index_urls = [u for u in chosen if u in pool_urls][:MAX_INDEX_PAGES]

        detail_queue: list[LinkCandidate] = []
        for url in index_urls:
            if len(fetched) >= max_pages:
                break
            html = index_html.get(url)
            final_url = url
            if html is None:
                result = self._get(url, allowed_host=host)
                if result.html is None:
                    self._log(f"  skip {url}: {result.error}")
                    continue
                html, final_url = result.html, result.url
            nested = any(_is_under(final_url, other) for other in index_urls if other != url)
            page = self._page(_Fetch(final_url, 200, html=html), "issue_detail" if nested else "issues_index")
            if page.url == home.url:
                continue
            fetched[page.url] = page
            detail_queue.extend(self._child_candidates(html, page.url, host))

        seen = set(fetched) | {home.url}
        queue = sorted(detail_queue, key=lambda c: (-c.score, c.url))
        queue += [c for c in nav_extras if c.url not in {q.url for q in queue}]
        for candidate in queue:
            if len(fetched) >= max_pages:
                break
            if candidate.url in seen:
                continue
            seen.add(candidate.url)
            result = self._get(candidate.url, allowed_host=host)
            if result.html is None:
                self._log(f"  skip {candidate.url}: {result.error}")
                continue
            page = self._page(result, "issue_detail")
            if page.url not in fetched and page.url != home.url:
                fetched[page.url] = page

        pages: list[CrawledPage] = []
        hashes: set[str] = set()
        # Index pages first, then by URL, so a clean URL wins over its
        # ?page=0 / ?IssueID= duplicate with the same text.
        for page in sorted(fetched.values(), key=lambda p: (p.page_kind != "issues_index", p.url)):
            if len(page.text) < MIN_PAGE_TEXT_CHARS or page.content_hash in hashes:
                continue
            hashes.add(page.content_hash)
            pages.append(page)
        pages.sort(key=lambda p: p.url)
        total_text = sum(len(p.text) for p in pages)
        if total_text >= MIN_SITE_TEXT_CHARS:
            return CrawlResult(status="ok", start_url=start, pages=pages)
        if len(home_page.text) >= MIN_SITE_TEXT_CHARS:
            # No issue section; some members list priorities on the homepage.
            return CrawlResult(status="no_issue_pages", start_url=start, pages=[home_page])
        return CrawlResult(
            status="needs_js",
            start_url=start,
            pages=pages,
            error="site returned almost no readable text without JavaScript",
        )

    def _child_candidates(self, html: str, index_url: str, host: str) -> list[LinkCandidate]:
        """Links under an index page's path, or under an issue-like section."""
        index_segments = path_segments(index_url)
        out: list[LinkCandidate] = []
        for url, text in extract_links(html, index_url, host):
            if url == index_url or is_negative_path(url):
                continue
            segments = path_segments(url)
            under_index = (
                bool(index_segments)
                and len(segments) > len(index_segments)
                and segments[: len(index_segments)] == index_segments
            )
            issue_section = len(segments) > 1 and _is_issue_segment(segments[0])
            if under_index or issue_section:
                out.append(LinkCandidate(url, text, 10 if under_index else 6))
        return out
