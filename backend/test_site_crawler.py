import os
import unittest
from pathlib import Path

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

import httpx
import respx

from services.site_crawler import (
    CrawlConfig,
    SiteCrawler,
    clean_link,
    host_key,
    is_negative_path,
    normalize_start_url,
    score_link,
)

FIXTURES = Path(__file__).resolve().parent / "tests" / "fixtures" / "official_site"
SITE = "https://example-rep.house.gov"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def html(body: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, text=body, headers={"Content-Type": "text/html; charset=utf-8"})


def mount_site(router, robots: str | None = None):
    router.get(f"{SITE}/robots.txt").mock(
        return_value=httpx.Response(200, text=robots if robots is not None else fixture("robots.txt"))
    )
    router.get(f"{SITE}/").mock(return_value=html(fixture("home.html")))
    router.get(f"{SITE}/congress").mock(return_value=html(fixture("congress.html")))
    router.get(f"{SITE}/issues/climate").mock(return_value=html(fixture("climate.html")))
    router.get(f"{SITE}/issues/health-care").mock(return_value=html(fixture("health-care.html")))
    router.get(f"{SITE}/issues/criminal-justice-reform").mock(
        return_value=html("<html><body><main><h1>CJR</h1><p>Should never be fetched.</p></main></body></html>")
    )


def make_crawler(sleeps=None, **config):
    sleeps = sleeps if sleeps is not None else []
    return SiteCrawler(
        CrawlConfig(**{"delay_seconds": 3.0, **config}),
        client=httpx.Client(),
        sleep=sleeps.append,
        clock=lambda: 0.0,
        log=lambda _msg: None,
    )


class UrlHelperTests(unittest.TestCase):
    def test_normalize_start_url_adds_scheme_and_path(self):
        self.assertEqual(normalize_start_url("example-rep.house.gov"), "https://example-rep.house.gov/")
        self.assertEqual(normalize_start_url("//Example-Rep.house.gov/x?y=1"), "https://example-rep.house.gov/x")
        self.assertIsNone(normalize_start_url("  "))

    def test_host_key_ignores_www(self):
        self.assertEqual(host_key("www.Example.senate.gov"), "example.senate.gov")

    def test_clean_link_keeps_same_host_html_paths_only(self):
        host = "example-rep.house.gov"
        self.assertEqual(clean_link(SITE + "/", "/issues/climate/#top", host), SITE + "/issues/climate")
        self.assertIsNone(clean_link(SITE + "/", "https://twitter.com/x", host))
        self.assertIsNone(clean_link(SITE + "/", "/search?q=x", host))
        self.assertIsNone(clean_link(SITE + "/", "/calendar?date=2026-01-01", host))
        self.assertEqual(
            clean_link(SITE + "/", "/issues/issue/?IssueID=14895", host),
            SITE + "/issues/issue?IssueID=14895",
        )
        # Pagination under an issue lists related news, not more positions.
        self.assertIsNone(clean_link(SITE + "/", "/legislation/climate?page=2", host))
        self.assertIsNone(clean_link(SITE + "/", "/issues/values?Page=1", host))
        self.assertIsNone(clean_link(SITE + "/", "/files/plan.pdf", host))
        self.assertIsNone(clean_link(SITE + "/", "mailto:a@b.gov", host))

    def test_scoring_prefers_issue_pages_and_rejects_news_and_services(self):
        self.assertGreater(score_link(SITE + "/issues", "Issues"), 0)
        self.assertGreater(score_link(SITE + "/congress", "In Congress"), 0)
        self.assertGreater(score_link(SITE + "/priorities", ""), 0)
        self.assertEqual(score_link(SITE + "/media/press-releases", "Issues in the news"), 0)
        self.assertEqual(score_link(SITE + "/services/issues", "Issues"), 0)
        self.assertTrue(is_negative_path(SITE + "/newsroom"))
        self.assertFalse(is_negative_path(SITE + "/issues/financial-services"))

    def test_rejects_noise_seen_on_real_member_sites(self):
        noise = [
            ("/congress/fy24-community-project-funds", "FY24 Community Project Funds"),
            ("/congress/fy26-appropriations-request", "FY26 Appropriations Requests"),
            ("/issues/project-requests", "Project Requests"),
            ("/fy25-project-requests", "FY25 Project Requests"),
            ("/congressional-app-challenge", "Congressional App Challenge"),
            ("/constituent-services/arts-competition.htm", "Art Competition"),
            ("/issues/military-academy-nomination-application-form", "Academy Nominations"),
            ("/public/index.cfm/privacypolicy", "Privacy Policy"),
            ("/public/index.cfm/news-releases", "News"),
            ("/legislation/committees-and-caucuses", "Committees and Caucuses"),
        ]
        for path, text in noise:
            self.assertEqual(score_link(SITE + path, text), 0, path)

    def test_keeps_issue_pages_on_real_member_site_layouts(self):
        keep = [
            ("/legislation/climate", "Climate"),
            ("/public/index.cfm/foreign-policy", "Foreign Policy"),
            ("/issues/help", "HELP"),  # Senate committee, not a help desk
            ("/legislative-work/healthcare", "Healthcare"),
            ("/about/issues", "Issues"),  # Senate sites nest issues under /about
        ]
        for path, text in keep:
            self.assertGreater(score_link(SITE + path, text), 0, path)


