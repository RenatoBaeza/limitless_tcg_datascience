"""Client for the public play.limitlesstcg.com API.

The API rate limits to 50 requests per 5 minutes per IP, advertised in the
`ratelimit-policy` header. `fetch_pairings` honours `Retry-After` on 429; the
caller is responsible for pacing requests (see RATE_LIMIT_INTERVAL).
"""

import hashlib
import time
from typing import Any

import httpx2 as httpx

BASE_URL = "https://play.limitlesstcg.com/api"

# 50 requests / 300s. Pace slightly under that to leave headroom.
RATE_LIMIT_REQUESTS = 50
RATE_LIMIT_WINDOW = 300.0
RATE_LIMIT_INTERVAL = RATE_LIMIT_WINDOW / RATE_LIMIT_REQUESTS * 1.03  # ~6.2s


def fetch_tournaments(
    game: str = "PTCG",
    format: str = "STANDARD",
    page: int = 1,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    """Fetch one page of tournaments."""
    response = httpx.get(
        f"{BASE_URL}/tournaments",
        params={"page": page, "game": game, "format": format, "limit": limit},
        timeout=60.0,
    )
    response.raise_for_status()
    return response.json()


def to_row(tournament: dict[str, Any]) -> dict[str, Any]:
    """Map an API record onto the public.tournaments column names."""
    return {
        "id": tournament["id"],
        "name": tournament["name"],
        "date": tournament["date"],
        "game": tournament["game"],
        "format": tournament["format"],
        "players": tournament["players"],
        "organizer_id": tournament.get("organizerId"),
    }


def fetch_tournament_resource(
    client: httpx.Client,
    tournament_id: str,
    resource: str,
    max_retries: int = 4,
) -> list[dict[str, Any]]:
    """Fetch a per-tournament sub-resource ("pairings", "standings").

    Retries through rate limits and transient network faults. Returns an empty
    list when the API has nothing for that tournament (404).
    """
    url = f"{BASE_URL}/tournaments/{tournament_id}/{resource}"

    for attempt in range(max_retries + 1):
        try:
            response = client.get(url)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if attempt == max_retries:
                raise
            print(f"    {type(exc).__name__}, retrying")
            time.sleep(2.0 * (2**attempt))
            continue

        if response.status_code == 429:
            if attempt == max_retries:
                response.raise_for_status()
            # The API tells us exactly how long the window has left.
            wait = float(response.headers.get("retry-after", RATE_LIMIT_WINDOW))
            print(f"    rate limited, waiting {wait:.0f}s")
            time.sleep(wait + 1)
            continue

        if response.status_code == 404:
            return []

        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    return []


def fetch_pairings(
    client: httpx.Client, tournament_id: str, max_retries: int = 4
) -> list[dict[str, Any]]:
    return fetch_tournament_resource(client, tournament_id, "pairings", max_retries)


def fetch_standings(
    client: httpx.Client, tournament_id: str, max_retries: int = 4
) -> list[dict[str, Any]]:
    return fetch_tournament_resource(client, tournament_id, "standings", max_retries)


def pairing_id(tournament_id: str, pairing: dict[str, Any]) -> str:
    """Deterministic surrogate key, matching the comment in sql/002_pairings.sql."""
    parts = [
        tournament_id,
        str(pairing.get("phase", "")),
        str(pairing.get("round", "")),
        pairing.get("match") or "",
        "" if pairing.get("table") is None else str(pairing["table"]),
        pairing.get("player1") or "",
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def to_pairing_row(tournament_id: str, pairing: dict[str, Any]) -> dict[str, Any]:
    """Map an API pairing onto the public.pairings column names.

    `winner` arrives either as a username or as a bare integer (-1 or 0) that
    encodes "no winner". Those are split into `winner` and `result_code` so
    neither meaning is lost.
    """
    raw_winner = pairing.get("winner")
    winner = raw_winner if isinstance(raw_winner, str) else None
    result_code = raw_winner if isinstance(raw_winner, int) else None

    return {
        "id": pairing_id(tournament_id, pairing),
        "tournament_id": tournament_id,
        "phase": pairing["phase"],
        "round": pairing["round"],
        "match": pairing.get("match"),
        "table_number": pairing.get("table"),
        "player1": pairing["player1"],
        "player2": pairing.get("player2"),
        "winner": winner,
        "result_code": result_code,
    }


def to_standing_row(tournament_id: str, standing: dict[str, Any]) -> dict[str, Any]:
    """Map an API standing onto the public.standings column names.

    The `decklist` field is deliberately dropped: it dwarfs everything else in
    the payload and nothing here depends on it. `deck` is flattened, and is
    occasionally an empty dict, so every field it holds is read defensively.
    """
    deck = standing.get("deck") or {}
    record = standing.get("record") or {}

    return {
        "tournament_id": tournament_id,
        "player": standing["player"],
        "name": standing.get("name"),
        "country": standing.get("country"),
        # The API calls this "placing".
        "placement": standing.get("placing"),
        "wins": record.get("wins"),
        "losses": record.get("losses"),
        "ties": record.get("ties"),
        "drop_round": standing.get("drop"),
        "deck_id": deck.get("id"),
        "deck_name": deck.get("name"),
        "deck_icons": deck.get("icons"),
    }
