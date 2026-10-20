from contextlib import asynccontextmanager
import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

# Allow `from database import ...` whether uvicorn is started from the repo
# root (`--app-dir backend`) or from inside backend/.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from api.routes import bills, finance_pacs, lookup, officials, positions, voter_info  # noqa: E402
from api.schemas import HealthOut  # noqa: E402
from init_db import ensure_schema  # noqa: E402

ensure_schema()

# uvicorn only configures its own loggers, so INFO logs from our modules (lookup
# latency, cache hits, elections refresh) were dropped. Route the "api" logger
# tree to stderr at INFO. These logs carry address hashes, never addresses.
_api_logger = logging.getLogger("api")
if not _api_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s - %(message)s"))
    _api_logger.addHandler(_handler)
    _api_logger.setLevel(logging.INFO)

DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def _cors_origins():
    raw = os.getenv("CORS_ORIGINS")
    if not raw:
        return DEFAULT_CORS_ORIGINS
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        timeout=8.0,
        headers={"User-Agent": "politmus-api voter-info"},
    )
    yield
    await app.state.http_client.aclose()


app = FastAPI(title="Politmus API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Before officials: its /{official_id:path} route would swallow /finance/pacs.
app.include_router(finance_pacs.router, prefix="/api/officials", tags=["Officials"])
app.include_router(officials.router, prefix="/api/officials", tags=["Officials"])
app.include_router(positions.router, prefix="/api/positions", tags=["Positions"])
app.include_router(bills.router, prefix="/api/bills", tags=["Bills"])
app.include_router(lookup.router, prefix="/api/lookup", tags=["Lookup"])
app.include_router(voter_info.router, prefix="/api/voter-info", tags=["Voter Info"])



@app.get("/api/health", response_model=HealthOut)
def health_check():
    return {"status": "ok", "service": "politmus-api"}
