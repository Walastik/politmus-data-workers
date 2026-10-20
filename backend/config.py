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


def get_fec_api_key() -> Optional[str]:
    """api.data.gov key for OpenFEC; fec_client.py falls back to DEMO_KEY."""
    return os.getenv("FEC_API_KEY") or None


def get_civic_election_id_override() -> Optional[str]:
    return os.getenv("CIVIC_ELECTION_ID_OVERRIDE") or None


def get_client_ip_header() -> Optional[str]:
    """Header carrying the real client IP, set by a trusted reverse proxy.

    Only set this when the API is reachable exclusively through that proxy and
    the proxy overwrites the header on every request (see frontend/nginx.conf).
    """
    return os.getenv("CLIENT_IP_HEADER", "").strip() or None


GOOGLE_CIVIC_API_KEY: Optional[str] = get_google_civic_api_key()
FEC_API_KEY: Optional[str] = get_fec_api_key()
CIVIC_ELECTION_ID_OVERRIDE: Optional[str] = get_civic_election_id_override()
CLIENT_IP_HEADER: Optional[str] = get_client_ip_header()

