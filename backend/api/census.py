import re
import time
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from typing import Any, Optional

import httpx

from api.filters import STATE_ABBR_BY_NAME, STATE_NAME_BY_ABBR

# The geocoder only turns an address into a point. Districts come from TIGERweb's
# Legislative map service, so we can pick the maps the sitting Congress was
# elected on (the geocoder's "Current" vintage moves to the next Congress's maps
# months before it is seated).
CENSUS_LOCATIONS_URL = (
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
)
TIGERWEB_LEGISLATIVE_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer"
)
REQUEST_TIMEOUT_SECONDS = 20.0
USER_AGENT = "politmus-api civic-lookup"
# Layer ids shift when Census publishes a new vintage, so the layer list is
# re-read once a day rather than hard-coded.
LAYER_CACHE_SECONDS = 24 * 60 * 60

_CONGRESS_LAYER = re.compile(r"^(\d+)(?:st|nd|rd|th) Congressional Districts$")
_SLD_LAYER = re.compile(r"^(\d{4}) State Legislative Districts - (Upper|Lower)$")

STATE_ABBR_BY_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
    "72": "PR", "78": "VI",
}


@dataclass(frozen=True)
class CensusMatch:
    line1: Optional[str]
    city: Optional[str]
    state_abbr: str
    state_name: str
    zip: Optional[str]
    district: int
    district_label: str
    sldu: Optional[int] = None
    sldu_label: Optional[str] = None
    sldl: Optional[int] = None
    sldl_label: Optional[str] = None
    # The geocoded point, used to sort voting sites by distance.
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class CensusUnavailable(Exception):
    """A Census service could not be reached or returned an invalid payload.

    The message names the service and the failure, for logs.
    """


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


def _parse_sld_code(raw: Any) -> Optional[int]:
    text = _text_or_none(raw)
    if not text:
        return None
    if text.upper() in {"ZZZ", "N/A", "NA"}:
        return None
    try:
        value = int(text)
    except ValueError:
        return None
    if value < 0:
        return None
    return value


def _legislative_district(
    geographies: dict[str, Any],
    chamber: str,
) -> tuple[Optional[int], Optional[str]]:
    chamber = chamber.lower()
    districts = None
    for key, value in geographies.items():
        key_l = str(key).lower()
        if "state legislative district" not in key_l:
            continue
        if chamber not in key_l:
            continue
        districts = value
        break
    if not isinstance(districts, list) or not districts:
        return None, None
    item = districts[0]
    if not isinstance(item, dict):
        return None, None

    raw = None
    for key in ("SLDU", "SLDL", "SLDUST", "SLDLST"):
        if key in item:
            raw = item.get(key)
            break
    if raw in (None, ""):
        raw = item.get("BASENAME")
    if raw in (None, ""):
        geoid = _text_or_none(item.get("GEOID"))
        if geoid and len(geoid) >= 3:
            raw = geoid[-3:]

    return _parse_sld_code(raw), _text_or_none(item.get("NAME")) or _text_or_none(
        item.get("BASENAME")
    )


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


