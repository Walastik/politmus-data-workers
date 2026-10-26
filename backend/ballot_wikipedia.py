"""General-election ballots for every state from Wikipedia, keyed to FEC IDs.

Reads each state's 2026 House and Senate election articles, takes the
general-election results box from every race (the same boxes TX_2026 in
services/ballot_nominees.py was typed in from), and matches each nominee to
an FEC candidate ID by state, office, district and name. Campaign websites
come from the articles' "Official campaign websites" links.

Writes services/ballots_<cycle>.json, which ballot_nominees.py loads for every
state it has no hand-maintained ballot for, and prints the races that need a
person to check them. A race whose article has no general-election box yet
is left out, so it falls back to FEC filings.

    python ballot_wikipedia.py [--cycle 2026] [--state OH] [--cache DIR]
"""

import argparse
import json
import os
import re
import time
import unicodedata
from datetime import date
from pathlib import Path

import requests

from api.filters import STATE_NAME_BY_ABBR
from congress_client import _retry_wait_seconds
from fec_client import NAME_SUFFIXES, fec_get, parse_fec_name
from services.ballot_nominees import HAND_MAINTAINED

API_URL = "https://en.wikipedia.org/w/api.php"
USER_AGENT = os.getenv(
    "POLITMUS_WIKIDATA_UA",
    "PolitmusBot/1.0 (+https://politmus.com; ballot nominees from Wikipedia)",
)
REQUEST_PAUSE_SECONDS = 0.5
MAX_RETRIES = 4
RETRY_BACKOFF_SECONDS = 5.0
NON_STATES = {"DC", "AS", "GU", "MP", "PR", "VI"}
OUTPUT_DIR = Path(__file__).parent / "services"

HOUSE_TITLES = (
    "{year} United States House of Representatives elections in {state}",
    "{year} United States House of Representatives election in {state}",
)
SENATE_TITLES = (
    "{year} United States Senate election in {state}",
    "{year} United States Senate special election in {state}",
)
# Boxes for anything but the November ballot.
NOT_GENERAL = re.compile(r"(?<!post-)primary|runoff|run-off|convention|caucus|hypothetical", re.I)
ORDINAL_DISTRICT = re.compile(r"(\d+)(?:st|nd|rd|th)\s+congressional\s+district", re.I)
DISTRICT_HEADING = re.compile(r"^(={2,3})\s*(?:\{\{anchor[^}]*\}\}\s*)?District\s+(\d+)\s*\1\s*$", re.I | re.M)
AT_LARGE_HEADING = re.compile(r"^(={2,3})\s*At[- ]large(?: district)?\s*\1\s*$", re.I | re.M)
WEBSITE_LINE = re.compile(r"^\*\s*\[(https?://\S+)\s+([^\]]+?)\]", re.M)

PARTY_NAMES = {
    "democratic": "Democratic",
    "democratic-farmer-labor": "Democratic",
    "democratic–farmer–labor": "Democratic",
    "republican": "Republican",
    "libertarian": "Libertarian",
    "green": "Green",
    "independent": "Independent",
    "independent politician": "Independent",
    "nonpartisan": "Independent",
    "constitution": "Constitution",
    "working families": "Working Families",
    "forward": "Forward",
}
MAJOR_PARTIES = {"Democratic", "Republican"}


# --- Wikitext -------------------------------------------------------------

def templates(text, prefix):
    """(start, body) of each {{prefix...}} template, in order.

    Finds each one by name rather than walking every template, so a stray
    unbalanced brace elsewhere in an article can't hide the rest of it.
    """
    found = []
    pattern = re.compile(r"\{\{\s*" + re.escape(prefix).replace(r"\ ", r"\s+"), re.I)
    i = 0
    while True:
        m = pattern.search(text, i)
        if not m:
            return found
        end = _template_end(text, m.start())
        if end < 0:
            i = m.end()
            continue
        found.append((m.start(), text[m.start() + 2:end - 2]))
        i = end


def _template_end(text, start):
    depth = 0
    i = start
    while i < len(text) - 1:
        pair = text[i:i + 2]
        if pair == "{{":
            depth += 1
            i += 2
        elif pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
        else:
            i += 1
    return -1


