"""Unofficial election night results from state election offices.

Each state's election office publishes its own counts; there is no national
official feed. This reads the states whose results sites have machine-readable
data, normalizes federal races (U.S. Senate and House) into one shape and
writes a snapshot JSON:

    python election_results.py --out ../apps/app/public/dev-results.json

Sources (all official state election offices):
- Enhanced Voting results sites: Georgia, Virginia, Rhode Island
- NC State Board of Elections results files
- Ohio Secretary of State live results API
- Clarity ENR statewide sites: Colorado, Iowa
- TotalVote results sites: Montana, Nebraska, New Mexico, South Dakota, Oregon
- South Carolina Election Commission results spreadsheets
- Delaware Department of Elections results files

The Election Results GitHub Action runs this every few minutes and publishes
the snapshot to the election-results-data branch (see docs/deploy.md).

Counts are unofficial until each state certifies them. Candidates are matched
to Politmus races (FEC data) for photos, money raised and incumbency.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import unicodedata
import zipfile
from dataclasses import dataclass, field
from html import unescape
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import requests

USER_AGENT = "Politmus election results (https://politmus.com)"
POLITMUS_API = "https://politmus.com/api"
ELECTION_DATE = "2026-11-03"
# Pause between requests to the same results site.
POLITE_DELAY = 0.15

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def get_json(url: str, **params):
    response = session.get(url, params=params or None, timeout=60)
    response.raise_for_status()
    return response.json()


# ---- Normalized shape -------------------------------------------------------


@dataclass
class Candidate:
    name: str
    party: str
    votes: int
    incumbent: bool = False
    write_in: bool = False
    profile: dict | None = None


@dataclass
class Race:
    office: str  # 'S' or 'H'
    district: int  # 0 for Senate and at-large seats
    label: str
    candidates: list[Candidate]
    reporting: dict  # {"done": n, "total": n, "unit": "counties" | "precincts"}
    special: bool = False
    # County name -> votes per candidate, in `candidates` order.
    counties: dict[str, list[int]] = field(default_factory=dict)

    @property
    def total_votes(self) -> int:
        return sum(c.votes for c in self.candidates)


@dataclass
class StateResults:
    state: str
    name: str
    source_name: str
    source_url: str
    last_updated: str | None
    races: list[Race]
    # County name -> {"registered": n, "ballots": n}
    counties: dict[str, dict] = field(default_factory=dict)
    registered: int | None = None
    ballots: int | None = None


PARTY_CODES = {
    "dem": "DEM", "democratic": "DEM", "democrat": "DEM", "d": "DEM",
    "rep": "REP", "republican": "REP", "r": "REP",
    "lib": "LIB", "lbr": "LIB", "libertarian": "LIB", "l": "LIB",
    "grn": "GRN", "green": "GRN", "g": "GRN",
    "ind": "IND", "independent": "IND", "i": "IND", "una": "IND", "unaffiliated": "IND",
    "nonpartisan": "IND", "non-partisan": "IND", "np": "IND", "npa": "IND",
    "by petition": "IND", "petition": "IND",
}


def party_code(raw: str | None) -> str:
    # Fusion nominations list every party ('Democrat, Working Families'); the first is the candidate's own.
    key = (raw or "").split(",")[0].strip().lower().rstrip(".")
    return PARTY_CODES.get(key, "OTH" if key else "")


WRITE_IN = re.compile(r"write[\s-]*in", re.I)


def clean_name(raw: str) -> tuple[str, bool]:
    """'Jon Ossoff (I) (Dem)' -> ('Jon Ossoff', True). (I) marks the incumbent."""
    incumbent = bool(re.search(r"\(I\)", raw))
    name = re.sub(r"\s*\([^)]*\)", "", raw).strip()
    return name, incumbent


# Spellings that differ from the map's county names.
COUNTY_ALIASES = {"Lewis & Clark": "Lewis and Clark", "Dona Ana": "Doña Ana"}


def display_name(raw: str) -> str:
    """'BEN R LUJAN' -> 'Ben R Lujan'; names already in mixed case are kept."""
    if not raw.isupper():
        return raw
    name = re.sub(r"(^|[\s\"'(-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), " ".join(raw.lower().split()))
    return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), name)


def county_key(raw: str) -> str:
    """County names as the map knows them: 'APPLING COUNTY' -> 'Appling'.

    Virginia's independent cities keep a ' city' suffix, since several share a
    name with a county (Fairfax, Richmond, Roanoke...).
    """
    name = raw.strip()
    is_city = bool(re.search(r"\bcity$", name, re.I)) and not re.search(r"county", name, re.I)
    name = re.sub(r"\s+(county|parish|borough|census area|city)$", "", name, flags=re.I)
    name = " ".join(part.capitalize() if part.isupper() or part.islower() else part for part in name.split())
    name = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), name)
    name = COUNTY_ALIASES.get(name, name)
    return f"{name} city" if is_city else name


# ---- Enhanced Voting (Georgia, Virginia) -------------------------------------

ENHANCED_VOTING = {
    "GA": ("https://results.sos.ga.gov", "Georgia", "11032026GeneralAndSpecialElection", "Georgia Secretary of State"),
    "VA": ("https://enr.elections.virginia.gov", "Virginia", "2026-November-General", "Virginia Department of Elections"),
    # Rhode Island reports by city and town; town_county() folds them into counties.
    "RI": ("https://electionresults.ri.gov", "RhodeIsland", "2026StatewideGeneralElection", "Rhode Island Department of State"),
}

EV_SENATE = re.compile(r"^((Member, )?(US|United States) Senate|Senator in Congress)", re.I)
EV_HOUSE = re.compile(r"^(US House of Representatives|Member, House of Representatives|Representative in Congress)\D*(\d+)", re.I)

STATE_NAMES = {"RI": "Rhode Island"}

# Rhode Island reports by city and town.
RI_TOWN_COUNTY = {
    **dict.fromkeys(["Barrington", "Bristol", "Warren"], "Bristol"),
    **dict.fromkeys(["Coventry", "East Greenwich", "Warwick", "West Greenwich", "West Warwick"], "Kent"),
    **dict.fromkeys(["Jamestown", "Little Compton", "Middletown", "Newport", "Portsmouth", "Tiverton"], "Newport"),
    **dict.fromkeys(
        [
            "Burrillville", "Central Falls", "Cranston", "Cumberland", "East Providence", "Foster", "Glocester",
            "Johnston", "Lincoln", "North Providence", "North Smithfield", "Pawtucket", "Providence", "Scituate",
            "Smithfield", "Woonsocket",
        ],
        "Providence",
    ),
    **dict.fromkeys(
        [
            "Charlestown", "Exeter", "Hopkinton", "Narragansett", "New Shoreham", "North Kingstown", "Richmond",
            "South Kingstown", "Westerly",
        ],
        "Washington",
    ),
}
LOCALITY_COUNTY = {"RI": RI_TOWN_COUNTY}


def fold_localities(rows: dict[str, list[int]], county_of: dict[str, str]) -> dict[str, list[int]]:
    """Sum town rows into their counties; rows without a county are dropped."""
    folded: dict[str, list[int]] = {}
    for town, votes in rows.items():
        county = county_of.get(town)
        if county:
            folded[county] = [a + b for a, b in zip(folded.get(county, [0] * len(votes)), votes)]
    return folded


def ev_text(value) -> str:
    if isinstance(value, list):
        return next((v["text"] for v in value if v.get("languageId") in ("en", None)), value[0]["text"] if value else "")
    return value or ""


def ev_candidates(options) -> list[Candidate]:
    candidates = []
    for option in options:
        name, incumbent = clean_name(ev_text(option["name"]))
        party = option.get("party") or {}
        candidates.append(
            Candidate(
                name=name,
                party=party_code(party.get("abbreviation") or ev_text(party.get("name"))),
                votes=int(option.get("voteCount") or 0),
                incumbent=incumbent,
                write_in=bool(WRITE_IN.search(name)),
            )
        )
    return candidates


def fetch_enhanced_voting(state: str) -> StateResults:
    host, jurisdiction, election, source_name = ENHANCED_VOTING[state]
    api = f"{host}/results/public/api/elections/{jurisdiction}/{election}"
    data = get_json(f"{api}/data")
    # Each county runs its own election under the state's; its
    # jurisdictionId is the county's id in the voter registration list.
    registration = data.get("voterRegistration") or []
    county_names = {row["id"]: county_key(ev_text(row["localityName"])) for row in registration}
    registered = {row["id"]: int(row.get("total") or 0) for row in registration}
    counties = {}
    for local in get_json(f"{api}/localities"):
        county = county_names.get(local.get("jurisdictionId"))
        if county:
            counties[county] = {
                # A few counties leave totalVoters at 0; the registration list has them.
                "registered": int(local.get("totalVoters") or 0) or registered.get(local["jurisdictionId"], 0),
                "ballots": int(local.get("ballotsCast") or 0),
            }

    races = []
    for item in data["ballotItems"]:
        label = ev_text(item["name"])
        senate = EV_SENATE.search(label)
        house = EV_HOUSE.search(label)
        if not senate and not house:
            continue
        time.sleep(POLITE_DELAY)
        detail = get_json(f"{api}/data/ballot-item/{item['id']}")["ballotItemWithBreakdown"]
        candidates = ev_candidates(detail["summaryResults"]["ballotOptions"])
        order = [o["id"] for o in detail["summaryResults"]["ballotOptions"]]
        by_county = {}
        for row in detail.get("breakdownResults") or []:
            votes = {o["id"]: int(o.get("voteCount") or 0) for o in row["ballotOptions"]}
            by_county[county_key(ev_text(row["locality"]["name"]))] = [votes.get(i, 0) for i in order]
        status = item.get("reportingStatus") or {}
        races.append(
            Race(
                office="S" if senate else "H",
                district=0 if senate else int(house.group(2)),
                label="U.S. Senate" if senate else f"U.S. House District {int(house.group(2))}",
                special="special" in label.lower() or "unexpired" in label.lower(),
                candidates=candidates,
                reporting={"done": status.get("reportingUnits"), "total": status.get("totalUnits"), "unit": "counties"},
                counties=by_county,
            )
        )

    county_of = LOCALITY_COUNTY.get(state)
    if county_of:
        for race in races:
            race.counties = fold_localities(race.counties, county_of)
        turnout = fold_localities({k: [v["registered"], v["ballots"]] for k, v in counties.items()}, county_of)
        counties = {k: {"registered": v[0], "ballots": v[1]} for k, v in turnout.items()}
        for race in races:
            race.reporting["unit"] = "towns"

    election_meta = data["election"]
    return StateResults(
        state=state,
        name=STATE_NAMES.get(state, jurisdiction),
        source_name=source_name,
        source_url=f"{host}/results/public/{jurisdiction}/elections/{election}",
        last_updated=election_meta.get("lastUpdated"),
        races=races,
        counties=counties,
        registered=int(election_meta.get("totalVoters") or 0) or None,
        ballots=sum(c.get("ballots") or 0 for c in counties.values()) or None,
    )


# ---- North Carolina ----------------------------------------------------------

NC_BASE = "https://er.ncsbe.gov/enr/20261103/data"
NC_SENATE = re.compile(r"^US SENATE", re.I)
NC_HOUSE = re.compile(r"^US HOUSE OF REPRESENTATIVES DISTRICT (\d+)", re.I)


def nc_races(rows) -> dict[tuple[str, int], list[dict]]:
    races: dict[tuple[str, int], list[dict]] = {}
    for row in rows:
        name = row["cnm"]
        if NC_SENATE.match(name):
            key = ("S", 0)
        elif match := NC_HOUSE.match(name):
            key = ("H", int(match.group(1)))
        else:
            continue
        races.setdefault(key, []).append(row)
    return races


def nc_timestamp(text: str | None) -> str | None:
    """'November 4, 2026 6:35 am' (Eastern) -> ISO 8601."""
    if not text:
        return None
    try:
        local = datetime.strptime(text.replace("am", "AM").replace("pm", "PM"), "%B %d, %Y %I:%M %p")
    except ValueError:
        return None
    return local.replace(tzinfo=ZoneInfo("America/New_York")).isoformat()


def fetch_north_carolina() -> StateResults:
    county_rows = get_json(f"{NC_BASE}/county.txt")
    statewide = next(row for row in county_rows if row["cid"] == "0")
    races = []
    for (office, district), rows in sorted(nc_races(get_json(f"{NC_BASE}/results_0.txt")).items()):
        races.append(
            Race(
                office=office,
                district=district,
                label="U.S. Senate" if office == "S" else f"U.S. House District {district}",
                candidates=[
                    Candidate(name=r["bnm"], party=party_code(r["pty"]), votes=int(r["vct"] or 0), write_in=bool(WRITE_IN.search(r["bnm"])))
                    for r in rows
                ],
                reporting={"done": int(rows[0]["prt"]), "total": int(rows[0]["ptl"]), "unit": "precincts"},
            )
        )
    counties = {}
    by_key = {(r.office, r.district): r for r in races}
    for row in county_rows:
        if row["cid"] == "0":
            continue
        county = county_key(row["cnm"])
        counties[county] = {"registered": int(row["rtl"] or 0), "ballots": int(row["bct"] or 0)}
        time.sleep(POLITE_DELAY)
        for key, rows in nc_races(get_json(f"{NC_BASE}/results_{row['cid']}.txt")).items():
            race = by_key.get(key)
            if not race:
                continue
            votes = {r["bnm"]: int(r["vct"] or 0) for r in rows}
            race.counties[county] = [votes.get(c.name, 0) for c in race.candidates]
    return StateResults(
        state="NC",
        name="North Carolina",
        source_name="North Carolina State Board of Elections",
        source_url="https://er.ncsbe.gov/?election_dt=11/03/2026&county_id=0&office=FED&contest=0",
        last_updated=nc_timestamp(statewide.get("sub")),
        races=races,
        counties=counties,
        registered=int(statewide["rtl"]),
        ballots=int(statewide["bct"]),
    )


# ---- Ohio --------------------------------------------------------------------

OH_API = "https://liveresults.ohiosos.gov/Api/v1/Contest"
OH_HOUSE = re.compile(r"Representative to Congress - District (\d+)", re.I)


def oh_candidates(contest) -> list[Candidate]:
    return [
        Candidate(
            name=c["primaryCandidate"],
            party=party_code(c.get("candidateParty")),
            votes=int(c.get("vCount") or 0),
            write_in=bool(c.get("isWriteIn")),
        )
        for c in contest["candidatesRunning"]
    ]


def oh_race_key(name: str) -> tuple[str, int] | None:
    if name.strip() == "U.S. Senator":
        return ("S", 0)
    if match := OH_HOUSE.search(name):
        return ("H", int(match.group(1)))
    return None


def fetch_ohio() -> StateResults:
    races: dict[tuple[str, int], Race] = {}
    for contest_name in ("U.S. Senator", "Representative to Congress"):
        detail = get_json(f"{OH_API}/GetContestDetailsObject", contestName=contest_name)
        for contest in detail["contestList"]:
            key = oh_race_key(contest["name"]) or (("H", int(m.group(1))) if (m := re.search(r"(\d+)", contest["name"])) else None)
            if not key:
                continue
            races[key] = Race(
                office=key[0],
                district=key[1],
                label="U.S. Senate" if key[0] == "S" else f"U.S. House District {key[1]}",
                candidates=oh_candidates(contest),
                reporting={"done": contest.get("reportedPrecincts"), "total": contest.get("totalPrecincts"), "unit": "precincts"},
            )
    ballots = get_json(f"{OH_API}/getBallotsCastByCounty")
    counties = {}
    totals = next((row for row in ballots if row["name"] == "Totals"), None)
    for row in ballots:
        if row["name"] == "Totals":
            continue
        counties[county_key(row["name"])] = {"registered": int(row["regVoters"]), "ballots": int(row["balCast"])}
    for county in get_json(f"{OH_API}/getCountyList"):
        time.sleep(POLITE_DELAY)
        detail = get_json(f"{OH_API}/GetContestsByCounty", countyId=county["value"])
        for contest in detail["contestList"]:
            key = oh_race_key(contest["name"])
            race = races.get(key) if key else None
            if not race:
                continue
            votes = {c["primaryCandidate"]: int(c.get("vCount") or 0) for c in contest["candidatesRunning"]}
            race.counties[county_key(county["name"])] = [votes.get(c.name, 0) for c in race.candidates]
    # The statewide Senate object doesn't carry precinct counts; take them
    # from the ballots-cast totals.
    for race in races.values():
        if not race.reporting.get("total") and totals:
            race.reporting = {"done": int(totals["reportingPrecincts"]), "total": int(totals["totalNumPrecincts"]), "unit": "precincts"}
    return StateResults(
        state="OH",
        name="Ohio",
        source_name="Ohio Secretary of State",
        source_url="https://liveresults.ohiosos.gov/",
        last_updated=None,
        races=sorted(races.values(), key=lambda r: (r.office != "S", r.district)),
        counties=counties,
        registered=int(totals["regVoters"]) if totals else None,
        ballots=int(totals["balCast"]) if totals else None,
    )


# ---- Clarity ENR (Colorado, Iowa) --------------------------------------------

CLARITY = {
    "CO": ("127407", "Colorado", "Colorado Secretary of State"),
    "IA": ("127077", "Iowa", "Iowa Secretary of State"),
}
# "Representative to the 120th United States Congress - District 1" (CO),
# "United States Representative District 1" (IA).
CLARITY_HOUSE = re.compile(r"^(?:Representative to the \d+\w* United States Congress|United States Representative)\D*(\d+)\s*$", re.I)
CLARITY_SENATE = re.compile(r"(United States|U\.?S\.?) Senat", re.I)


def clarity_get(path: str):
    response = session.get(f"https://results.enr.clarityelections.com/{path}", timeout=60)
    response.raise_for_status()
    return response


def fetch_clarity(state: str) -> StateResults:
    eid, name, source_name = CLARITY[state]
    version = clarity_get(f"{state}/{eid}/current_ver.txt").text.strip()
    base = f"{state}/{eid}/{version}"
    summary = clarity_get(f"{base}/json/en/summary.json").json()
    details = {c["K"]: c for c in clarity_get(f"{base}/json/details.json").json()["Contests"]}
    settings = clarity_get(f"{base}/json/en/electionsettings.json").json()

    races = []
    for contest in summary:
        title = contest["C"]
        senate = CLARITY_SENATE.search(title)
        house = CLARITY_HOUSE.search(title) if not senate else None
        if not senate and not house:
            continue
        candidates = [
            Candidate(name=n, party=party_code(p), votes=int(v or 0), write_in=bool(WRITE_IN.search(n)))
            for n, p, v in zip(contest["CH"], contest["P"], contest["V"])
        ]
        detail = details.get(contest["K"])
        counties = {}
        if detail:
            for county, votes in zip(detail["P"], detail["V"]):
                counties[county_key(county)] = [int(v or 0) for v in votes]
        races.append(
            Race(
                office="S" if senate else "H",
                district=0 if senate else int(house.group(1)),
                label="U.S. Senate" if senate else f"U.S. House District {int(house.group(1))}",
                candidates=candidates,
                # A statewide Clarity site reports by county.
                reporting={"done": contest.get("PR"), "total": contest.get("TP"), "unit": "counties"},
                counties=counties,
            )
        )

    counties, registered, ballots = {}, None, None
    try:
        xml = clarity_get(f"{base}/reports/detailxml.zip")
        with zipfile.ZipFile(io.BytesIO(xml.content)) as archive:
            root = ElementTree.fromstring(archive.read(archive.namelist()[0]))
        turnout = root.find("ElectionVoterTurnout")
        if turnout is not None:
            registered = int(turnout.get("totalVoters") or 0) or None
            ballots = int(turnout.get("ballotsCast") or 0) or None
            for county in turnout.iter("County"):
                counties[county_key(county.get("name"))] = {
                    "registered": int(county.get("totalVoters") or 0),
                    "ballots": int(county.get("ballotsCast") or 0),
                }
    except requests.HTTPError:
        pass

    return StateResults(
        state=state,
        name=name,
        source_name=source_name,
        source_url=f"https://results.enr.clarityelections.com/{state}/{eid}/web.{version}/",
        last_updated=settings.get("websiteupdatedat"),
        races=races,
        counties=counties,
        registered=registered,
        ballots=ballots,
    )


# ---- Spreadsheets ------------------------------------------------------------

XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
XLSX_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def xlsx_column(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(content: bytes) -> dict[str, list[list[str | None]]]:
    """Every sheet's rows as lists of cell text. Enough of the format for the
    plain exports results sites produce; no styles, formulas or dates."""
    archive = zipfile.ZipFile(io.BytesIO(content))
    names = archive.namelist()
    shared = []
    if "xl/sharedStrings.xml" in names:
        for item in ElementTree.fromstring(archive.read("xl/sharedStrings.xml")).findall(f"{XLSX_NS}si"):
            shared.append("".join(t.text or "" for t in item.iter(f"{XLSX_NS}t")))
    rels = {r.get("Id"): r.get("Target") for r in ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for sheet in ElementTree.fromstring(archive.read("xl/workbook.xml")).find(f"{XLSX_NS}sheets"):
        target = rels[sheet.get(XLSX_REL)].lstrip("/")
        target = target if target.startswith("xl/") else f"xl/{target}"
        rows = []
        for row in ElementTree.fromstring(archive.read(target)).iter(f"{XLSX_NS}row"):
            cells = {}
            for cell in row.findall(f"{XLSX_NS}c"):
                kind, value = cell.get("t"), cell.find(f"{XLSX_NS}v")
                if kind == "inlineStr":
                    text = "".join(t.text or "" for t in cell.iter(f"{XLSX_NS}t"))
                elif value is None:
                    text = None
                elif kind == "s":
                    text = shared[int(value.text)]
                else:
                    text = value.text
                cells[xlsx_column(cell.get("r"))] = text
            rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
        sheets[sheet.get("name")] = rows
    return sheets


def to_int(value) -> int:
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return 0


def person_key(name: str) -> str:
    return " ".join(re.sub(r"[^A-Za-z0-9 ]", " ", name).upper().split())


# ---- TotalVote results sites (Montana, Nebraska, New Mexico, South Dakota, Oregon)

# host, results pages with federal races, name, source, time zone of the page's clock
TOTALVOTE = {
    "MT": ("electionresults.mt.gov", ["FED"], "Montana", "Montana Secretary of State", "America/Denver"),
    "NE": ("electionresults.nebraska.gov", ["SW", "CG"], "Nebraska", "Nebraska Secretary of State", "America/Chicago"),
    "NM": ("electionresults.sos.nm.gov", ["FED"], "New Mexico", "New Mexico Secretary of State", "America/Denver"),
    "SD": ("electionresults.sd.gov", ["SWR"], "South Dakota", "South Dakota Secretary of State", "America/Chicago"),
    "OR": ("results.oregonvotes.gov", ["FED"], "Oregon", "Oregon Secretary of State", "America/Los_Angeles"),
}
# Oregon's firewall turns away repeated export requests, so Oregon shows
# statewide and district totals without county breakdowns.
TOTALVOTE_NO_EXPORTS = {"OR"}
TV_SENATE = re.compile(r"United States Senat|\bU\.?S\.? Senat", re.I)
TV_HOUSE = re.compile(r"United States Representative|Representative in Congress|\bU\.?S\.? Representative", re.I)
TV_CANDIDATE = re.compile(
    r'display-results-box-d[^"]*">\s*<h1>(.*?)</h1>\s*<h2[^>]*>(.*?)</h2>.*?'
    r'display-results-box-f">\s*<(?:h1|div)>\s*([\d,]+)\s*</(?:h1|div)>',
    re.S,
)


def html_text(fragment: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def tv_district(title: str) -> int:
    match = re.search(r"(?:District|Dist\.?)\s*0*(\d+)|(\d+)(?:st|nd|rd|th)\s+(?:Congressional|District)", title, re.I)
    return int(match.group(1) or match.group(2)) if match else 0


def tv_county_votes(sheets, names: list[str]) -> dict[str, list[int]]:
    """County rows from a contest's 'County Level' export, in `names` order."""
    rows = next(iter(sheets.values()))
    header = next((i for i, r in enumerate(rows) if len(r) > 1 and (r[1] or "").strip() == "County"), None)
    if header is None:
        return {}
    columns = {person_key((cell or "").split("\n")[0]): i for i, cell in enumerate(rows[header]) if i >= 2 and cell}
    order = [columns.get(person_key(n)) for n in names]
    counties = {}
    for row in rows[header + 1 :]:
        county = (row[1] if len(row) > 1 else None) or ""
        if not county.strip() or county.strip().upper().startswith("TOTAL"):
            continue
        # South Dakota lists vote centers as extra rows: 'Brown (Vote Center)'.
        key = county_key(re.sub(r"\s*\(.*?\)\s*$", "", county))
        votes = [to_int(row[i]) if i is not None and i < len(row) else 0 for i in order]
        counties[key] = [a + b for a, b in zip(counties.get(key, [0] * len(votes)), votes)]
    return counties


