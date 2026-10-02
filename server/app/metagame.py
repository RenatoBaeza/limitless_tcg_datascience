"""Read side of the gold layer - the questions the frontend asks.

Every answer is already a row in gold (sql/012_gold_finished.sql): the refresh
computes each period's deck table and matchup cells once, so a read here is a
PostgREST filter on a primary key and nothing is summed, ranked or rated at
request time. The columns are selected under the names the response models use,
so rows pass straight through.

Two things this module owns that the router should not:

`_client` - one httpx.Client for the process. The service is long-lived, so
reconnecting per request would throw away the connection pool.

`_cached` - a short time-to-live memo. Gold is rebuilt every six hours, so a
result is good for far longer than the 5 minutes cached here. The point is a
frontend where flipping a filter re-asks the same handful of questions.
"""

import threading
import time
from typing import Any

import httpx2 as httpx

from app import supabase

CACHE_TTL_SECONDS = 300

# Small because the key space is small: three periods times a handful of deck
# counts. Well past that, evicting everything beats tracking ages.
CACHE_MAX_ENTRIES = 256

RATE_COLUMNS = "matches,wins,losses,ties,win_rate,score_rate,score_low,score_high"

DECK_COLUMNS = (
    "deck_id,deck_name,rank,entries,tournaments,meta_share,mirror_matches,"
    f"champions,top8,{RATE_COLUMNS}"
)
CELL_COLUMNS = f"deck_a,deck_b,{RATE_COLUMNS}"
OPPONENT_COLUMNS = f"deck_b,deck_name:deck_b_name,{RATE_COLUMNS}"
PERIOD_COLUMNS = "period,days,date_from,date_to,tournaments,entries,matches,decks,refreshed_at"
COVERAGE_COLUMNS = (
    "first_event:date_from,last_event:date_to,tournaments,decks,matches,refreshed_at"
)

# The longest window, which is what the header describes.
ALL = "all"

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


def _fetch(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    client, base, hdrs = _connect()
    return supabase.select(client, base, hdrs, table, params)


def _cached(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    key = (table, tuple(sorted(params.items())))
    now = time.monotonic()

    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]

    result = _fetch(table, params)

    with _lock:
        if len(_cache) >= CACHE_MAX_ENTRIES:
            _cache.clear()
        _cache[key] = (now + CACHE_TTL_SECONDS, result)
    return result


def clear_cache() -> None:
    """Drop every memo. Called after a refresh so the next read sees new data."""
    with _lock:
        _cache.clear()


def coverage() -> dict[str, Any]:
    """What the dataset spans: the 'all' period's dates and totals."""
    rows = _cached(
        "gold_periods", {"select": COVERAGE_COLUMNS, "period": f"eq.{ALL}", "order": "period"}
    )
    return rows[0] if rows else {}


def periods() -> list[dict[str, Any]]:
    """Every period, with the dates it resolved to on the last refresh."""
    return _cached("gold_periods", {"select": PERIOD_COLUMNS, "order": "days.asc.nullslast"})


def decks(period: str, limit: int, include_other: bool) -> list[dict[str, Any]]:
    """The `limit` most-played decks in a period, with meta share and record."""
    return _cached(
        "gold_deck_stats",
        {
            "select": DECK_COLUMNS,
            "period": f"eq.{period}",
            "include_other": f"eq.{_bool(include_other)}",
            "rank": f"lte.{limit}",
            "order": "rank",
        },
    )


def matrix(
    period: str,
    deck_ids: list[str] | None,
    limit: int,
    min_matches: int,
    include_other: bool,
) -> list[dict[str, Any]]:
    """The matchup grid over one deck set on both axes: `deck_ids` if given,
    else the period's `limit` most-played decks. Only cells with data come
    back - a missing (a, b) pair means those two never met, not that the result
    was 0."""
    if deck_ids is None:
        axis = [row["deck_id"] for row in decks(period, limit, include_other)]
    else:
        axis = [d for d in deck_ids if include_other or d != "other"]
    if not axis:
        return []

    members = _in(axis)
    return _cached(
        "gold_matchup_stats",
        {
            "select": CELL_COLUMNS,
            "period": f"eq.{period}",
            "deck_a": members,
            "deck_b": members,
            "matches": f"gte.{min_matches}",
            "order": "deck_a,deck_b",
        },
    )


def deck_matchups(
    deck_id: str,
    period: str,
    min_matches: int,
    include_other: bool,
) -> list[dict[str, Any]]:
    """One deck against every opponent it faced, most-played opponent first."""
    params = {
        "select": OPPONENT_COLUMNS,
        "period": f"eq.{period}",
        "deck_a": f"eq.{deck_id}",
        "matches": f"gte.{min_matches}",
        "order": "matches.desc,deck_b",
    }
    if not include_other:
        params["deck_b"] = "neq.other"
    return _cached("gold_matchup_stats", params)


def _bool(value: bool) -> str:
    return "true" if value else "false"


def _in(values: list[str]) -> str:
    """A PostgREST `in.()` filter. Each value is double-quoted so a comma or
    parenthesis inside a deck id cannot split the list."""
    quoted = (v.replace("\\", "\\\\").replace('"', '\\"') for v in values)
    return "in.(" + ",".join(f'"{v}"' for v in quoted) + ")"
