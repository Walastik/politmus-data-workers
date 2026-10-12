import hashlib
import json
import logging
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
import respx

from api.main import app
from api.routes.voter_info import (
    CIVIC_VOTER_INFO_URL,
    rate_limiter,
    response_cache,
    sanitize_url,
)

FIXTURE_PATH = Path(__file__).parent / "tests" / "fixtures" / "voter_info_2000.json"


@pytest.fixture
def sample_vip_fixture():
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(autouse=True)
def reset_app_state(monkeypatch):
    """Ensure in-memory rate limiter and caches are clean and test env vars are set."""
    rate_limiter.clear()
    response_cache.clear()
    monkeypatch.setenv("GOOGLE_CIVIC_API_KEY", "test-civic-api-key")
    monkeypatch.setenv("TRUSTED_PROXY", "false")
    monkeypatch.delenv("CIVIC_ELECTION_ID_OVERRIDE", raising=False)
    yield
    rate_limiter.clear()
    response_cache.clear()


@pytest_asyncio.fixture
async def client():
    """Async test client with shared app.state.http_client."""
    app.state.http_client = httpx.AsyncClient(timeout=8.0)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        await app.state.http_client.aclose()


@pytest.mark.asyncio
async def test_voter_info_fixture_2000_live(client, sample_vip_fixture):
    """Test full parsing and serialization of authentic Google Civic 2000 test election fixture."""
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json=sample_vip_fixture,
            headers={"Cache-Control": "public, max-age=120"},
        )

        res = await client.post(
            "/api/voter-info",
            json={"address": "1263 Pacific Ave, Kansas City, KS 66102"},
        )

        assert res.status_code == 200
        assert res.headers["cache-control"] == "no-store"

        data = res.json()
        assert data["uiState"] == "live"
        assert data["upstreamStatus"] == "success"
        assert data["mailOnly"] is False

        # Election details
        assert data["election"]["id"] == "2000"
        assert data["election"]["name"] == "VIP Test Election"
        assert data["election"]["date"] == "2024-11-05"

        # Polling locations
        assert len(data["pollingLocations"]) == 1
        poll = data["pollingLocations"][0]
        assert poll["locationName"] == "Kansas City Community Center"
        assert poll["line1"] == "1263 Pacific Ave"
        assert poll["city"] == "Kansas City"
        assert poll["state"] == "KS"
        assert poll["zip"] == "66102"
        assert poll["notes"] == "Main gymnasium, enter through south doors."
        assert "Valid photo ID required" in poll["pollingHours"]
        assert poll["sources"][0]["name"] == "Voting Information Project"
        assert poll["sources"][0]["official"] is True

        # Early vote sites
        assert len(data["earlyVoteSites"]) == 1
        early = data["earlyVoteSites"][0]
        assert early["locationName"] == "Wyandotte County Election Office"
        assert early["line1"] == "850 State Ave"

        # Drop off locations
        assert len(data["dropOffLocations"]) == 1
        drop = data["dropOffLocations"][0]
        assert drop["locationName"] == "City Hall Ballot Drop Box"
        assert drop["line1"] == "701 N 7th St"

        # Admin bodies
        state_admin = data["adminBodies"]["state"]
        assert state_admin["name"] == "Kansas Secretary of State"
        assert state_admin["electionInfoUrl"] == "https://sos.ks.gov/elections/elections.html"
        assert state_admin["electionRegistrationUrl"] == "https://www.ksvotes.org/"
        assert state_admin["physicalAddress"]["city"] == "Topeka"
        assert state_admin["phone"] == "(785) 296-4561"
        assert state_admin["email"] == "election@ks.gov"

        local_admin = data["adminBodies"]["local"]
        assert local_admin["name"] == "Wyandotte County Election Commissioner"
        assert local_admin["electionInfoUrl"] == "https://www.wycokck.org/Departments/Election-Office"
        assert local_admin["phone"] == "(913) 573-8500"


@pytest.mark.asyncio
async def test_voter_info_ui_state_mail_only(client):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={
                "status": "success",
                "mailOnly": True,
                "election": {"id": "1", "name": "Colorado State Primary"},
                "pollingLocations": [],
            },
        )

        res = await client.post("/api/voter-info", json={"address": "Denver, CO"})
        assert res.status_code == 200
        assert res.headers["cache-control"] == "no-store"
        data = res.json()
        assert data["uiState"] == "mail_only"
        assert data["mailOnly"] is True