def tv_updated(text: str, zone: str) -> str | None:
    match = re.search(r"last updated:?\s*(\d{1,2}/\d{1,2}/\d{4})\s*\|?\s*(\d{1,2}:\d{2})(?::\d{2})?\s*([AP]M)", text, re.I)
    if not match:
        return None
    stamp = datetime.strptime(f"{match.group(1)} {match.group(2)}{match.group(3).upper()}", "%m/%d/%Y %I:%M%p")
    return stamp.replace(tzinfo=ZoneInfo(zone)).isoformat()


def fetch_totalvote(state: str) -> StateResults:
    host, pages, name, source_name, zone = TOTALVOTE[state]
    races, text = [], ""
    for kind in pages:
        url = f"https://{host}/resultsSW.aspx?type={kind}&map=CTY"
        page = session.get(url, timeout=60)
        page.raise_for_status()
        text = text or html_text(re.sub(r"<script.*?</script>|<style.*?</style>", "", page.text, flags=re.S))
        form = {k: unescape(v) for k, v in re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page.text)}
        for block in page.text.split('<div class="display-results-box-a">')[1:]:
            title = html_text(re.search(r"<h1>(.*?)</h1>", block, re.S).group(1))
            senate = TV_SENATE.search(title) and not re.search(r"\bstate\b", title, re.I)
            house = TV_HOUSE.search(title) and not senate
            if not senate and not house:
                continue
            candidates = [
                Candidate(name=display_name(html_text(n)), party=party_code(html_text(p)), votes=to_int(v), write_in=bool(WRITE_IN.search(n)))
                for n, p, v in TV_CANDIDATE.findall(block)
            ]
            fully = re.search(r"Precincts Fully:\s*(\d+)\s*/\s*(\d+)", block)
            counties = {}
            # County exports name candidates as the page did before display_name().
            export = re.search(r"""__doPostBack\('([^']+)',''\)"[^>]*value="County Level"|__doPostBack\('([^']+CountyExport)'""", block)
            if export and state not in TOTALVOTE_NO_EXPORTS:
                time.sleep(POLITE_DELAY)
                target = export.group(1) or export.group(2)
                response = session.post(page.url, data={**form, "__EVENTTARGET": target, "__EVENTARGUMENT": ""}, timeout=120)
                if response.ok and response.content[:2] == b"PK":
                    counties = tv_county_votes(read_xlsx(response.content), [html_text(n) for n, _, _ in TV_CANDIDATE.findall(block)])
            district = 0 if senate else tv_district(title)
            races.append(
                Race(
                    office="S" if senate else "H",
                    district=district,
                    label="U.S. Senate" if senate else (f"U.S. House District {district}" if district else "U.S. House At-Large"),
                    special="unexpired" in title.lower() or "special" in title.lower(),
                    candidates=candidates,
                    reporting={"done": int(fully.group(1)), "total": int(fully.group(2)), "unit": "precincts"} if fully else {"done": None, "total": None, "unit": "precincts"},
                    counties=counties,
                )
            )
        time.sleep(POLITE_DELAY)

    ballots = re.search(r"(?:Ballots Cast|Ballots Counted|Total Turnout)\s*([\d,]+)", text)
    registered = re.search(r"(?:Active Registered Voters|Registered Voters|Eligible Voters)\s*([\d,]+)", text)
    return StateResults(
        state=state,
        name=name,
        source_name=source_name,
        source_url=f"https://{host}/",
        last_updated=tv_updated(text, zone),
        races=races,
        registered=to_int(registered.group(1)) if registered else None,
        ballots=to_int(ballots.group(1)) if ballots else None,
    )


