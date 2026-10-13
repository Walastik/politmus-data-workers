"""Fetch the Google Civic VIP test election (id 2000) response and save it as a test fixture.

Reads GOOGLE_CIVIC_API_KEY from the environment or from .env (repo root or backend/).
The key is sent only in a request header and is never printed or written to disk.

Usage (from the repo root):
    python backend/scripts/fetch_test_election_fixture.py            # print a summary only
    python backend/scripts/fetch_test_election_fixture.py --write    # also overwrite the fixture
    python backend/scripts/fetch_test_election_fixture.py --election-id "" \
        --address "1600 Pennsylvania Ave NW Washington DC 20500" --write --out voter_info_live_dc.json
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="save the response as a fixture")
    parser.add_argument(
        "--out",
        default=FIXTURE_PATH.name,
        help=f"fixture filename under tests/fixtures/ (default: {FIXTURE_PATH.name})",
    )
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

    params = {"address": args.address}
    if args.election_id:
        params["electionId"] = args.election_id
    print(f"Requesting voterinfo for election {args.election_id or '(next upcoming)'}...")
    try:
        res = requests.get(
            URL,
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

    summarize(payload)

    if args.write:
        out_path = FIXTURE_PATH.parent / Path(args.out).name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Fixture saved to {out_path}")
    else:
        print("Dry run: fixture not written (pass --write to save it).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