@pytest.mark.asyncio
async def test_voter_info_ui_state_no_locations_yet(client):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={
                "status": "success",
                "election": {"id": "100", "name": "Upcoming Special Election"},
                "pollingLocations": [],
                "earlyVoteSites": [],
                "dropOffLocations": [],
            },
        )

        res = await client.post("/api/voter-info", json={"address": "Austin, TX"})
        assert res.status_code == 200
        data = res.json()
        assert data["uiState"] == "no_locations_yet"


@pytest.mark.asyncio
async def test_voter_info_ui_state_no_data_yet(client):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={"status": "noStreetSegmentFound"},
        )

        res = await client.post("/api/voter-info", json={"address": "Remote Rural Rd, NM"})
        assert res.status_code == 200
        data = res.json()
        assert data["uiState"] == "no_data_yet"


@pytest.mark.asyncio
async def test_voter_info_ui_state_nearby_only_omits_location_arrays(client):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={
                "status": "multipleStreetSegmentsFound",
                "pollingLocations": [{"address": {"line1": "100 Ambiguous Way"}}],
                "earlyVoteSites": [{"address": {"line1": "200 Ambiguous Way"}}],
                "dropOffLocations": [{"address": {"line1": "300 Ambiguous Way"}}],
            },
        )

        res = await client.post("/api/voter-info", json={"address": "Main St, Springfield, IL"})
        assert res.status_code == 200
        data = res.json()
        assert data["uiState"] == "nearby_only"
        # Per specification: nearby_only omits location arrays to prevent misleading voters
        assert data["pollingLocations"] == []
        assert data["earlyVoteSites"] == []
        assert data["dropOffLocations"] == []


@pytest.mark.asyncio
async def test_voter_info_ui_state_election_over(client):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={"status": "electionOver"},
        )

        res = await client.post("/api/voter-info", json={"address": "Chicago, IL"})
        assert res.status_code == 200
        data = res.json()
        assert data["uiState"] == "election_over"


@pytest.mark.asyncio
async def test_voter_info_ui_state_no_election_200_and_400(client):
    # Case 1: 200 response with electionUnknown status
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={"status": "electionUnknown"},
        )

        res = await client.post("/api/voter-info", json={"address": "Seattle, WA"})
        assert res.status_code == 200
        assert res.json()["uiState"] == "no_election"

    # Case 2: Upstream 400 with electionUnknown error reason
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            400,
            json={
                "error": {
                    "errors": [{"reason": "electionUnknown", "message": "Election unknown"}],
                    "message": "Election unknown",
                }
            },
        )

        res = await client.post("/api/voter-info", json={"address": "Seattle, WA"})
        assert res.status_code == 200
        assert res.headers["cache-control"] == "no-store"
        data = res.json()
        assert data["uiState"] == "no_election"


@pytest.mark.asyncio
async def test_voter_info_ui_state_address_problem_200_and_400(client):
    # Case 1: 200 response with addressUnparseable status
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={"status": "addressUnparseable"},
        )

        res = await client.post("/api/voter-info", json={"address": "Invalid Fake Rd"})
        assert res.status_code == 200
        assert res.json()["uiState"] == "address_problem"

    # Case 2: Upstream 400 with addressUnparseable error reason
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            400,
            json={
                "error": {
                    "errors": [{"reason": "addressUnparseable", "message": "Address unparseable"}],
                    "message": "Address unparseable",
                }
            },
        )

        res = await client.post("/api/voter-info", json={"address": "Invalid Fake Rd"})
        assert res.status_code == 200
        assert res.headers["cache-control"] == "no-store"
        assert res.json()["uiState"] == "address_problem"


@pytest.mark.asyncio
async def test_voter_info_upstream_403_forbidden(client, caplog):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(403, json={"error": "Forbidden key"})

        with caplog.at_level(logging.WARNING):
            res = await client.post("/api/voter-info", json={"address": "Boston, MA"})

        assert res.status_code == 502
        assert res.headers["cache-control"] == "no-store"
        data = res.json()
        assert data["uiState"] == "unavailable"
        assert data["upstreamStatus"] == "upstream_forbidden"
        assert "Upstream Civic API returned 403 forbidden" in caplog.text