def _first_address_match(payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    matches = result.get("addressMatches")
    if not isinstance(matches, list) or not matches:
        return None
    first = matches[0]
    return first if isinstance(first, dict) else None


def _address_point(payload: dict[str, Any]) -> Optional[tuple[float, float]]:
    """The (lat, lon) of the first address match, if any."""
    first = _first_address_match(payload)
    coordinates = first.get("coordinates") if first else None
    if not isinstance(coordinates, dict):
        return None
    lon, lat = _float_or_none(coordinates.get("x")), _float_or_none(coordinates.get("y"))
    if lat is None or lon is None:
        return None
    return lat, lon


def _match_from_payload(
    payload: dict[str, Any],
    geographies: Optional[dict[str, Any]] = None,
) -> Optional[CensusMatch]:
    """Build a match from an address payload, with districts from `geographies`
    when given and otherwise from the match's own geographies."""
    first = _first_address_match(payload)
    if first is None:
        return None

    components = first.get("addressComponents")
    if not isinstance(components, dict):
        components = {}
    if geographies is None:
        geographies = first.get("geographies")
    if not isinstance(geographies, dict):
        geographies = {}
    match = _match_from_geographies(
        geographies,
        components,
        matched_address=_text_or_none(first.get("matchedAddress")),
    )
    point = _address_point(payload)
    if match and point:
        match = replace(match, latitude=point[0], longitude=point[1])
    return match


def _float_or_none(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _match_from_geographies(
    geographies: dict[str, Any],
    components: dict[str, Any],
    *,
    matched_address: Optional[str] = None,
) -> Optional[CensusMatch]:
    state_abbr, state_name = _state_from_match(components, geographies)
    if not state_abbr or not state_name:
        return None
    district, district_label = _congressional_district(geographies)
    if district is None:
        return None

    line1 = _street_line(components) or matched_address
    if not district_label:
        if district == 0:
            district_label = f"{state_name} At-Large Congressional District"
        else:
            district_label = f"{state_name} Congressional District {district}"

    sldu, sldu_label = _legislative_district(geographies, "upper")
    sldl, sldl_label = _legislative_district(geographies, "lower")
    if sldu is not None and not sldu_label:
        sldu_label = f"{state_name} State Senate District {sldu}"
    if sldl is not None and not sldl_label:
        sldl_label = f"{state_name} State House District {sldl}"

    return CensusMatch(
        line1=line1,
        city=_text_or_none(components.get("city")),
        state_abbr=state_abbr,
        state_name=state_name,
        zip=_text_or_none(components.get("zip")),
        district=district,
        district_label=district_label,
        sldu=sldu,
        sldu_label=sldu_label,
        sldl=sldl,
        sldl_label=sldl_label,
    )


def _get_json(url: str, params: dict[str, Any], service: str) -> dict[str, Any]:
    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise CensusUnavailable(
            f"{service} request failed: {type(exc).__name__}: {exc}"
        ) from exc

    if response.status_code >= 400:
        raise CensusUnavailable(f"{service} returned HTTP {response.status_code}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise CensusUnavailable(f"{service} returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise CensusUnavailable(f"{service} returned an unexpected payload")
    # ArcGIS reports errors in a 200 response.
    error = payload.get("error")
    if error:
        message = error.get("message") if isinstance(error, dict) else error
        raise CensusUnavailable(f"{service} returned an error: {message}")
    return payload


def sitting_congress(today: date) -> int:
    """The Congress in session on `today`. Each is seated on January 3 of an odd year."""
    congress = (today.year - 1789) // 2 + 1
    if today.year % 2 == 1 and (today.month, today.day) < (1, 3):
        congress -= 1
    return congress


_layer_cache: Optional[tuple[float, list[tuple[int, str]]]] = None


def _legislative_layers() -> list[tuple[int, str]]:
    """(id, name) for each layer of the TIGERweb Legislative service, cached for a day."""
    global _layer_cache
    now = time.monotonic()
    if _layer_cache and now - _layer_cache[0] < LAYER_CACHE_SECONDS:
        return _layer_cache[1]

    payload = _get_json(TIGERWEB_LEGISLATIVE_URL, {"f": "json"}, "TIGERweb")
    layers = [
        (layer["id"], str(layer["name"]))
        for layer in payload.get("layers") or []
        if isinstance(layer, dict) and isinstance(layer.get("id"), int) and layer.get("name")
    ]
    if not layers:
        raise CensusUnavailable("TIGERweb listed no Legislative layers")
    _layer_cache = (now, layers)
    return layers


def _district_layer_ids(layers: list[tuple[int, str]], congress: int) -> list[int]:
    """Layer ids for the congressional and state legislative maps in force for `congress`.

    Uses that Congress's districts, or the latest earlier ones if Census has not
    published them. State legislative maps are the ones from the election that
    seated that Congress (the November before it).
    """
    congress_layers: dict[int, int] = {}
    sld_layers: dict[tuple[int, str], int] = {}
    # Census repeats some layers under several vintages; the first listed is the newest.
    for layer_id, name in layers:
        if m := _CONGRESS_LAYER.match(name):
            congress_layers.setdefault(int(m.group(1)), layer_id)
        elif m := _SLD_LAYER.match(name):
            sld_layers.setdefault((int(m.group(1)), m.group(2)), layer_id)

    available = [number for number in congress_layers if number <= congress]
    if not available:
        raise CensusUnavailable(
            f"TIGERweb has no congressional district layer for Congress {congress} or earlier"
        )
    chosen = max(available)
    ids = [congress_layers[chosen]]

    election_year = 2 * chosen + 1786
    for chamber in ("Upper", "Lower"):
        years = [year for year, c in sld_layers if c == chamber and year <= election_year]
        if years:
            ids.append(sld_layers[(max(years), chamber)])
    return ids


def _district_geographies(lat: float, lon: float) -> dict[str, Any]:
    """TIGERweb districts containing the point, keyed by layer name like the
    geocoder's geographies, plus a States entry from the district's FIPS code."""
    global _layer_cache
    congress = sitting_congress(datetime.now(timezone.utc).date())
    layer_ids = _district_layer_ids(_legislative_layers(), congress)
    try:
        payload = _get_json(
            f"{TIGERWEB_LEGISLATIVE_URL}/identify",
            {
                "geometry": f"{lon},{lat}",
                "geometryType": "esriGeometryPoint",
                "sr": 4326,
                "layers": "all:" + ",".join(str(layer_id) for layer_id in layer_ids),
                "tolerance": 0,
                # identify requires a map extent and image size; with zero
                # tolerance they don't affect which polygons match.
                "mapExtent": f"{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}",
                "imageDisplay": "100,100,96",
                "returnGeometry": "false",
                "f": "json",
            },
            "TIGERweb",
        )
    except CensusUnavailable:
        # The layer ids may have moved; re-read them on the next lookup.
        _layer_cache = None
        raise

    results = payload.get("results")
    if not isinstance(results, list):
        raise CensusUnavailable("TIGERweb returned an unexpected identify payload")
    geographies: dict[str, Any] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        name, attributes = item.get("layerName"), item.get("attributes")
        if name and isinstance(attributes, dict):
            geographies.setdefault(str(name), []).append(attributes)

    for features in list(geographies.values()):
        abbr = STATE_ABBR_BY_FIPS.get(_text_or_none(features[0].get("STATE")) or "")
        if abbr:
            geographies["States"] = [{"STUSAB": abbr}]
            break
    return geographies


def geocode_address(address: str) -> Optional[CensusMatch]:
    """Resolve a US address to state + districts: Census geocodes it, TIGERweb finds the districts."""
    payload = _get_json(
        CENSUS_LOCATIONS_URL,
        {"address": address, "benchmark": "Public_AR_Current", "format": "json"},
        "Census geocoder",
    )
    point = _address_point(payload)
    if point is None:
        return None
    return _match_from_payload(payload, _district_geographies(*point))


def geocode_coordinates(lat: float, lon: float) -> Optional[CensusMatch]:
    """Resolve a point to state + districts via TIGERweb.

    Returns None for points outside any U.S. state or congressional district.
    """
    # A point lookup has no address components; the street fields stay empty.
    match = _match_from_geographies(_district_geographies(lat, lon), {})
    return replace(match, latitude=lat, longitude=lon) if match else None