class CrawlTests(unittest.TestCase):
    @respx.mock
    def test_discovers_index_and_child_pages_and_honors_robots(self):
        mount_site(respx)
        sleeps = []
        result = make_crawler(sleeps).crawl("example-rep.house.gov")

        self.assertEqual(result.status, "ok")
        urls = [p.url for p in result.pages]
        self.assertEqual(urls, [
            SITE + "/congress",
            SITE + "/issues/climate",
            SITE + "/issues/health-care",
        ])
        kinds = {p.url: p.page_kind for p in result.pages}
        self.assertEqual(kinds[SITE + "/congress"], "issues_index")
        self.assertEqual(kinds[SITE + "/issues/climate"], "issue_detail")
        congress = next(p for p in result.pages if p.url.endswith("/congress"))
        self.assertIn("## Climate", congress.text)
        self.assertIn("Clean Jobs Act", congress.text)
        self.assertNotIn("Contact", congress.text.split("\n")[0])
        self.assertEqual(len(congress.content_hash), 64)

        fetched = {str(call.request.url) for call in respx.calls}
        self.assertNotIn(SITE + "/issues/criminal-justice-reform", fetched)
        self.assertNotIn(SITE + "/media/press-releases", fetched)
        self.assertNotIn(SITE + "/contact", fetched)
        # Every request after the first waits out the per-host delay.
        self.assertTrue(sleeps)
        self.assertTrue(all(s == 3.0 for s in sleeps))

    @respx.mock
    def test_duplicate_and_tiny_pages_are_dropped(self):
        mount_site(respx)
        congress = fixture("congress.html").replace(
            "</main>",
            '<a href="/issues/climate?page=0">Climate page 0</a>'
            '<a href="/issues/apply">Apply</a></main>',
        )
        respx.get(f"{SITE}/congress").mock(return_value=html(congress))
        respx.get(f"{SITE}/issues/climate?page=0").mock(return_value=html(fixture("climate.html")))
        respx.get(f"{SITE}/issues/apply").mock(
            return_value=html("<html><body><main><p>Apply here.</p></main></body></html>")
        )
        result = make_crawler().crawl(SITE)
        urls = [p.url for p in result.pages]
        self.assertIn(SITE + "/issues/climate", urls)
        self.assertNotIn(SITE + "/issues/climate?page=0", urls)
        self.assertNotIn(SITE + "/issues/apply", urls)

    @respx.mock
    def test_follows_remaining_nav_issue_links_as_issue_pages(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=httpx.Response(404))
        topics = ["climate", "foreign-policy", "housing", "health-care", "immigration"]
        nav = "".join(f'<a href="/legislation/{t}">{t.title()}</a>' for t in topics)
        respx.get(f"{SITE}/").mock(return_value=html(
            f"<html><body><nav><a href='/congress'>In Congress</a>{nav}</nav></body></html>"
        ))
        respx.get(f"{SITE}/congress").mock(return_value=html(
            "<html><body><main><h1>In Congress</h1><p>" + "Work in Congress. " * 20 + "</p></main></body></html>"
        ))
        for t in topics:
            respx.get(f"{SITE}/legislation/{t}").mock(return_value=html(
                f"<html><body><main><h1>{t}</h1><p>" + f"Her position on {t}. " * 15 + "</p></main></body></html>"
            ))
        result = make_crawler().crawl(SITE)
        urls = [p.url for p in result.pages]
        for t in topics:
            self.assertIn(f"{SITE}/legislation/{t}", urls)

    @respx.mock
    def test_respects_max_pages(self):
        mount_site(respx)
        result = make_crawler(max_pages=2).crawl(SITE)
        self.assertEqual(len(result.pages), 2)

    @respx.mock
    def test_forbidden_homepage_is_blocked(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=httpx.Response(404))
        respx.get(f"{SITE}/").mock(return_value=html("Access denied", status=403))
        result = make_crawler().crawl(SITE)
        self.assertEqual(result.status, "blocked")
        self.assertEqual(result.pages, [])

    @respx.mock
    def test_robots_disallow_all_blocks_without_fetching_homepage(self):
        respx.get(f"{SITE}/robots.txt").mock(
            return_value=httpx.Response(200, text="User-agent: *\nDisallow: /\n")
        )
        home = respx.get(f"{SITE}/").mock(return_value=html(fixture("home.html")))
        result = make_crawler().crawl(SITE)
        self.assertEqual(result.status, "blocked")
        self.assertFalse(home.called)

    @respx.mock
    def test_forbidden_robots_txt_blocks(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=httpx.Response(403))
        home = respx.get(f"{SITE}/").mock(return_value=html(fixture("home.html")))
        result = make_crawler().crawl(SITE)
        self.assertEqual(result.status, "blocked")
        self.assertFalse(home.called)

    @respx.mock
    def test_robots_redirect_to_forbidden_error_page_means_no_rules(self):
        # Senate sites: /robots.txt -> 302 /404?notfound=/robots.txt -> 403.
        respx.get(f"{SITE}/robots.txt").mock(
            return_value=httpx.Response(302, headers={"Location": "/404?notfound=/robots.txt"})
        )
        respx.get(f"{SITE}/404").mock(return_value=html("Not found", status=403))
        crawler = make_crawler()
        self.assertTrue(crawler.allowed(f"{SITE}/"))
        self.assertTrue(crawler.allowed(f"{SITE}/issues"))

    @respx.mock
    def test_robots_redirect_to_html_page_means_no_rules(self):
        respx.get(f"{SITE}/robots.txt").mock(
            return_value=httpx.Response(302, headers={"Location": "/not-found"})
        )
        respx.get(f"{SITE}/not-found").mock(
            return_value=html("<html><body>User-agent: *\nDisallow: /</body></html>")
        )
        self.assertTrue(make_crawler().allowed(f"{SITE}/"))

    @respx.mock
    def test_robots_redirect_to_real_robots_file_is_honored(self):
        respx.get(f"{SITE}/robots.txt").mock(
            return_value=httpx.Response(301, headers={"Location": "https://www.example-rep.house.gov/robots.txt"})
        )
        respx.get("https://www.example-rep.house.gov/robots.txt").mock(
            return_value=httpx.Response(
                200, text="User-agent: *\nDisallow: /\n", headers={"Content-Type": "text/plain"}
            )
        )
        self.assertFalse(make_crawler().allowed(f"{SITE}/"))

    @respx.mock
    def test_redirect_to_soft_404_page_is_not_a_page(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=httpx.Response(404))
        respx.get(f"{SITE}/issues").mock(
            return_value=httpx.Response(302, headers={"Location": "/404?notfound=/issues"})
        )
        respx.get(f"{SITE}/404").mock(return_value=html(fixture("climate.html")))
        fetch = make_crawler()._get(f"{SITE}/issues", allowed_host="example-rep.house.gov")
        self.assertIsNone(fetch.html)
        self.assertEqual(fetch.status, 404)

    @respx.mock
    def test_offsite_redirect_is_not_followed(self):
        mount_site(respx)
        respx.get(f"{SITE}/congress").mock(
            return_value=httpx.Response(302, headers={"Location": "https://evil.example.com/congress"})
        )
        evil = respx.get("https://evil.example.com/congress").mock(return_value=html("<p>x</p>"))
        result = make_crawler().crawl(SITE)
        self.assertFalse(evil.called)
        self.assertNotIn(SITE + "/congress", [p.url for p in result.pages])

    @respx.mock
    def test_homepage_redirect_to_new_host_is_adopted(self):
        respx.get("https://old-rep.house.gov/robots.txt").mock(return_value=httpx.Response(404))
        respx.get("https://old-rep.house.gov/").mock(
            return_value=httpx.Response(301, headers={"Location": SITE + "/"})
        )
        mount_site(respx)
        result = make_crawler().crawl("https://old-rep.house.gov")
        self.assertEqual(result.status, "ok")
        self.assertTrue(all(p.url.startswith(SITE) for p in result.pages))

    @respx.mock
    def test_probes_common_paths_when_nav_has_no_issue_link(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=httpx.Response(404))
        respx.get(f"{SITE}/").mock(return_value=html(
            "<html><body><nav><a href='/contact'>Contact</a></nav><main><p>Welcome.</p></main></body></html>"
        ))
        respx.get(f"{SITE}/issues").mock(return_value=html(fixture("congress.html")))
        respx.get(url__regex=rf"{SITE}/issues/.+").mock(return_value=html(fixture("climate.html")))
        result = make_crawler().crawl(SITE)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.pages[0].url, SITE + "/issues")

    @respx.mock
    def test_link_selector_fallback_is_used_last(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=html("", status=404))
        respx.get(f"{SITE}/").mock(return_value=html(
            "<html><body><nav><a href='/what-matters'>What Matters</a>"
            "<a href='/contact'>Contact</a></nav></body></html>"
        ))
        respx.get(url__regex=rf"{SITE}/(issues|issues-and-legislation|priorities|on-the-issues|legislation)$").mock(
            return_value=httpx.Response(404, text="nope", headers={"Content-Type": "text/html"})
        )
        respx.get(f"{SITE}/what-matters").mock(return_value=html(fixture("congress.html")))
        respx.get(url__regex=rf"{SITE}/issues/.+").mock(return_value=html(fixture("climate.html")))
        seen = []

        def selector(candidates):
            seen.extend(c.url for c in candidates)
            return [SITE + "/what-matters", "https://elsewhere.example.com/"]

        result = make_crawler().crawl(SITE, select_links_fn=selector)
        self.assertIn(SITE + "/what-matters", seen)
        self.assertNotIn(SITE + "/contact", seen)
        self.assertEqual(result.status, "ok")
        self.assertIn(SITE + "/what-matters", [p.url for p in result.pages])

    @respx.mock
    def test_script_only_site_needs_js(self):
        respx.get(f"{SITE}/robots.txt").mock(return_value=httpx.Response(404))
        respx.get(f"{SITE}/").mock(return_value=html(
            "<html><body><div id='root'></div><script src='/app.js'></script></body></html>"
        ))
        respx.get(url__regex=rf"{SITE}/.+").mock(return_value=httpx.Response(404, headers={"Content-Type": "text/html"}))
        result = make_crawler().crawl(SITE)
        self.assertEqual(result.status, "needs_js")

    @respx.mock
    def test_retries_server_errors_then_succeeds(self):
        mount_site(respx)
        respx.get(f"{SITE}/").mock(side_effect=[
            httpx.Response(503, headers={"Retry-After": "7"}),
            html(fixture("home.html")),
        ])
        sleeps = []
        result = make_crawler(sleeps).crawl(SITE)
        self.assertEqual(result.status, "ok")
        self.assertIn(7.0, sleeps)

    def test_missing_website_url(self):
        self.assertEqual(make_crawler().crawl(None).status, "no_website")


if __name__ == "__main__":
    unittest.main()