@pytest.mark.asyncio
async def test_voter_info_upstream_429_quota(client, caplog):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(429, json={"error": "Rate limit reached"})

        with caplog.at_level(logging.WARNING):
            res = await client.post("/api/voter-info", json={"address": "Miami, FL"})

        assert res.status_code == 502
        assert res.headers["cache-control"] == "no-store"
        data = res.json()
        assert data["uiState"] == "unavailable"
        assert data["upstreamStatus"] == "upstream_rate_limited"
        assert "Upstream Civic API quota exceeded (429)" in caplog.text


@pytest.mark.asyncio
async def test_voter_info_upstream_5xx_and_timeout(client):
    with respx.mock:
        # Upstream 500 error
        respx.get(CIVIC_VOTER_INFO_URL).respond(500, json={"error": "Server error"})

        res = await client.post("/api/voter-info", json={"address": "Detroit, MI"})
        assert res.status_code == 502
        assert res.headers["cache-control"] == "no-store"
        assert res.json()["uiState"] == "unavailable"
        assert res.json()["upstreamStatus"] == "upstream_5xx_500"

    with respx.mock:
        # Upstream timeout
        respx.get(CIVIC_VOTER_INFO_URL).mock(side_effect=httpx.ReadTimeout("Timeout"))

        res = await client.post("/api/voter-info", json={"address": "Detroit, MI"})
        assert res.status_code == 504
        assert res.headers["cache-control"] == "no-store"
        assert res.json()["uiState"] == "unavailable"
        assert res.json()["upstreamStatus"] == "upstream_timeout"

    with respx.mock:
        # Upstream network connect error
        respx.get(CIVIC_VOTER_INFO_URL).mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        res = await client.post("/api/voter-info", json={"address": "Detroit, MI"})
        assert res.status_code == 502
        assert res.headers["cache-control"] == "no-store"
        assert res.json()["uiState"] == "unavailable"
        assert res.json()["upstreamStatus"] == "upstream_network_error"


@pytest.mark.asyncio
async def test_voter_info_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CIVIC_API_KEY", raising=False)

    res = await client.post("/api/voter-info", json={"address": "Phoenix, AZ"})
    assert res.status_code == 503
    assert res.headers["cache-control"] == "no-store"
    data = res.json()
    assert data["uiState"] == "unavailable"
    assert data["upstreamStatus"] == "missing_api_key"


@pytest.mark.asyncio
async def test_voter_info_rate_limiter_local(client):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200, json={"status": "success", "pollingLocations": []}
        )

        # 30 allowed requests
        for _ in range(30):
            res = await client.post("/api/voter-info", json={"address": "Atlanta, GA"})
            assert res.status_code == 200

        # 31st request is blocked
        res = await client.post("/api/voter-info", json={"address": "Atlanta, GA"})
        assert res.status_code == 429
        assert res.headers["cache-control"] == "no-store"
        data = res.json()
        assert data["uiState"] == "unavailable"
        assert data["upstreamStatus"] == "client_rate_limited"


@pytest.mark.asyncio
async def test_voter_info_trusted_proxy_ip_resolution(client, monkeypatch):
    with respx.mock:
        respx.get(CIVIC_VOTER_INFO_URL).respond(
            200, json={"status": "success", "pollingLocations": []}
        )

        # Case 1: TRUSTED_PROXY=false -> X-Forwarded-For is ignored
        monkeypatch.setenv("TRUSTED_PROXY", "false")
        for _ in range(30):
            res = await client.post(
                "/api/voter-info",
                json={"address": "Dallas, TX"},
                headers={"X-Forwarded-For": "203.0.113.1"},
            )
            assert res.status_code == 200
        # 31st request with different forwarded IP is still rate limited because client.host was used
        res = await client.post(
            "/api/voter-info",
            json={"address": "Dallas, TX"},
            headers={"X-Forwarded-For": "203.0.113.2"},
        )
        assert res.status_code == 429

        # Reset rate limiter
        await rate_limiter.reset()

        # Case 2: TRUSTED_PROXY=true -> X-Forwarded-For IS honored
        monkeypatch.setenv("TRUSTED_PROXY", "true")
        for _ in range(30):
            res = await client.post(
                "/api/voter-info",
                json={"address": "Dallas, TX"},
                headers={"X-Forwarded-For": "198.51.100.1"},
            )
            assert res.status_code == 200

        # Same IP is blocked
        res = await client.post(
            "/api/voter-info",
            json={"address": "Dallas, TX"},
            headers={"X-Forwarded-For": "198.51.100.1"},
        )
        assert res.status_code == 429

        # Different IP passes through!
        res = await client.post(
            "/api/voter-info",
            json={"address": "Dallas, TX"},
            headers={"X-Forwarded-For": "198.51.100.2"},
        )
        assert res.status_code == 200


