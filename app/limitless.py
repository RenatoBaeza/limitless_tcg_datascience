"""Client for the public play.limitlesstcg.com API."""

from typing import Any

import httpx2 as httpx

BASE_URL = "https://play.limitlesstcg.com/api"


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