def template_params(body):
    """Named parameters of a template body, split on top-level pipes."""
    parts, depth, current = [], 0, []
    i = 0
    while i < len(body):
        pair = body[i:i + 2]
        if pair in ("{{", "[["):
            depth += 1
            current.append(pair)
            i += 2
            continue
        if pair in ("}}", "]]"):
            depth -= 1
            current.append(pair)
            i += 2
            continue
        if body[i] == "|" and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(body[i])
        i += 1
    parts.append("".join(current))
    params = {}
    for part in parts[1:]:
        key, sep, value = part.partition("=")
        if sep:
            params[key.strip().lower()] = value.strip()
    return params


def strip_markup(value):
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"<ref[^>/]*/>", "", value)
    value = re.sub(r"<ref[^>]*>.*?</ref>", "", value, flags=re.S)
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\{\{(?:nowrap|nobr|sortname)\|([^{}]*)\}\}", lambda m: " ".join(
        p for p in m.group(1).split("|") if "=" not in p), value, flags=re.I)
    value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", value)
    value = value.replace("'''", "").replace("''", "").replace("&nbsp;", " ")
    return " ".join(value.split())


def clean_candidate(raw):
    """(name, write_in) from a box's candidate parameter."""
    text = strip_markup(raw)
    write_in = "write-in" in text.lower() or "write in" in text.lower()
    # "(incumbent)", "(write-in)", "(Uncontested)", "(R)"
    text = re.sub(r"\([^)]*\)", "", text)
    return " ".join(text.split()).strip(" ,*"), write_in


def party_name(raw):
    text = strip_markup(raw)
    if "|" in text:
        text = text.split("|")[-1]
    text = re.sub(r"\(.*?\)", "", text)
    text = re.sub(r"\s+of\s+(?:the\s+United\s+States|America|[A-Z][\w ]+)$", "", text.strip())
    text = re.sub(r"\s+Party$", "", text.strip(), flags=re.I).strip()
    if text.lower() in PARTY_NAMES:
        return PARTY_NAMES[text.lower()]
    # State affiliates: Minnesota DFL, North Dakota Democratic-NPL, ...
    for word in ("Democratic", "Republican", "Libertarian", "Green"):
        if word.lower() in text.lower():
            return word
    return text or None


def election_boxes(text):
    """[(start, title, [(name, party)])] for every results box, write-ins dropped."""
    boxes = []
    begins = templates(text, "Election box begin")
    for index, (start, body) in enumerate(begins):
        title = strip_markup(template_params(body).get("title", ""))
        stop = begins[index + 1][0] if index + 1 < len(begins) else len(text)
        end = text.find("{{Election box end", start, stop)
        end = stop if end < 0 else end
        candidates = []
        for _, candidate_body in templates(text[start:end], "Election box"):
            name_field = candidate_body.split("|", 1)[0].strip().lower()
            if "candidate" not in name_field:
                continue
            params = template_params(candidate_body)
            name, write_in = clean_candidate(params.get("candidate", ""))
            if not name or write_in or name.lower() in {"tbd", "tba", "none", "vacant"}:
                continue
            party = party_name(params.get("party", ""))
            # Fusion states (New York) list a nominee once per party line
            # plus a "Total"; keep their first line.
            if party == "Total" or name_key(name) in {name_key(n) for n, _ in candidates}:
                continue
            candidates.append((name, party))
        boxes.append((start, title, candidates))
    return boxes


def _headings(text):
    """[(offset, level, title)] for every section heading."""
    return [
        (m.start(), len(m.group(1)), m.group(2).strip())
        for m in re.finditer(r"^(={2,6})\s*(.+?)\s*\1\s*$", text, re.M)
    ]


def _section_path(headings, offset):
    path = {}
    for start, level, title in headings:
        if start > offset:
            break
        path = {k: v for k, v in path.items() if k < level}
        path[level] = title
    return [path[k] for k in sorted(path)]