@pytest.mark.asyncio
async def test_voter_info_election_id_override(client, monkeypatch):
    monkeypatch.setenv("CIVIC_ELECTION_ID_OVERRIDE", "8888")

    with respx.mock:
        route = respx.get(CIVIC_VOTER_INFO_URL).respond(
            200, json={"status": "success", "pollingLocations": []}
        )

        res = await client.post("/api/voter-info", json={"address": "Las Vegas, NV"})
        assert res.status_code == 200
        assert route.called
        last_request = route.calls.last.request
        assert last_request.url.params["electionId"] == "8888"


@pytest.mark.asyncio
async def test_voter_info_request_validation(client):
    # Empty string
    res = await client.post("/api/voter-info", json={"address": ""})
    assert res.status_code == 422

    # Whitespace only
    res = await client.post("/api/voter-info", json={"address": "   "})
    assert res.status_code == 422

    # Too long (> 300 characters)
    res = await client.post("/api/voter-info", json={"address": "A" * 301})
    assert res.status_code == 422


def test_sanitize_url_validation():
    assert sanitize_url("https://vote.gov") == "https://vote.gov"
    assert sanitize_url("http://example.com/path?arg=1") == "http://example.com/path?arg=1"
    assert sanitize_url("javascript:alert(1)") is None
    assert sanitize_url("data:text/html,<script>alert(1)</script>") is None
    assert sanitize_url("ftp://files.gov") is None
    assert sanitize_url("") is None
    assert sanitize_url(None) is None


@pytest.mark.asyncio
async def test_voter_info_caching_max_age(client):
    # Test case 1: upstream provides Cache-Control: max-age=300 -> cached
    with respx.mock:
        route = respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={"status": "success", "pollingLocations": []},
            headers={"Cache-Control": "public, max-age=300"},
        )

        # First request -> calls upstream
        res1 = await client.post("/api/voter-info", json={"address": "Nashville, TN"})
        assert res1.status_code == 200
        assert route.call_count == 1

        # Second request with same address -> cache hit, upstream NOT called again
        res2 = await client.post("/api/voter-info", json={"address": "Nashville, TN"})
        assert res2.status_code == 200
        assert route.call_count == 1

    # Reset cache
    await response_cache.reset()

    # Test case 2: upstream provides NO Cache-Control -> not cached
    with respx.mock:
        route2 = respx.get(CIVIC_VOTER_INFO_URL).respond(
            200,
            json={"status": "success", "pollingLocations": []},
            # No cache-control header
        )

        res3 = await client.post("/api/voter-info", json={"address": "Nashville, TN"})
        assert res3.status_code == 200
        assert route2.call_count == 1

        res4 = await client.post("/api/voter-info", json={"address": "Nashville, TN"})
        assert res4.status_code == 200
        assert route2.call_count == 2


@pytest.mark.asyncio
async def test_voter_info_no_logging_leak(client, caplog):
    """
    CRITICAL SECURITY TEST: Ensure raw address and API key are never leaked in logs.
    Captures ALL loggers at DEBUG level.
    """
    secret_address = "742 Evergreen Terrace, Springfield, OR 97477"
    secret_key = "super-secret-api-key-xyz123"
    expected_hash = hashlib.sha256(secret_address.lower().encode("utf-8")).hexdigest()

    with respx.mock:
        # Mock upstream to return 500 so logging paths execute
        respx.get(CIVIC_VOTER_INFO_URL).respond(500, json={"error": "Downstream fail"})

        # Set ALL loggers to DEBUG
        caplog.set_level(logging.DEBUG)

        res = await client.post(
            "/api/voter-info",
            json={"address": secret_address},
        )
        assert res.status_code == 502

        # Assert secret address is NOT present anywhere in caplog
        assert secret_address not in caplog.text
        assert "742 Evergreen" not in caplog.text

        # Assert secret API key is NOT present anywhere in caplog
        assert secret_key not in caplog.text
        assert "super-secret" not in caplog.text

        # Assert address hash IS present in caplog
        assert expected_hash in caplog.text
