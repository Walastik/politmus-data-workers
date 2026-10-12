"""Helper script to fetch and save live test election fixture from Google Civic API."""
import json
import os
from pathlib import Path
import sys

import requests

KEY = os.getenv("GOOGLE_CIVIC_API_KEY")
if not KEY:
    print("GOOGLE_CIVIC_API_KEY environment variable is not set.", file=sys.stderr)
    sys.exit(1)

URL = "https://www.googleapis.com/civicinfo/v2/voterinfo"
params = {
    "address": "1263 Pacific Ave Kansas City KS 66102",
    "electionId": "2000",
}
headers = {"X-Goog-Api-Key": KEY}
res = requests.get(URL, params=params, headers=headers)
if not res.ok:
    print(f"Request failed with {res.status_code}: {res.text}", file=sys.stderr)
    sys.exit(1)

out_file = (
    Path(__file__).resolve().parent.parent
    / "tests"
    / "fixtures"
    / "voter_info_2000.json"
)
out_file.parent.mkdir(parents=True, exist_ok=True)
with open(out_file, "w") as f:
    json.dump(res.json(), f, indent=2)

print(f"Fixture saved to {out_file}")