def _district_at(text, offset, at_large):
    """District number of the heading above offset, or 0 for at-large states."""
    if at_large:
        return 0
    district = None
    for m in DISTRICT_HEADING.finditer(text):
        if m.start() > offset:
            break
        district = int(m.group(2))
    for m in AT_LARGE_HEADING.finditer(text):
        if m.start() > offset:
            break
        if district is None or m.start() > text.rfind(f"District {district}", 0, offset):
            district = 0
    return district


def _race_district(text, start, title, office, at_large):
    if office == "S":
        return 0
    ordinal = ORDINAL_DISTRICT.search(title)
    if ordinal:
        return int(ordinal.group(1))
    if at_large or re.search(r"at[- ]large", title, re.I):
        return 0
    return _district_at(text, start, at_large)


def infobox_nominees(text, year, office, at_large=False):
    """district -> [(name, party)] from each race's election infobox.

    Infoboxes name the major nominees before a results box is written, but
    usually leave out third parties.
    """
    races = {}
    for start, body in templates(text, "Infobox election"):
        params = template_params(body)
        title = strip_markup(params.get("election_name", ""))
        years = set(re.findall(r"\b(?:19|20)\d\d\b", title))
        if years and str(year) not in years:
            continue
        district = _race_district(text, start, title, office, at_large)
        if district is None:
            continue
        nominees = []
        for n in range(1, 7):
            name, write_in = clean_candidate(params.get(f"nominee{n}") or params.get(f"candidate{n}", ""))
            if name and not write_in:
                nominees.append((name, party_name(params.get(f"party{n}", ""))))
        if nominees:
            races.setdefault(district, nominees)
    return races


def sub_articles(text, title):
    """Titles of the pages a split article (California's districts 1–26 and
    27–52) sends each group of races to."""
    return [
        m.group(1).strip()
        for m in re.finditer(r"\{\{\s*main\s*\|([^|}]+)", text, re.I)
        if m.group(1).strip().startswith(title + " (")
    ]


def general_boxes(text, year, office, at_large=False):
    """district -> candidates from the last general-election box in each race."""
    headings = _headings(text)
    races = {}
    for start, title, candidates in election_boxes(text):
        path = _section_path(headings, start)
        if NOT_GENERAL.search(title) or any(NOT_GENERAL.search(h) for h in path):
            continue
        years = set(re.findall(r"\b(?:19|20)\d\d\b", title))
        if years and str(year) not in years:
            continue
        if any(re.search(r"\b(?:19|20)\d\d\b", h) and str(year) not in h for h in path):
            continue
        district = _race_district(text, start, title, office, at_large)
        if district is None:
            continue
        # Later boxes in a race are the general election; earlier ones are
        # usually background.
        races[district] = candidates
    return {d: c for d, c in races.items() if c}


def campaign_websites(text):
    """district (None outside a district list) -> {normalized name: campaign site}."""
    sites = {}
    marker = re.search(r"campaign websites", text, re.I)
    if not marker:
        return sites
    district = None
    for line in text[marker.start():].splitlines():
        if "campaign websites" in line.lower():
            ordinal = re.search(r"(\d+)(?:st|nd|rd|th)\b", line)
            district = int(ordinal.group(1)) if ordinal else (0 if re.search(r"at[- ]large", line, re.I) else None)
            continue
        m = WEBSITE_LINE.match(line)
        if m:
            label = re.sub(r"\s*\([^)]*\)\s*$", "", m.group(2))
            sites.setdefault(district, {}).setdefault(name_key(strip_markup(label)), m.group(1))
    return sites


def race_websites(names, district, sites):
    """Each nominee's site from their district's list: exact names first, then
    a unique last name among the sites nobody else claimed."""
    listed = dict(sites.get(district) or {})
    keys = [name_key(name) for name in names]
    found = [listed.pop(key, None) for key in keys]
    for i, key in enumerate(keys):
        if found[i] or not key:
            continue
        same_last = [other for other in listed if other.split()[-1:] == key.split()[-1:]]
        if len(same_last) == 1:
            found[i] = listed.pop(same_last[0])
        else:
            found[i] = next((group[key] for group in sites.values() if key in group), None)
    return found


# --- Names and FEC --------------------------------------------------------

def _fold(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z\s-]", "", value.replace("'", "")).replace("-", " ").split()


