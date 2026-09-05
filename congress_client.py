import os

import requests
from dotenv import load_dotenv

from database import SessionLocal
from models import Official

load_dotenv()

BASE_URL = "https://api.congress.gov/v3"
API_KEY = os.getenv("CONGRESS_GOV_API_KEY")
PAGE_SIZE = 250


def fetch_current_members():
    if not API_KEY:
        raise RuntimeError("CONGRESS_GOV_API_KEY is not set")

    headers = {"X-Api-Key": API_KEY}
    url = f"{BASE_URL}/member"
    params = {
        "currentMember": "true",
        "limit": PAGE_SIZE,
        "format": "json",
    }
    members = []

    while url:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()
        members.extend(payload.get("members", []))
        url = payload.get("pagination", {}).get("next")
        params = None

    return members


def save_officials(members):
    session = SessionLocal()
    saved = 0

    try:
        for member in members:
            bioguide_id = member.get("bioguideId")
            if not bioguide_id:
                continue

            session.merge(
                Official(
                    id=bioguide_id,
                    name=member.get("name"),
                    state=member.get("state"),
                    party=member.get("partyName"),
                )
            )
            saved += 1

        session.commit()
        return saved
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def main():
    members = fetch_current_members()
    saved = save_officials(members)
    print(f"Fetched {len(members)} members and saved {saved} officials.")


if __name__ == "__main__":
    main()
