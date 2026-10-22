"""Bios, portraits and websites from Wikidata, matched on FEC candidate ID (P1839).

Fills wikidata_id, wikipedia_url and bio for every official with FEC IDs.
Candidates (level='candidate') also take their name and portrait from
Wikidata, since FEC only has their legal name, and its website when their
FEC committees list none. Members keep the Congress.gov portrait and .gov
website.

Few challengers have P1839 yet, so candidates who raised real money and were
not matched get a second pass: a name search, kept only when exactly one hit
is a person whose offices, districts or description name their state.

    python wikidata_client.py [--level candidate] [--limit N]
"""

import argparse
import os
import time
from urllib.parse import quote, unquote, urlparse

import requests

from database import SessionLocal
from fec_client import NAME_SUFFIXES
from init_db import ensure_schema
from models import Candidacy, Official
from services.candidate_races import CANDIDATE_DETAIL_MIN_RECEIPTS, CANDIDATE_LEVEL

SPARQL_URL = "https://query.wikidata.org/sparql"
SEARCH_URL = "https://www.wikidata.org/w/api.php"
SEARCH_HITS = 3
# Wikidata asks bots for a descriptive User-Agent with contact details.
USER_AGENT = os.getenv(
    "POLITMUS_WIKIDATA_UA",
    "PolitmusBot/1.0 (+https://politmus.com; candidate bios from Wikidata)",
)
# Each person fans out over websites x occupations x schools x offices before
# GROUP BY, so batches stay small enough to finish within the 60s query limit.
BATCH_SIZE = 50
REQUEST_PAUSE_SECONDS = 1.0
PORTRAIT_WIDTH = 400
SEPARATOR = "|"

QUERY = """
SELECT ?fec ?item ?label ?description ?birth ?article
  (GROUP_CONCAT(DISTINCT STR(?website); separator="|") AS ?websites)
  (SAMPLE(?image) AS ?portrait)
  (GROUP_CONCAT(DISTINCT ?occupationLabel; separator="|") AS ?occupations)
  (GROUP_CONCAT(DISTINCT ?schoolLabel; separator="|") AS ?education)
  (GROUP_CONCAT(DISTINCT ?positionLabel; separator="|") AS ?positions)
  (GROUP_CONCAT(DISTINCT ?districtLabel; separator="|") AS ?districts)
WHERE {
  %s
  ?item rdfs:label ?label .
  FILTER(LANG(?label) = "en")
  OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "en") }
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P106/rdfs:label ?occupationLabel . FILTER(LANG(?occupationLabel) = "en") }
  OPTIONAL { ?item wdt:P69/rdfs:label ?schoolLabel . FILTER(LANG(?schoolLabel) = "en") }
  OPTIONAL { ?item wdt:P39/rdfs:label ?positionLabel . FILTER(LANG(?positionLabel) = "en") }
  OPTIONAL { ?item p:P39/pq:P768/rdfs:label ?districtLabel . FILTER(LANG(?districtLabel) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
}
GROUP BY ?fec ?item ?label ?description ?birth ?article
"""


def sparql(match):
    response = requests.get(
        SPARQL_URL,
        params={"query": QUERY % match},
        headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
        timeout=90,
    )
    response.raise_for_status()
    return response.json()["results"]["bindings"]


def people_by_fec_id(fec_ids):
    values = " ".join(f'"{fec_id}"' for fec_id in fec_ids)
    return [person_values(b) for b in sparql(f"VALUES ?fec {{ {values} }} ?item wdt:P1839 ?fec .")]


def people_by_item(item_ids):
    """Humans among these items, one entry each."""
    values = " ".join(f"wd:{item_id}" for item_id in item_ids)
    people = {}
    for binding in sparql(
        f"VALUES ?item {{ {values} }} ?item wdt:P31 wd:Q5 . OPTIONAL {{ ?item wdt:P1839 ?fec }}"
    ):
        person = person_values(binding)
        people.setdefault(person["wikidata_id"], person)
    return people


