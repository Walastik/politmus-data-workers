"""Fetch the Google Civic VIP test election (id 2000) response and save it as a test fixture.

Reads GOOGLE_CIVIC_API_KEY from the environment or from .env (repo root or backend/).
The key is sent only in a request header and is never printed or written to disk.

Usage (from the repo root):
    python backend/scripts/fetch_test_election_fixture.py            # print a summary only
    python backend/scripts/fetch_test_election_fixture.py --write    # also overwrite the fixture
    # Live address, letting Google pick the election, saved under another name:
    python backend/scripts/fetch_test_election_fixture.py --election-id "" --address "..." --write --out NAME.json
    python backend/scripts/fetch_test_election_fixture.py --elections [--write]   # elections list
"""
import argparse
import json
from pathlib import Path
import sys

import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from config import get_google_civic_api_key  # noqa: E402  (loads .env files)

URL = "https://www.googleapis.com/civicinfo/v2/voterinfo"
ELECTIONS_URL = "https://www.googleapis.com/civicinfo/v2/elections"
ELECTIONS_FIXTURE_NAME = "civic_elections.json"
# Google's documented address for the VIP test election.
TEST_ADDRESS = "1263 Pacific Ave Kansas City KS 66102"
FIXTURE_PATH = BACKEND_DIR / "tests" / "fixtures" / "voter_info_2000.json"


def redact(text: str, key: str) -> str:
    return text.replace(key, "[REDACTED]") if key else text


def summarize(payload: dict) -> None:
    print(f"Top-level keys: {sorted(payload.keys())}")
    print(f"Has 'status' field: {'status' in payload} (value: {payload.get('status')!r})")
    election = payload.get("election") or {}
    print(f"Election: id={election.get('id')!r} name={election.get('name')!r} day={election.get('electionDay')!r}")
    for field in ("pollingLocations", "earlyVoteSites", "dropOffLocations", "contests", "otherElections"):
        print(f"{field}: {len(payload.get(field) or [])}")
    print(f"mailOnly: {payload.get('mailOnly')!r}")
    states = payload.get("state") or []
    if states:
        print(f"state[0] keys: {sorted(states[0].keys())}")


def summarize_elections(payload: dict) -> None:
    print(f"Top-level keys: {sorted(payload.keys())}")
    elections = payload.get("elections") or []
    print(f"{len(elections)} elections:")
    for e in sorted(elections, key=lambda e: e.get("electionDay") or ""):
        extra = sorted(set(e) - {"id", "name", "electionDay", "ocdDivisionId"})
        print(
            f"  {e.get('electionDay')}  id={e.get('id'):<6} {e.get('ocdDivisionId')}  {e.get('name')}"
            + (f"  extra={extra}" if extra else "")
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="save the response as a fixture")
    parser.add_argument(
        "--out",
        default=None,
        help=f"fixture filename under tests/fixtures/ (default: {FIXTURE_PATH.name}, or {ELECTIONS_FIXTURE_NAME} with --elections)",
    )
    parser.add_argument("--elections", action="store_true", help="fetch the elections list instead of voterinfo")
    parser.add_argument("--election-id", default="2000", help='pass "" to let Google pick the next election')
    parser.add_argument("--address", default=TEST_ADDRESS)
    args = parser.parse_args()

    key = get_google_civic_api_key()
    if not key:
        print(
            "GOOGLE_CIVIC_API_KEY is not set. Add it to .env in the repo root (or export it).",
            file=sys.stderr,
        )
        return 1

    if args.elections:
        url, params = ELECTIONS_URL, {}
        print("Requesting elections list...")
    else:
        url, params = URL, {"address": args.address}
        if args.election_id:
            params["electionId"] = args.election_id
        print(f"Requesting voterinfo for election {args.election_id or '(next upcoming)'}...")
    try:
        res = requests.get(
            url,
            params=params,
            headers={"X-Goog-Api-Key": key},
            timeout=15,
        )
    except requests.RequestException as exc:
        print(f"Request failed: {type(exc).__name__}: {redact(str(exc), key)}", file=sys.stderr)
        return 1

    print(f"HTTP {res.status_code}, {len(res.content)} bytes, cache-control={res.headers.get('cache-control')!r}")
    if not res.ok:
        print(redact(res.text[:2000], key), file=sys.stderr)
        return 1

    try:
        payload = res.json()
    except ValueError:
        print("Response was not JSON:", redact(res.text[:500], key), file=sys.stderr)
        return 1
    if not isinstance(payload, dict) or not payload:
        print(f"Response JSON was empty or not an object: {payload!r}", file=sys.stderr)
        return 1

    if args.elections:
        summarize_elections(payload)
    else:
        summarize(payload)

    if args.write:
        out_name = args.out or (ELECTIONS_FIXTURE_NAME if args.elections else FIXTURE_PATH.name)
        out_path = FIXTURE_PATH.parent / Path(out_name).name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Fixture saved to {out_path}")
    else:
        print("Dry run: fixture not written (pass --write to save it).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
