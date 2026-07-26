"""The metagame endpoints - everything the frontend reads.

Thin by design: each route validates its query string and hands off to
app/metagame.py, which calls the matching gold function. The interesting
decisions all live in sql/006_gold.sql.

Every route takes the same `from`/`to` window and scopes to it. They are
declared `def` rather than `async def` so FastAPI runs them on the threadpool -
the Supabase client underneath is synchronous, and awaiting it on the event
loop would block every other request.
"""

from datetime import date

from fastapi import APIRouter, Query

from app import metagame
from app.models import Coverage, DeckMatchup, DeckSummary, MatchupCell

router = APIRouter(tags=["metagame"])

# A matrix axis past ~30 decks stops being readable as a grid, but the cap is
# generous so a caller can pull the long tail if it wants to.
MAX_AXIS = 100
MAX_DECKS = 500


@router.get("/coverage")
def get_coverage() -> Coverage:
    """Date bounds and totals, so a client can pick a sensible default window."""
    return Coverage(**metagame.coverage())


@router.get("/decks")
def list_decks(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=MAX_DECKS),
    include_other: bool = False,
) -> list[DeckSummary]:
    """Most-played decks in the window, with meta share and overall record."""
    return [
        DeckSummary(**row)
        for row in metagame.decks(date_from, date_to, limit, include_other)
    ]


@router.get("/decks/{deck_id}/matchups")
def get_deck_matchups(
    deck_id: str,
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    min_matches: int = Query(1, ge=1),
    include_other: bool = False,
) -> list[DeckMatchup]:
    """One deck against every opponent it faced, most-played opponent first.

    An unknown deck_id is not an error - it is a deck with no matches, and the
    empty list says so without the client having to special-case a 404.
    """
    return [
        DeckMatchup(**row)
        for row in metagame.deck_matchups(deck_id, date_from, date_to, min_matches, include_other)
    ]


@router.get("/matchups")
def get_matchups(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    decks: list[str] | None = Query(None, description="Pin both axes to these deck ids."),
    limit: int = Query(20, ge=2, le=MAX_AXIS, description="Axis size when decks is unset."),
    min_matches: int = Query(1, ge=1),
    include_other: bool = False,
) -> list[MatchupCell]:
    """The matchup grid, as a flat list of the cells that have data.

    Sparse on purpose: a missing (deck_a, deck_b) means those two never met.
    Filling the gaps with zeroes would be a bigger payload saying less.
    """
    return [
        MatchupCell(**row)
        for row in metagame.matrix(date_from, date_to, decks, limit, min_matches, include_other)
    ]
