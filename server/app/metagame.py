"""Read side of the gold layer - the four questions the frontend asks.

Every one of them is a Postgres function (sql/006_gold.sql) called over
PostgREST RPC. Nothing is aggregated here: a matchup matrix is a sum over
~350k rows, and shipping those rows to Python to add them up would spend a
second of transfer on work Postgres does in milliseconds.

Two things this module owns that the router should not:

`_client` - one httpx.Client for the process. The service is long-lived, so
reconnecting per request would throw away the connection pool.

`_cached` - a short time-to-live memo. Gold is rebuilt every six hours, so a
result is good for far longer than the 5 minutes cached here. The point is a
frontend where dragging a filter re-asks the same handful of questions.
"""

import threading
import time
from datetime import date
from typing import Any

import httpx2 as httpx

from app import supabase

CACHE_TTL_SECONDS = 300

# Small because the key space is small: a handful of date ranges times a
# handful of deck counts. Well past that, evicting everything beats tracking
# ages.
CACHE_MAX_ENTRIES = 256

_lock = threading.Lock()
_cache: dict[tuple, tuple[float, Any]] = {}
_client: httpx.Client | None = None
_connection: tuple[str, dict[str, str]] | None = None


def _connect() -> tuple[httpx.Client, str, dict[str, str]]:
    """The process-wide client and credentials, opened on first use.

    Deliberately not opened at import: credentials() raises when the
    environment is not configured, and that should surface on a request rather
    than stop the app from starting.
    """
    global _client, _connection
    with _lock:
        if _client is None or _connection is None:
            base, secret_key = supabase.credentials()
            _connection = (base, supabase.headers(secret_key))
            _client = httpx.Client(timeout=60.0)
        return _client, _connection[0], _connection[1]


def _call(function: str, payload: dict[str, Any]) -> Any:
    client, base, hdrs = _connect()
    return supabase.rpc(client, base, hdrs, function, payload)


def _cached(function: str, payload: dict[str, Any]) -> Any:
    key = (function, tuple(sorted((k, _hashable(v)) for k, v in payload.items())))
    now = time.monotonic()

    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]

    result = _call(function, payload)

    with _lock:
        if len(_cache) >= CACHE_MAX_ENTRIES:
            _cache.clear()
        _cache[key] = (now + CACHE_TTL_SECONDS, result)
    return result


def _hashable(value: Any) -> Any:
    return tuple(value) if isinstance(value, list) else value


def clear_cache() -> None:
    """Drop every memo. Called after a refresh so the next read sees new data."""
    with _lock:
        _cache.clear()


def coverage() -> dict[str, Any]:
    """What the dataset spans, so the frontend can pick a default date range."""
    rows = _cached("gold_coverage", {})
    return rows[0] if rows else {}


def decks(
    date_from: date | None,
    date_to: date | None,
    limit: int,
    include_other: bool,
) -> list[dict[str, Any]]:
    """The most-played decks in a window, with meta share and overall record."""
    return _cached(
        "gold_deck_summary",
        {
            "p_from": _iso(date_from),
            "p_to": _iso(date_to),
            "p_limit": limit,
            "p_include_other": include_other,
        },
    )


def matrix(
    date_from: date | None,
    date_to: date | None,
    deck_ids: list[str] | None,
    limit: int,
    min_matches: int,
    include_other: bool,
) -> list[dict[str, Any]]:
    """The matchup grid. Only cells with data come back - a missing (a, b) pair
    means those two decks never met, not that the result was 0."""
    return _cached(
        "gold_matchup_matrix",
        {
            "p_from": _iso(date_from),
            "p_to": _iso(date_to),
            "p_decks": deck_ids,
            "p_limit": limit,
            "p_min_matches": min_matches,
            "p_include_other": include_other,
        },
    )


def deck_matchups(
    deck_id: str,
    date_from: date | None,
    date_to: date | None,
    min_matches: int,
    include_other: bool,
) -> list[dict[str, Any]]:
    """One deck against every opponent it faced, not just the popular ones."""
    return _cached(
        "gold_deck_matchups",
        {
            "p_deck": deck_id,
            "p_from": _iso(date_from),
            "p_to": _iso(date_to),
            "p_min_matches": min_matches,
            "p_include_other": include_other,
        },
    )


def _iso(value: date | None) -> str | None:
    # None is passed through rather than dropped: every p_from / p_to in the
    # SQL reads null as "no bound", so an absent filter and an explicit null
    # mean the same thing there.
    return value.isoformat() if value else None