def search_items(name):
    response = requests.get(
        SEARCH_URL,
        params={
            "action": "wbsearchentities",
            "search": name,
            "language": "en",
            "type": "item",
            "limit": SEARCH_HITS,
            "format": "json",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    response.raise_for_status()
    return [hit["id"] for hit in response.json().get("search") or []]


def names_state(person, state_name):
    """True when an office held, its district or the description names the state."""
    state_name = state_name.lower()
    texts = person["bio"]["positions_held"] + person["districts"] + [person["bio"]["description"] or ""]
    return any(state_name in text.lower() for text in texts)


def _value(binding, key):
    value = (binding.get(key) or {}).get("value")
    return value or None


def _list(binding, key):
    return sorted({part for part in (_value(binding, key) or "").split(SEPARATOR) if part})


def portrait_url(commons_url):
    """Commons Special:FilePath URL, scaled down so the drawer never loads a 10 MB original."""
    if not commons_url:
        return None
    name = unquote(commons_url.rsplit("/", 1)[-1])
    return (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        f"{quote(name)}?width={PORTRAIT_WIDTH}"
    )


def campaign_website(websites):
    """Prefer a campaign site over a government page, which ends with the office."""
    personal = [url for url in websites if not (urlparse(url).hostname or "").endswith(".gov")]
    return (personal or websites or [None])[0]


def person_values(binding):
    """What one SPARQL row says about a person."""
    item = _value(binding, "item")
    birth = _value(binding, "birth")
    return {
        "fec_id": _value(binding, "fec"),
        "wikidata_id": item.rsplit("/", 1)[-1] if item else None,
        "label": _value(binding, "label"),
        "wikipedia_url": _value(binding, "article"),
        "portrait_url": portrait_url(_value(binding, "portrait")),
        "websites": _list(binding, "websites"),
        "districts": _list(binding, "districts"),
        "bio": {
            "description": _value(binding, "description"),
            "birth_date": birth[:10] if birth else None,
            "occupations": _list(binding, "occupations"),
            "education": _list(binding, "education"),
            "positions_held": _list(binding, "positions"),
        },
    }


def label_name_parts(label, last_name=None):
    """first/middle/last/suffix from a label like "Ken Paxton" or "Beto O'Rourke".

    last_name (FEC's) keeps multi-word surnames whole when the label ends with it.
    """
    words = label.replace(",", "").split()
    suffix = None
    if len(words) > 2 and words[-1].strip(".").upper() in NAME_SUFFIXES:
        suffix = NAME_SUFFIXES[words.pop().strip(".").upper()]
    if last_name and " ".join(words).lower().endswith(" " + last_name.lower()):
        given = words[: len(words) - len(last_name.split())]
        last = " ".join(words[len(given):])
    else:
        given, last = words[:-1], words[-1] if words else None
    return {
        "first_name": given[0] if given else None,
        "middle_name": " ".join(given[1:]) or None,
        "last_name": last,
        "suffix_name": suffix,
    }


def apply_person(official, person):
    official.wikidata_id = person["wikidata_id"]
    official.wikipedia_url = person["wikipedia_url"]
    official.bio = person["bio"]
    if official.level != CANDIDATE_LEVEL:
        return
    if person["label"]:
        for column, value in label_name_parts(person["label"], official.last_name).items():
            setattr(official, column, value)
        official.nickname = None
    if person["portrait_url"]:
        official.photo_url = person["portrait_url"]
        official.photo_attribution = "Wikimedia Commons"
    # FEC registration (fec_client.py) is the campaign's own current site;
    # Wikidata only fills in when there isn't one.
    website = campaign_website(person["websites"])
    if website and not official.website_url:
        official.website_url = website


def run(level=None, limit=None):
    ensure_schema()
    session = SessionLocal()
    try:
        query = session.query(Official).filter(Official.fec_candidate_ids.isnot(None))
        if level:
            query = query.filter(Official.level == level)
        officials = query.order_by(Official.wikidata_id.isnot(None), Official.id).all()
        if limit:
            officials = officials[:limit]
        by_fec_id = {
            fec_id: official for official in officials for fec_id in official.fec_candidate_ids or []
        }
        fec_ids = sorted(by_fec_id)
        matched = set()
        for start in range(0, len(fec_ids), BATCH_SIZE):
            batch = fec_ids[start:start + BATCH_SIZE]
            try:
                people = people_by_fec_id(batch)
            except requests.RequestException as exc:
                print(f"  Batch {start // BATCH_SIZE + 1} failed: {exc}")
                continue
            for person in people:
                official = by_fec_id.get(person["fec_id"])
                # A member with several FEC IDs matches once per ID.
                if official is None or official.id in matched:
                    continue
                apply_person(official, person)
                matched.add(official.id)
            session.commit()
            print(f"  {min(start + BATCH_SIZE, len(fec_ids))}/{len(fec_ids)} FEC IDs, {len(matched)} matched")
            time.sleep(REQUEST_PAUSE_SECONDS)
        print(f"Done: {len(matched)} of {len(officials)} officials matched on FEC ID.")
        if level in (None, CANDIDATE_LEVEL):
            searched = match_by_name(session, [o for o in officials if o.id not in matched])
            print(f"Done: {searched} more candidates matched by name.")
    finally:
        session.close()


def match_by_name(session, officials):
    """Second pass for unmatched candidates who raised real money; returns matches."""
    funded = {
        official_id
        for (official_id,) in session.query(Candidacy.official_id)
        .filter(Candidacy.receipts >= CANDIDATE_DETAIL_MIN_RECEIPTS)
        .distinct()
    }
    candidates = [
        o for o in officials if o.level == CANDIDATE_LEVEL and not o.wikidata_id and o.id in funded
    ]
    matches = 0
    for start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[start:start + BATCH_SIZE]
        try:
            hits = {official.id: search_items(official.display_name) for official in batch}
            people = people_by_item(sorted({item for items in hits.values() for item in items}))
        except requests.RequestException as exc:
            print(f"  Name batch {start // BATCH_SIZE + 1} failed: {exc}")
            continue
        for official in batch:
            fits = [
                people[item] for item in hits[official.id]
                if item in people and names_state(people[item], official.state or "")
            ]
            if len(fits) == 1:
                apply_person(official, fits[0])
                matches += 1
        session.commit()
        print(f"  {min(start + BATCH_SIZE, len(candidates))}/{len(candidates)} searched, {matches} matched")
        time.sleep(REQUEST_PAUSE_SECONDS)
    return matches


def main():
    parser = argparse.ArgumentParser(description="Bios and portraits from Wikidata.")
    parser.add_argument("--level", help="Only officials at this level (e.g. candidate).")
    parser.add_argument("--limit", type=int, help="Stop after this many officials.")
    args = parser.parse_args()
    run(level=args.level, limit=args.limit)


if __name__ == "__main__":
    main()