# ---- South Carolina ----------------------------------------------------------

SC_PAGE = "https://scvotes.gov/2026-general-election-results/"
SC_SENATE = re.compile(r"^U\.?S\.?\s+Senate", re.I)
SC_HOUSE = re.compile(r"^U\.?S\.?\s+House of Representatives,?\s+District\s+(\d+)", re.I)


def sc_contest(rows) -> tuple[list[Candidate], dict[str, list[int]]]:
    """A contest sheet: a row of candidate names ('REP Lindsey Graham') over
    blocks of vote-type columns, each block ending in 'Total Votes'."""
    names_row, header = rows[1], rows[2]
    totals = [i for i, h in enumerate(header) if (h or "").strip() == "Total Votes"]
    starts = [i for i, cell in enumerate(names_row) if cell and cell.strip()]
    candidates, columns = [], []
    for start in starts:
        column = next((t for t in totals if t >= start), None)
        if column is None:
            continue
        label = names_row[start].strip()
        party, _, person = label.partition(" ") if re.match(r"^[A-Z]{3}\s", label) else ("", "", label)
        candidates.append(Candidate(name=" ".join(person.split()), party=party_code(party), votes=0, write_in=bool(WRITE_IN.search(label))))
        columns.append(column)
    counties = {}
    for row in rows[3:]:
        county = (row[0] or "").strip() if row else ""
        if not county or county.lower().startswith("total"):
            continue
        counties[county_key(county)] = [to_int(row[c]) if c < len(row) else 0 for c in columns]
    for i, candidate in enumerate(candidates):
        candidate.votes = sum(v[i] for v in counties.values())
    return candidates, counties


