import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env")


def get_google_civic_api_key() -> Optional[str]:
    return os.getenv("GOOGLE_CIVIC_API_KEY") or None


def get_civic_election_id_override() -> Optional[str]:
    return os.getenv("CIVIC_ELECTION_ID_OVERRIDE") or None


def get_trusted_proxy() -> bool:
    val = os.getenv("TRUSTED_PROXY", "").strip().lower()
    return val in ("1", "true", "yes", "on")


GOOGLE_CIVIC_API_KEY: Optional[str] = get_google_civic_api_key()
CIVIC_ELECTION_ID_OVERRIDE: Optional[str] = get_civic_election_id_override()
TRUSTED_PROXY: bool = get_trusted_proxy()