SUFFIX_WORDS = {s.lower().strip(".") for s in NAME_SUFFIXES} | {"jr", "sr"}


def name_tokens(name):
    return [t for t in _fold(name) if t not in SUFFIX_WORDS]


def name_key(name):
    return " ".join(name_tokens(name))


# First names FEC's legal names often spell out.
NICKNAMES = {
    "bob": "robert", "bobby": "robert", "rob": "robert", "bill": "william",
    "will": "william", "billy": "william", "jim": "james", "jimmy": "james",
    "mike": "michael", "tom": "thomas", "tommy": "thomas", "dan": "daniel",
    "danny": "daniel", "dave": "david", "joe": "joseph", "joey": "joseph",
    "chris": "christopher", "matt": "matthew", "pat": "patrick", "rick": "richard",
    "rich": "richard", "dick": "richard", "ted": ("edward", "theodore"), "ed": ("edward", "edwin"),
    "eddie": "edward", "steve": "steven", "tony": "anthony", "andy": "andrew",
    "drew": "andrew", "nick": "nicholas", "jon": "jonathan", "johnny": "john",
    "jack": "john", "ken": "kenneth", "kenny": "kenneth", "greg": "gregory",
    "jeff": "jeffrey", "tim": "timothy", "ben": "benjamin", "sam": "samuel",
    "alex": "alexander", "zach": "zachary", "jake": "jacob", "liz": "elizabeth",
    "beth": "elizabeth", "betsy": "elizabeth", "kate": "katherine", "katie": "katherine",
    "cathy": "catherine", "sue": "susan", "deb": "deborah", "debbie": "deborah",
    "pam": "pamela", "val": "valerie", "chuck": "charles", "charlie": "charles",
    "hank": "henry", "larry": "lawrence", "jerry": "gerald", "don": "donald",
    "ron": "ronald", "fred": "frederick", "frank": "francis", "vince": "vincent",
    "abe": "abraham", "doug": "douglas", "phil": "philip", "ray": "raymond",
    "wes": "wesley", "brad": "bradley", "josh": "joshua", "gabe": "gabriel",
    "max": "maximilian", "nate": "nathaniel", "nathan": "nathaniel",
    "russ": "russell", "marty": "martin", "mitch": "mitchell", "terri": "teresa", "caitlyn": "caitlin",
}


def _first_names(word):
    full = NICKNAMES.get(word, ())
    return {word, *([full] if isinstance(full, str) else full)}


def fec_tokens(fec_name):
    parts = parse_fec_name(fec_name)
    last = name_tokens(parts["last_name"] or "")
    given = name_tokens(" ".join(filter(None, [parts["first_name"], parts["middle_name"]])))
    nick = name_tokens(parts["nickname"] or "")
    return last, given, nick


def name_match(wiki_name, fec_name):
    """'full' when last and first names agree, 'last' when only the last does.

    Compares words rather than FEC's name order, which isn't reliable: it has
    "NICK, LALOTA" and "ARENHOLZ, ASHLEY HINSON" (Ashley Hinson).
    """
    tokens = name_tokens(wiki_name)
    last, given, nick = fec_tokens(fec_name)
    fec_words = set(last + given + nick)
    if len(tokens) < 2 or not fec_words:
        return None
    wiki_last = tokens[-1]
    compound = " ".join(last)
    if wiki_last not in fec_words and not (compound and " ".join(tokens).endswith(compound)):
        return None
    first = tokens[0]
    fec_firsts = set()
    for word in fec_words - {wiki_last}:
        fec_firsts |= _first_names(word)
    if _first_names(first) & fec_firsts:
        return "full"
    # "J. D. Smith" or "JD Smith" against FEC's "SMITH, JOHN DAVID"
    if len(first.rstrip(".")) <= 2 and given and given[0][0] == first[0]:
        return "full"
    return "last"


def fetch_fec_candidates(cycle, state, office):
    results, page = [], 1
    while True:
        payload = fec_get("/candidates/", params={
            "election_year": cycle, "state": state, "office": office,
            "per_page": 100, "page": page, "sort": "name",
        })
        results.extend(payload.get("results") or [])
        if page >= ((payload.get("pagination") or {}).get("pages") or 1):
            return results
        page += 1