def fetch_south_carolina() -> StateResults:
    page = session.get(SC_PAGE, timeout=60)
    page.raise_for_status()
    # The page lists each posted spreadsheet in order; the last 'Results' one is newest.
    links = re.findall(r'<a[^>]*href="([^"]+\.xlsx)"[^>]*>(.*?)</a>', page.text, re.S)
    links = [(url, html_text(label)) for url, label in links if "result" in url.lower()]
    if not links:
        raise RuntimeError("no results spreadsheets posted yet")
    url, label = links[-1]
    sheets = read_xlsx(session.get(url, timeout=120).content)
    contents = {row[0]: row[1] for row in sheets.get("Table of Contents", []) if len(row) > 1 and row[0] and row[0].isdigit()}

    counties = {}
    for row in sheets.get("Registered Voters", [])[1:]:
        if row and row[0] and not row[0].lower().startswith("total") and len(row) > 2:
            counties[county_key(row[0])] = {"registered": to_int(row[1]), "ballots": to_int(row[2])}

    races = []
    for page_number, title in contents.items():
        senate, house = SC_SENATE.search(title), SC_HOUSE.search(title)
        if not (senate or house) or page_number not in sheets:
            continue
        candidates, by_county = sc_contest(sheets[page_number])
        district = 0 if senate else int(house.group(1))
        races.append(
            Race(
                office="S" if senate else "H",
                district=district,
                label="U.S. Senate" if senate else f"U.S. House District {district}",
                candidates=candidates,
                # The spreadsheets carry no reporting status; counties with votes are in.
                reporting={"done": sum(1 for v in by_county.values() if any(v)), "total": len(by_county), "unit": "counties"},
                counties=by_county,
            )
        )

    stamp = re.search(r"(\d{4}-\d{2}-\d{2})-(\d{1,4})\s*-?(AM|PM)", url, re.I)
    updated = None
    if stamp:
        digits = stamp.group(2)
        hour, minute = (int(digits[:-2]), int(digits[-2:])) if len(digits) > 2 else (int(digits), 0)
        when = datetime.strptime(f"{stamp.group(1)} {hour}:{minute:02d}{stamp.group(3).upper()}", "%Y-%m-%d %I:%M%p")
        # '12AM' on the 3rd is the midnight that ends election night.
        if stamp.group(3).upper() == "AM" and hour == 12:
            when = when.replace(day=when.day + 1)
        updated = when.replace(tzinfo=ZoneInfo("America/New_York")).isoformat()
    return StateResults(
        state="SC",
        name="South Carolina",
        source_name="South Carolina Election Commission",
        source_url=SC_PAGE,
        last_updated=updated,
        races=races,
        counties=counties,
        registered=sum(c["registered"] for c in counties.values()) or None,
        ballots=sum(c["ballots"] for c in counties.values()) or None,
    )


