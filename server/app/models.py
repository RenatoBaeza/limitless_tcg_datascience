"""Response shapes for the metagame endpoints.

These mirror the gold tables in sql/012_gold_finished.sql (reshaped by
sql/014_fixed_view.sql), one field per
column, and app/metagame.py selects each column under the field name used here.
Two conventions run through all of them:

`win_rate` is wins / (wins + losses) and `score_rate` is
(wins + ties/2) / matches. Ties are ~6% of matches here, so the two genuinely
differ and both are returned rather than one being chosen on the reader's
behalf.

`score_low` / `score_high` bound score_rate with a 95% Wilson interval. They
are what makes a 3-match cell readable as the guess it is, so anything drawing
a rate should draw them too.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

# The windows gold is computed for - the rows of gold_periods. Adding one means
# a row there, a member here, and a preset in client/src/filters.ts.
Period = Literal["3d", "7d", "30d", "60d", "90d", "all"]


class Coverage(BaseModel):
    """What the gold layer currently spans."""

    first_event: date | None = None
    last_event: date | None = None
    tournaments: int = 0
    decks: int = 0
    matches: int = 0
    refreshed_at: datetime | None = None


class PeriodInfo(BaseModel):
    """One window, with the dates it resolved to on the last refresh."""

    period: Period
    # Null for "all", which runs from the first event in the retention window.
    days: int | None = None
    date_from: date | None = None
    date_to: date | None = None
    tournaments: int = 0
    entries: int = 0
    matches: int = 0
    decks: int = 0
    refreshed_at: datetime | None = None


class DeckSummary(BaseModel):
    deck_id: str
    deck_name: str | None = None
    # 1 is the most played deck in the period.
    rank: int
    entries: int
    tournaments: int
    # Share of every deck entry in the window, 0-1. Null only when the window
    # is empty.
    meta_share: float | None = None
    matches: int
    wins: int
    losses: int
    ties: int
    win_rate: float | None = None
    score_rate: float | None = None
    score_low: float | None = None
    score_high: float | None = None
    # Mirror matches are left out of every rate above and counted here.
    mirror_matches: int = 0
    champions: int
    top8: int


class MatchupCell(BaseModel):
    """One (deck_a, deck_b) cell of the matrix, from deck_a's side."""

    deck_a: str
    deck_b: str
    matches: int
    wins: int
    losses: int
    ties: int
    win_rate: float | None = None
    score_rate: float | None = None
    score_low: float | None = None
    score_high: float | None = None


class DeckMatchup(BaseModel):
    """One opponent of a single deck, carrying that opponent's display name."""

    deck_b: str
    deck_name: str | None = None
    matches: int
    wins: int
    losses: int
    ties: int
    win_rate: float | None = None
    score_rate: float | None = None
    score_low: float | None = None
    score_high: float | None = None