def _district_of(candidate):
    try:
        return int(candidate.get("district") or 0)
    except ValueError:
        return 0


def _middle_agreement(wiki_name, fec_name):
    """1 when middle initials agree, -1 when they differ, 0 when either has none."""
    middles = name_tokens(wiki_name)[1:-1]
    _, given, _ = fec_tokens(fec_name)
    if not middles or len(given) < 2:
        return 0
    return 1 if middles[0][0] == given[1][0] else -1


def match_race(names, district, office, fec_candidates):
    """[(fec_id, how)] for a race's nominees, each FEC candidate used once.

    Pairs are taken best first, so two nominees with one surname (Alaska's
    two Republican Dan Sullivans) don't share an ID.
    """
    pairs = []
    for i, name in enumerate(names):
        for c in fec_candidates:
            level = name_match(name, c["name"])
            in_race = office == "S" or _district_of(c) == district
            if level is None or (level == "last" and not in_race):
                continue
            score = (
                level == "full",
                in_race,
                _middle_agreement(name, c["name"]),
                bool(c.get("has_raised_funds")),
                c.get("first_file_date") or "",
            )
            pairs.append((score, i, c))
    pairs.sort(key=lambda p: p[0], reverse=True)
    matches = [(None, "no FEC match")] * len(names)
    used = set()
    for score, i, c in pairs:
        if matches[i][0] or c["candidate_id"] in used:
            continue
        full, in_race = score[0], score[1]
        how = "" if full and in_race else "last name only" if in_race else f"FEC lists district {_district_of(c)}"
        matches[i] = (c["candidate_id"], how)
        used.add(c["candidate_id"])
    return matches


# --- Ballots --------------------------------------------------------------

def fetch_wikitext(title, cache_dir=None):
    """(resolved title, wikitext) for an article, or (title, None) if missing."""
    cache = Path(cache_dir) / (title.replace(" ", "_") + ".json") if cache_dir else None
    if cache and cache.exists():
        data = json.loads(cache.read_text())
        return data["title"], data["wikitext"]
    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_PAUSE_SECONDS)
        response = requests.get(API_URL, params={
            "action": "parse", "page": title, "prop": "wikitext",
            "redirects": 1, "format": "json", "formatversion": 2,
        }, headers={"User-Agent": USER_AGENT}, timeout=30)
        if response.status_code != 429 and response.status_code < 500 or attempt == MAX_RETRIES:
            break
        time.sleep(_retry_wait_seconds(response, RETRY_BACKOFF_SECONDS * attempt))
    response.raise_for_status()
    payload = response.json()
    parsed = payload.get("parse")
    resolved, wikitext = (parsed["title"], parsed["wikitext"]) if parsed else (title, None)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"title": resolved, "wikitext": wikitext}))
    return resolved, wikitext


def first_article(patterns, year, state_name, cache_dir):
    for pattern in patterns:
        title, text = fetch_wikitext(pattern.format(year=year, state=state_name), cache_dir)
        if text:
            return title, text
    return None, None


# All-party primaries in November: several nominees can share a party.
SHARED_PARTY_STATES = {"AK", "CA", "LA", "WA"}


def review_notes(state, nominees):
    notes = []
    parties = [n["party"] for n in nominees]
    missing = MAJOR_PARTIES - set(parties)
    if missing and state not in SHARED_PARTY_STATES:
        notes.append("no " + " or ".join(sorted(missing)) + " nominee")
    dupes = sorted({p for p in parties if parties.count(p) > 1 and p != "Independent"})
    if dupes and state not in SHARED_PARTY_STATES:
        notes.append("two nominees from " + ", ".join(dupes))
    for n in nominees:
        if n["party"] in MAJOR_PARTIES and not n["fec_candidate_id"]:
            notes.append(f"{n['name']} ({n['party']}) has no FEC match")
        elif n.get("_how"):
            notes.append(f"{n['name']}: {n['_how']}")
    return notes