# ---- Delaware -----------------------------------------------------------------

DE_BASE = "https://elections.delaware.gov/results/enr"
DE_ELECTION = "GE2026"


def de_report_time(text: str | None) -> str | None:
    try:
        return datetime.fromisoformat((text or "").strip()).isoformat()
    except ValueError:
        pass
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime((text or "").strip(), fmt).replace(tzinfo=ZoneInfo("America/New_York")).isoformat()
        except ValueError:
            continue
    return None


def fetch_delaware() -> StateResults:
    statewide = get_json(f"{DE_BASE}/Election_StatewideResults_ID_{DE_ELECTION}.json")
    by_county = get_json(f"{DE_BASE}/Election_ByCountyWithWilmington_ID_{DE_ELECTION}.json")
    turnout = get_json(f"{DE_BASE}/Election_VoterTurnout_ID_{DE_ELECTION}.json")
    county_rows = {(r["Contest Title"], r["Candidate Name"]): r for r in by_county}

    races = []
    for title, office in (("U.S. Senator", "S"), ("Representative In Congress", "H")):
        rows = sorted((r for r in statewide if r["Contest Title"] == title), key=lambda r: r.get("Pos") or 0)
        if not rows:
            continue
        candidates = [
            Candidate(
                name=display_name(r["Candidate Name"]),
                party=party_code(re.sub(r"\s+Party$", "", r.get("Party Name") or "")),
                votes=to_int(r["Total Votes"]),
                write_in=bool(WRITE_IN.search(r["Candidate Name"])),
            )
            for r in rows
        ]
        counties = {
            county: [to_int(county_rows.get((title, r["Candidate Name"]), {}).get(county)) for r in rows]
            for county in ("New Castle", "Kent", "Sussex")
        }
        races.append(
            Race(
                office=office,
                district=0,
                label="U.S. Senate" if office == "S" else "U.S. House At-Large",
                candidates=candidates,
                reporting={"done": rows[0].get("Precincts Reported"), "total": rows[0].get("Total Precincts"), "unit": "precincts"},
                counties=counties,
            )
        )

    return StateResults(
        state="DE",
        name="Delaware",
        source_name="Delaware Department of Elections",
        source_url=f"{DE_BASE}/{DE_ELECTION}.html",
        last_updated=de_report_time(statewide[0].get("ReportTime")) if statewide else None,
        races=races,
        # Turnout is reported by state representative district, not county.
        registered=sum(to_int(r.get("Reg Voters")) for r in turnout) or None,
        ballots=sum(to_int(r.get("Ballots Cast")) for r in turnout) or None,
    )


