from dataclasses import dataclass
from typing import Any, Optional

import httpx

from api.filters import STATE_ABBR_BY_NAME, STATE_NAME_BY_ABBR

CENSUS_GEOCODER_URL = (
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
)
REQUEST_TIMEOUT_SECONDS = 20.0
USER_AGENT = "politmus-api civic-lookup"


@dataclass(frozen=True)
class CensusMatch:
    line1: Optional[str]
    city: Optional[str]
    state_abbr: str
    state_name: str
    zip: Optional[str]
    district: int
    district_label: str


class CensusUnavailable(Exception):
    """The Census geocoder could not be reached or returned an invalid payload."""


def _text_or_none(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text or None


def _street_line(components: dict[str, Any]) -> Optional[str]:
    parts = [
        _text_or_none(components.get("fromAddress")),
        _text_or_none(components.get("preDirection")),
        _text_or_none(components.get("preType")),
        _text_or_none(components.get("streetName")),
        _text_or_none(components.get("suffixType")),
        _text_or_none(components.get("suffixDirection")),
    ]
    line = " ".join(part for part in parts if part)
    return line or None


def _parse_district_code(raw: Any) -> Optional[int]:
    text = _text_or_none(raw)
    if not text:
        return None
    try:
        value = int(text)
    except ValueError:
        return None
    if value < 0:
        return None
    # Census uses 00 for at-large seats and 98 for territorial delegates.
    if value in {0, 98}:
        return 0
    return value


def _congressional_district(
    geographies: dict[str, Any],
) -> tuple[Optional[int], Optional[str]]:
    districts = None
    for key, value in geographies.items():
        if "congressional district" in str(key).lower():
            districts = value
            break
    if not isinstance(districts, list) or not districts:
        return None, None
    item = districts[0]
    if not isinstance(item, dict):
        return None, None

    raw = None
    for key, value in item.items():
        if str(key).startswith("CD") and key != "CDSESSN":
            raw = value
            break
    if raw is None:
        geoid = _text_or_none(item.get("GEOID"))
        if geoid and len(geoid) >= 2:
            raw = geoid[-2:]

    return _parse_district_code(raw), _text_or_none(item.get("NAME")) or _text_or_none(
        item.get("BASENAME")
    )


def _state_from_match(
    components: dict[str, Any], geographies: dict[str, Any]
) -> tuple[Optional[str], Optional[str]]:
    abbr = _text_or_none(components.get("state"))
    if abbr:
        abbr = abbr.upper()
        name = STATE_NAME_BY_ABBR.get(abbr)
        if name:
            return abbr, name

    states = geographies.get("States")
    if isinstance(states, list) and states and isinstance(states[0], dict):
        item = states[0]
        abbr = _text_or_none(item.get("STUSAB"))
        name = _text_or_none(item.get("NAME")) or _text_or_none(item.get("BASENAME"))
        if abbr:
            abbr = abbr.upper()
            name = name or STATE_NAME_BY_ABBR.get(abbr)
            if name:
                return abbr, name
        if name:
            mapped = STATE_ABBR_BY_NAME.get(name.lower())
            if mapped:
                return mapped, name
    return None, None


def _match_from_payload(payload: dict[str, Any]) -> Optional[CensusMatch]:
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    matches = result.get("addressMatches")
    if not isinstance(matches, list) or not matches:
        return None
    first = matches[0]
    if not isinstance(first, dict):
        return None

    components = first.get("addressComponents")
    if not isinstance(components, dict):
        components = {}
    geographies = first.get("geographies")
    if not isinstance(geographies, dict):
        geographies = {}

    state_abbr, state_name = _state_from_match(components, geographies)
    if not state_abbr or not state_name:
        return None
    district, district_label = _congressional_district(geographies)
    if district is None:
        return None

    line1 = _street_line(components) or _text_or_none(first.get("matchedAddress"))
    if not district_label:
        if district == 0:
            district_label = f"{state_name} At-Large Congressional District"
        else:
            district_label = f"{state_name} Congressional District {district}"

    return CensusMatch(
        line1=line1,
        city=_text_or_none(components.get("city")),
        state_abbr=state_abbr,
        state_name=state_name,
        zip=_text_or_none(components.get("zip")),
        district=district,
        district_label=district_label,
    )


def geocode_address(address: str) -> Optional[CensusMatch]:
    """Resolve a US address to state + congressional district via Census."""
    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            response = client.get(
                CENSUS_GEOCODER_URL,
                params={
                    "address": address,
                    "benchmark": "Public_AR_Current",
                    "vintage": "Current_Current",
                    "format": "json",
                },
            )
    except httpx.HTTPError as exc:
        raise CensusUnavailable("Unable to reach the Census geocoder") from exc

    if response.status_code >= 500:
        raise CensusUnavailable("Census geocoder is unavailable")
    if response.status_code >= 400:
        raise CensusUnavailable("Census geocoder rejected the address lookup")

    try:
        payload = response.json()
    except ValueError as exc:
        raise CensusUnavailable("Invalid response from the Census geocoder") from exc
    if not isinstance(payload, dict):
        raise CensusUnavailable("Invalid response from the Census geocoder")
    return _match_from_payload(payload)