def office_races(cycle, office, title, text, cache_dir):
    """(district -> [(name, party)], websites, districts read from infoboxes)."""
    texts = [text] + [
        page for _, page in (fetch_wikitext(sub, cache_dir) for sub in sub_articles(text, title)) if page
    ]
    at_large = office == "H" and " election in " in title
    boxes, infoboxes, websites = {}, {}, {}
    for page in texts:
        boxes.update(general_boxes(page, cycle, office, at_large=at_large))
        for district, nominees in infobox_nominees(page, cycle, office, at_large=at_large).items():
            infoboxes.setdefault(district, nominees)
        for district, sites in campaign_websites(page).items():
            websites.setdefault(district, {}).update(sites)
    from_infobox = set(infoboxes) - set(boxes)
    return {**{d: infoboxes[d] for d in from_infobox}, **boxes}, websites, from_infobox


def state_ballot(cycle, state, cache_dir=None):
    """({"source", "articles", "races"}, [(race, note)]) for one state."""
    state_name = STATE_NAME_BY_ABBR[state]
    races, review, articles = [], [], []
    for office, patterns in (("S", SENATE_TITLES), ("H", HOUSE_TITLES)):
        title, text = first_article(patterns, cycle, state_name, cache_dir)
        if not text:
            if office == "H":
                review.append((f"{state} House", "no Wikipedia article"))
            continue
        articles.append(title)
        found, websites, from_infobox = office_races(cycle, office, title, text, cache_dir)
        if office == "H" and not found:
            review.append((f"{state} House", "no general-election boxes found"))
        if not found:
            continue
        fec_candidates = fetch_fec_candidates(cycle, state, office)
        for district, candidates in sorted(found.items()):
            names = [name for name, _ in candidates]
            matches = match_race(names, district, office, fec_candidates)
            sites = race_websites(names, district if office == "H" else None, websites)
            nominees = [
                {
                    "fec_candidate_id": fec_id,
                    "name": name,
                    "party": party,
                    "website": site,
                    "_how": how if fec_id or party in MAJOR_PARTIES else "",
                }
                for (name, party), (fec_id, how), site in zip(candidates, matches, sites)
            ]
            label = f"{state} Senate" if office == "S" else f"{state}-{district or 'AL'}"
            if district in from_infobox:
                review.append((label, "from the infobox, no results box yet; third parties may be missing"))
            for note in review_notes(state, nominees):
                review.append((label, note))
            races.append({
                "office": office,
                "district": district,
                "nominees": [{k: v for k, v in n.items() if not k.startswith("_")} for n in nominees],
            })
    source = f"Wikipedia, checked {date.today():%b. %-d, %Y}"
    return {"source": source, "articles": articles, "races": races}, review


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cycle", type=int, default=2026)
    parser.add_argument("--state", action="append", help="Only these states (repeatable).")
    parser.add_argument("--cache", help="Directory to cache Wikipedia articles in.")
    parser.add_argument("--include-hand-maintained", action="store_true",
                        help="Also parse states ballot_nominees.py already lists (to compare).")
    parser.add_argument("--out", help="Write here instead of services/ballots_<cycle>.json.")
    args = parser.parse_args()

    out_path = Path(args.out) if args.out else OUTPUT_DIR / f"ballots_{args.cycle}.json"
    existing = json.loads(out_path.read_text()) if out_path.exists() else {"states": {}}
    states = [s.upper() for s in args.state] if args.state else sorted(
        s for s in STATE_NAME_BY_ABBR if s not in NON_STATES
    )
    all_review = []
    for state in states:
        if (args.cycle, state) in HAND_MAINTAINED and not args.include_hand_maintained:
            continue
        ballot, review = state_ballot(args.cycle, state, args.cache)
        existing["states"][state] = ballot
        all_review.extend(review)
        print(f"{state}: {len(ballot['races'])} races, {len(review)} to review")

    existing["states"] = dict(sorted(existing["states"].items()))
    out_path.write_text(json.dumps(existing, indent=1, ensure_ascii=False) + "\n")
    print(f"\nWrote {out_path}")
    if all_review:
        print("\nTo review:")
        for label, note in all_review:
            print(f"  {label}: {note}")


if __name__ == "__main__":
    main()