ADAPTERS: dict[str, Callable[[], StateResults]] = {
    "GA": lambda: fetch_enhanced_voting("GA"),
    "VA": lambda: fetch_enhanced_voting("VA"),
    "NC": fetch_north_carolina,
    "OH": fetch_ohio,
    "CO": lambda: fetch_clarity("CO"),
    "IA": lambda: fetch_clarity("IA"),
    "RI": lambda: fetch_enhanced_voting("RI"),
    "SC": fetch_south_carolina,
    "DE": fetch_delaware,
    **{state: (lambda s=state: fetch_totalvote(s)) for state in TOTALVOTE},
}


# ---- Politmus candidates (photos, money, incumbency) -------------------------


def plain(name: str) -> str:
    """Accents off, so 'Luján' on an FEC record matches 'LUJAN' on a ballot."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", name) if not unicodedata.combining(ch))


def surname(name: str) -> str:
    parts = re.sub(r"[,.\"']", " ", plain(name)).split()
    parts = [p for p in parts if p.lower() not in ("jr", "sr", "ii", "iii", "iv")]
    return parts[-1].lower() if parts else ""


def name_tokens(name: str) -> set[str]:
    return {p for p in re.sub(r"[,.\"'()-]", " ", plain(name)).lower().split() if len(p) > 1 and p not in ("jr", "sr", "ii", "iii", "iv")}


def same_person(fec_name: str, ballot_name: str) -> bool:
    """FEC names add middle and married names ('Ashley Hinson Arenholz'), so
    the ballot surname only has to appear somewhere in the FEC name."""
    return surname(ballot_name) in name_tokens(fec_name) or surname(fec_name) in name_tokens(ballot_name)


def politmus_races(state: str) -> list[dict]:
    try:
        return get_json(f"{POLITMUS_API}/candidates/races", state=state, limit=60)["items"]
    except requests.RequestException as error:
        print(f"  politmus races for {state} unavailable: {error}", file=sys.stderr)
        return []


def attach_profiles(results: StateResults) -> None:
    by_race = {(r["office"], r["district"] if r["office"] == "H" else 0): r for r in politmus_races(results.state)}
    for race in results.races:
        known = by_race.get((race.office, race.district))
        if not known:
            continue
        for candidate in race.candidates:
            if candidate.write_in:
                continue
            match = next((k for k in known["candidates"] if k.get("name") and same_person(k["name"], candidate.name)), None)
            if not match:
                continue
            candidate.incumbent = candidate.incumbent or match.get("incumbent_challenge") == "I"
            candidate.profile = {
                "officialId": match["official_id"],
                "fecId": match["fec_candidate_id"],
                "name": match.get("name"),
                "photoUrl": match.get("photo_url"),
                "isMember": match.get("is_member"),
                "receipts": match.get("receipts"),
                "disbursements": match.get("disbursements"),
                "outsideSupport": match.get("outside_support"),
                "outsideOppose": match.get("outside_oppose"),
            }


# ---- Senate races without counts loaded -------------------------------------

# Official results pages for states whose counts we don't read yet, checked
# Nov. 4, 2026. Texas, Kentucky and Minnesota block automated access, so their
# counts stay on their own sites.
OFFICIAL_RESULTS_URLS = {
    "TX": "https://goelect.txelections.civixapps.com/ivis-enr-ui/races",
    "KY": "https://vrsws.sos.ky.gov/liveresults",
    "MN": "https://electionresults.sos.mn.gov/",
    "FL": "https://floridaelectionwatch.gov/",
    "NJ": "https://www.nj.gov/state/elections/election-night-results.shtml",
    "IA": "https://electionresults.iowa.gov/IA/",
    "ID": "https://voteidaho.gov/election-results/",
    "AK": "https://www.elections.alaska.gov/election-results/",
    "MS": "https://www.sos.ms.gov/elections-voting/election-results",
}


def senate_races() -> list[dict]:
    try:
        items = get_json(f"{POLITMUS_API}/candidates/races", office="S", limit=60)["items"]
    except requests.RequestException as error:
        print(f"  politmus Senate races unavailable: {error}", file=sys.stderr)
        return []
    races = []
    for race in items:
        races.append(
            {
                "state": race["state"],
                "stateName": race["state_name"],
                "label": race["label"],
                "resultsUrl": OFFICIAL_RESULTS_URLS.get(race["state"]),
                "candidates": [
                    {
                        "name": c.get("name") or c["fec_candidate_id"],
                        "party": party_code(c.get("party")),
                        "incumbent": c.get("incumbent_challenge") == "I",
                        "profile": {
                            "officialId": c["official_id"],
                            "fecId": c["fec_candidate_id"],
                            "name": c.get("name"),
                            "photoUrl": c.get("photo_url"),
                            "isMember": c.get("is_member"),
                            "receipts": c.get("receipts"),
                            "disbursements": c.get("disbursements"),
                        },
                    }
                    for c in race["candidates"][:4]
                ],
            }
        )
    return sorted(races, key=lambda r: r["state"])


# ---- Snapshot ----------------------------------------------------------------


def race_json(race: Race) -> dict:
    return {
        "office": race.office,
        "district": race.district,
        "label": race.label,
        "special": race.special,
        "totalVotes": race.total_votes,
        "reporting": race.reporting,
        "candidates": [
            {
                "name": c.name,
                "party": c.party,
                "votes": c.votes,
                **({"incumbent": True} if c.incumbent else {}),
                **({"writeIn": True} if c.write_in else {}),
                **({"profile": c.profile} if c.profile else {}),
            }
            for c in race.candidates
        ],
        "counties": race.counties,
    }


def state_json(results: StateResults) -> dict:
    return {
        "state": results.state,
        "name": results.name,
        "source": {
            "name": results.source_name,
            "url": results.source_url,
            "lastUpdated": results.last_updated,
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "official": False,
        },
        "registered": results.registered,
        "ballots": results.ballots,
        "counties": results.counties,
        "races": [race_json(r) for r in results.races],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--states", help="Comma-separated postal codes (default: every adapter)")
    args = parser.parse_args()

    wanted = [s.strip().upper() for s in args.states.split(",")] if args.states else list(ADAPTERS)
    existing = json.loads(args.out.read_text()) if args.out.exists() else {}
    states = existing.get("states", {})
    for code in wanted:
        print(f"{code}…", file=sys.stderr)
        try:
            results = ADAPTERS[code]()
            attach_profiles(results)
            states[code] = state_json(results)
            print(f"  {len(results.races)} races, {len(results.counties)} counties", file=sys.stderr)
        except Exception as error:  # keep the rest of the snapshot when one state fails
            print(f"  failed: {error!r}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "election": {"date": ELECTION_DATE, "name": "2026 General Election"},
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "states": dict(sorted(states.items())),
        "senate": senate_races(),
    }
    args.out.write_text(json.dumps(snapshot, separators=(",", ":")))
    print(f"wrote {args.out} ({args.out.stat().st_size // 1024} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
