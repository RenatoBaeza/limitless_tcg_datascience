"""The metagame endpoints - everything the frontend reads.

Thin by design: each route validates its query string and hands off to
app/metagame.py, which reads the matching gold table. Every number was computed
by the refresh (sql/012_gold_finished.sql), so nothing here or there aggregates.

Every route takes the same `period` - one of the windows in gold_periods - and
scopes to it. They are declared `def` rather than `async def` so FastAPI runs
them on the threadpool - the Supabase client underneath is synchronous, and
awaiting it on the event loop would block every other request.
"""

from fastapi import APIRouter, Query

from app import metagame
from app.models import Coverage, DeckMatchup, DeckSummary, MatchupCell, Period, PeriodInfo

router = APIRouter(tags=["metagame"])

# A matrix axis past ~30 decks stops being readable as a grid, but the cap is
# generous so a caller can pull the long tail if it wants to.
MAX_AXIS = 100
MAX_DECKS = 500

PERIOD = Query("all", description="One of the windows gold is computed for.")


@router.get("/coverage")
def get_coverage() -> Coverage:
    """What the whole dataset spans - the 'all' period's dates and totals."""
    return Coverage(**metagame.coverage())


@router.get("/periods")
def list_periods() -> list[PeriodInfo]:
    """Every period, with the dates it resolved to on the last refresh."""
    return [PeriodInfo(**row) for row in metagame.periods()]


@router.get("/decks")
def list_decks(
    period: Period = PERIOD,
    limit: int = Query(50, ge=1, le=MAX_DECKS),
    include_other: bool = False,
) -> list[DeckSummary]:
    """Most-played decks in the period, with meta share and overall record."""
    return [DeckSummary(**row) for row in metagame.decks(period, limit, include_other)]


@router.get("/decks/{deck_id}/matchups")
def get_deck_matchups(
    deck_id: str,
    period: Period = PERIOD,
    min_matches: int = Query(1, ge=1),
    include_other: bool = False,
) -> list[DeckMatchup]:
    """One deck against every opponent it faced, most-played opponent first.

    An unknown deck_id is not an error - it is a deck with no matches, and the
    empty list says so without the client having to special-case a 404.
    """
    return [
        DeckMatchup(**row)
        for row in metagame.deck_matchups(deck_id, period, min_matches, include_other)
    ]


@router.get("/matchups")
def get_matchups(
    period: Period = PERIOD,
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
        for row in metagame.matrix(period, decks, limit, min_matches, include_other)
    ]
