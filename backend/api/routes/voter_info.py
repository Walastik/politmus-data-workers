import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
import hashlib
import logging
import re
import time
from typing import Optional
import urllib.parse

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse
import httpx

from api.schemas import (
    AdminBodiesOut,
    AdminBodyOut,
    CivicAddressOut,
    ElectionOut,
    LocationOut,
    SourceOut,
    VoterInfoOut,
    VoterInfoRequest,
)
from config import (
    get_civic_election_id_override,
    get_google_civic_api_key,
    get_trusted_proxy,
)

# Suppress request URL logging from lower-level HTTP clients to prevent address leakage
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

router = APIRouter()

CIVIC_VOTER_INFO_URL = "https://www.googleapis.com/civicinfo/v2/voterinfo"
REQUEST_TIMEOUT_SECONDS = 8.0


def sanitize_url(url: Optional[str]) -> Optional[str]:
    """Validate server-side URLs, keeping only http and https schemes."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme.lower() in ("http", "https") and parsed.netloc:
            return url
    except Exception:
        pass
    return None


def get_client_ip(request: Request) -> str:
    """Extract client IP, honoring X-Forwarded-For only when TRUSTED_PROXY is enabled."""
    if get_trusted_proxy():
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
            if ip:
                return ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class SlidingWindowRateLimiter:
    """Thread- and async-safe in-memory rate limiter with LRU eviction."""

    def __init__(
        self,
        max_requests: int = 30,
        window_seconds: float = 60.0,
        max_entries: int = 10_000,
    ):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_entries = max_entries
        self.lock = asyncio.Lock()
        self.entries: OrderedDict[str, list[float]] = OrderedDict()

    async def is_allowed(self, client_ip: str) -> bool:
        now = time.monotonic()
        async with self.lock:
            if client_ip in self.entries:
                self.entries.move_to_end(client_ip)
                timestamps = [
                    t for t in self.entries[client_ip] if now - t < self.window_seconds
                ]
            else:
                timestamps = []

            if len(timestamps) >= self.max_requests:
                self.entries[client_ip] = timestamps
                return False

            timestamps.append(now)
            self.entries[client_ip] = timestamps

            while len(self.entries) > self.max_entries:
                self.entries.popitem(last=False)

            return True

    async def reset(self) -> None:
        async with self.lock:
            self.entries.clear()


class VoterInfoCache:
    """Thread- and async-safe in-memory LRU cache with TTL."""

    def __init__(self, max_entries: int = 1_000):
        self.max_entries = max_entries
        self.lock = asyncio.Lock()
        self.entries: OrderedDict[str, tuple[dict, float]] = OrderedDict()

    async def get(self, key: str) -> Optional[dict]:
        now = time.monotonic()
        async with self.lock:
            if key not in self.entries:
                return None
            payload, expire_at = self.entries[key]
            if now > expire_at:
                del self.entries[key]
                return None
            self.entries.move_to_end(key)
            return payload

    async def set(self, key: str, payload: dict, ttl_seconds: float) -> None:
        if ttl_seconds <= 0:
            return
        now = time.monotonic()
        expire_at = now + ttl_seconds
        async with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
            self.entries[key] = (payload, expire_at)
            while len(self.entries) > self.max_entries:
                self.entries.popitem(last=False)

    async def reset(self) -> None:
        async with self.lock:
            self.entries.clear()


rate_limiter = SlidingWindowRateLimiter()
response_cache = VoterInfoCache()


def parse_cache_control_ttl(header_val: Optional[str]) -> Optional[int]:
    """Parse Cache-Control: max-age from upstream, capping at 3600 seconds."""
    if not header_val:
        return None
    match = re.search(r"max-age=(\d+)", header_val, re.IGNORECASE)
    if not match:
        return None
    try:
        seconds = int(match.group(1))
        if seconds <= 0:
            return None
        return min(seconds, 3600)
    except ValueError:
        return None


def parse_location(item: dict) -> LocationOut:
    addr = item.get("address") or {}
    if not isinstance(addr, dict):
        addr = {}
    location_name = addr.get("locationName") or item.get("name") or item.get("locationName")
    sources = [
        SourceOut(name=s.get("name"), official=s.get("official"))
        for s in item.get("sources", [])
        if isinstance(s, dict)
    ]
    return LocationOut(
        location_name=location_name or None,
        line1=addr.get("line1") or None,
        city=addr.get("city") or None,
        state=addr.get("state") or None,
        zip=addr.get("zip") or None,
        polling_hours=item.get("pollingHours") or None,
        start_date=item.get("startDate") or None,
        end_date=item.get("endDate") or None,
        notes=item.get("notes") or None,
        sources=sources,
    )


def parse_admin_body(body_data: Optional[dict]) -> Optional[AdminBodyOut]:
    if not isinstance(body_data, dict) or not body_data:
        return None

    raw_addr = body_data.get("physicalAddress")
    phys_addr = None
    if isinstance(raw_addr, dict):
        phys_addr = CivicAddressOut(
            line1=raw_addr.get("line1") or raw_addr.get("locationName"),
            line2=raw_addr.get("line2"),
            line3=raw_addr.get("line3"),
            city=raw_addr.get("city"),
            state=raw_addr.get("state"),
            zip=raw_addr.get("zip"),
        )
    elif isinstance(raw_addr, str) and raw_addr.strip():
        phys_addr = CivicAddressOut(line1=raw_addr.strip())

    phone = None
    email = None
    officials = body_data.get("electionOfficials") or []
    if isinstance(officials, list):
        for off in officials:
            if isinstance(off, dict):
                if not phone and off.get("officePhoneNumber"):
                    phone = off.get("officePhoneNumber")
                if not email and (off.get("emailAddress") or off.get("email")):
                    email = off.get("emailAddress") or off.get("email")
                if phone and email:
                    break

    return AdminBodyOut(
        name=body_data.get("name"),
        election_info_url=sanitize_url(body_data.get("electionInfoUrl")),
        election_registration_url=sanitize_url(body_data.get("electionRegistrationUrl")),
        election_registration_confirmation_url=sanitize_url(
            body_data.get("electionRegistrationConfirmationUrl")
        ),
        absentee_voting_info_url=sanitize_url(body_data.get("absenteeVotingInfoUrl")),
        voting_location_finder_url=sanitize_url(body_data.get("votingLocationFinderUrl")),
        ballot_info_url=sanitize_url(body_data.get("ballotInfoUrl")),
        hours_of_operation=body_data.get("hoursOfOperation"),
        physical_address=phys_addr,
        phone=phone,
        email=email,
    )


def error_response(
    status_code: int,
    upstream_status: str,
    detail: str,
) -> JSONResponse:
    content = {
        "uiState": "unavailable",
        "upstreamStatus": upstream_status,
        "detail": detail,
    }
    return JSONResponse(
        status_code=status_code,
        content=content,
        headers={"Cache-Control": "no-store"},
    )


@router.post("", response_model=VoterInfoOut)
async def get_voter_info(request: Request, body: VoterInfoRequest):
    address = body.address.strip()
    normalized_address = address.lower()
    address_hash = hashlib.sha256(normalized_address.encode("utf-8")).hexdigest()

    client_ip = get_client_ip(request)
    allowed = await rate_limiter.is_allowed(client_ip)
    if not allowed:
        logger.warning(
            "Rate limit exceeded for client_ip=%s address_hash=%s",
            client_ip,
            address_hash,
        )
        return error_response(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            upstream_status="client_rate_limited",
            detail="Rate limit exceeded. Please try again later.",
        )

    api_key = get_google_civic_api_key()
    if not api_key:
        logger.warning(
            "Google Civic API key not configured for address_hash=%s", address_hash
        )
        return error_response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            upstream_status="missing_api_key",
            detail="Voting information service is not configured.",
        )

    election_id = body.election_id or get_civic_election_id_override()
    cache_key = hashlib.sha256(
        f"{normalized_address}:{election_id or ''}".encode("utf-8")
    ).hexdigest()

    cached_data = await response_cache.get(cache_key)
    if cached_data is not None:
        logger.info(
            "Civic voterinfo cache hit: address_hash=%s",
            address_hash,
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=cached_data,
            headers={"Cache-Control": "no-store"},
        )

    params: dict[str, str] = {"address": address}
    if election_id:
        params["electionId"] = election_id

    # Use application-level shared client if available
    client = getattr(request.app.state, "http_client", None)
    own_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
        own_client = True

    start_time = time.monotonic()
    upstream_response = None
    try:
        upstream_response = await client.get(
            CIVIC_VOTER_INFO_URL,
            params=params,
            headers={"X-Goog-Api-Key": api_key},
        )
    except httpx.TimeoutException:
        latency = time.monotonic() - start_time
        logger.warning(
            "Civic voterinfo request timeout: latency=%.3fs address_hash=%s",
            latency,
            address_hash,
        )
        return error_response(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            upstream_status="upstream_timeout",
            detail="Upstream voting information service timed out.",
        )
    except httpx.HTTPError as exc:
        latency = time.monotonic() - start_time
        logger.warning(
            "Civic voterinfo request error (%s): latency=%.3fs address_hash=%s",
            type(exc).__name__,
            latency,
            address_hash,
        )
        return error_response(
            status_code=status.HTTP_502_BAD_GATEWAY,
            upstream_status="upstream_network_error",
            detail="Unable to reach the upstream voting information service.",
        )
    finally:
        if own_client:
            await client.aclose()

    latency = time.monotonic() - start_time
    status_code = upstream_response.status_code

    if status_code == 403:
        logger.warning(
            "Upstream Civic API returned 403 forbidden: latency=%.3fs address_hash=%s",
            latency,
            address_hash,
        )
        return error_response(
            status_code=status.HTTP_502_BAD_GATEWAY,
            upstream_status="upstream_forbidden",
            detail="Upstream voting information service authentication failed.",
        )

    if status_code == 429:
        logger.warning(
            "Upstream Civic API quota exceeded (429): latency=%.3fs address_hash=%s",
            latency,
            address_hash,
        )
        return error_response(
            status_code=status.HTTP_502_BAD_GATEWAY,
            upstream_status="upstream_rate_limited",
            detail="Upstream voting information service quota exceeded.",
        )

    try:
        payload = upstream_response.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    # Handle upstream 4xx errors
    if 400 <= status_code < 500:
        err_obj = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        err_msg = str(err_obj.get("message") or payload.get("message") or "").lower()
        err_reason = ""
        errors_list = err_obj.get("errors") or []
        if isinstance(errors_list, list) and len(errors_list) > 0 and isinstance(errors_list[0], dict):
            err_reason = str(errors_list[0].get("reason") or "").lower()

        logger.info(
            "Civic voterinfo upstream 4xx status=%d reason=%s latency=%.3fs address_hash=%s",
            status_code,
            err_reason or "unknown",
            latency,
            address_hash,
        )

        if "election" in err_msg or "election" in err_reason or err_reason == "electionunknown":
            response_model = VoterInfoOut(
                ui_state="no_election",
                upstream_status=err_reason or "electionUnknown",
                fetched_at=datetime.now(timezone.utc).isoformat(),
            )
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=response_model.model_dump(by_alias=True),
                headers={"Cache-Control": "no-store"},
            )

        if (
            "address" in err_msg
            or "address" in err_reason
            or err_reason in ("addressunparseable", "noaddressparameter")
        ):
            response_model = VoterInfoOut(
                ui_state="address_problem",
                upstream_status=err_reason or "addressUnparseable",
                fetched_at=datetime.now(timezone.utc).isoformat(),
            )
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=response_model.model_dump(by_alias=True),
                headers={"Cache-Control": "no-store"},
            )

        return error_response(
            status_code=status.HTTP_502_BAD_GATEWAY,
            upstream_status=f"upstream_4xx_{status_code}",
            detail="Upstream voting information service returned an error.",
        )

    if status_code >= 500:
        logger.warning(
            "Civic voterinfo upstream 5xx status=%d latency=%.3fs address_hash=%s",
            status_code,
            latency,
            address_hash,
        )
        return error_response(
            status_code=status.HTTP_502_BAD_GATEWAY,
            upstream_status=f"upstream_5xx_{status_code}",
            detail="Upstream voting information service is unavailable.",
        )

    raw_upstream_status = payload.get("status")
    upstream_status_str = str(raw_upstream_status or "success")

    logger.info(
        "Civic voterinfo success: upstream_status=%s latency=%.3fs address_hash=%s",
        upstream_status_str,
        latency,
        address_hash,
    )

    # Parse components
    election_data = payload.get("election")
    election_out = None
    if isinstance(election_data, dict):
        e_date = election_data.get("date") or election_data.get("electionDay")
        election_out = ElectionOut(
            id=str(election_data.get("id", "")),
            name=str(election_data.get("name", "")),
            date=e_date or None,
        )

    other_elections = [
        ElectionOut(
            id=str(e.get("id", "")),
            name=str(e.get("name", "")),
            date=e.get("date") or e.get("electionDay") or None,
        )
        for e in payload.get("otherElections", [])
        if isinstance(e, dict)
    ]

    mail_only = bool(payload.get("mailOnly", False))

    raw_poll = payload.get("pollingLocations") or []
    raw_early = payload.get("earlyVoteSites") or []
    raw_drop = payload.get("dropOffLocations") or []

    polling_locations = [parse_location(item) for item in raw_poll if isinstance(item, dict)]
    early_vote_sites = [parse_location(item) for item in raw_early if isinstance(item, dict)]
    drop_off_locations = [parse_location(item) for item in raw_drop if isinstance(item, dict)]

    states = payload.get("state") or []
    state_body = None
    local_body = None
    if isinstance(states, list) and len(states) > 0 and isinstance(states[0], dict):
        state_body = parse_admin_body(states[0].get("electionAdministrationBody"))
        local_jur = states[0].get("local_jurisdiction")
        if isinstance(local_jur, dict):
            local_body = parse_admin_body(local_jur.get("electionAdministrationBody"))

    admin_bodies = AdminBodiesOut(state=state_body, local=local_body)

    # Determine uiState
    ui_state: str
    status_lower = upstream_status_str.lower()

    if status_lower == "nostreetsegmentfound":
        ui_state = "no_data_yet"
    elif status_lower == "multiplestreetsegmentsfound":
        ui_state = "nearby_only"
        # nearby_only omits location arrays as per specification
        polling_locations = []
        early_vote_sites = []
        drop_off_locations = []
    elif status_lower == "electionover":
        ui_state = "election_over"
    elif status_lower in ("electionunknown", "noelection"):
        ui_state = "no_election"
    elif status_lower in ("addressunparseable", "noaddressparameter"):
        ui_state = "address_problem"
    elif mail_only:
        ui_state = "mail_only"
    elif len(polling_locations) > 0 or len(early_vote_sites) > 0 or len(drop_off_locations) > 0:
        ui_state = "live"
    elif election_out is not None:
        ui_state = "no_locations_yet"
    else:
        ui_state = "no_election"

    response_model = VoterInfoOut(
        ui_state=ui_state,
        upstream_status=upstream_status_str,
        election=election_out,
        mail_only=mail_only,
        polling_locations=polling_locations,
        early_vote_sites=early_vote_sites,
        drop_off_locations=drop_off_locations,
        admin_bodies=admin_bodies,
        other_elections=other_elections,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )

    response_dict = response_model.model_dump(by_alias=True)

    # Check upstream Cache-Control
    cache_control = upstream_response.headers.get("cache-control")
    ttl = parse_cache_control_ttl(cache_control)
    if ttl is not None and ttl > 0:
        await response_cache.set(cache_key, response_dict, ttl)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content=response_dict,
        headers={"Cache-Control": "no-store"},
    )
