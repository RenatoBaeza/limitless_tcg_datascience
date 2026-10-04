"""Load what the analyses read, from Supabase, through a local cache.

Two sources, each the cheapest that answers its question:

    matrix(period)  the gold matrix for one period - the same numbers the
                    frontend draws, so the archetypes and cycles describe a
                    matrix a reader can go and look at.
    weekly()        silver re-aggregated to deck x week, which gold does not
                    hold: gold is computed per period, not per week. Built
                    from every silver_pairings row (~330k), so the raw rows
                    are cached under cache/analysis/ and only re-fetched with
                    refresh=True.

The weekly build applies gold's rules so the two agree: a tournament needs
gold.MIN_TOURNAMENT_MATCHES matches, 'other' and unknown decks are out, and a
mirror counts toward entries but not toward a score.
"""

import csv
import gzip
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import httpx2 as httpx
import numpy as np

from app import supabase
from app.gold import MIN_TOURNAMENT_MATCHES

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "analysis"

OTHER = "other"


@dataclass
class Matrix:
    """One period's matchup matrix over its top decks, ordered by rank.

    `points[i, j]` is deck i's score against deck j (wins + ties/2), so
    `points + points.T == matches` and the diagonal is empty: gold leaves
    mirrors out.
    """

    period: str
    deck_ids: list[str]
    names: list[str]
    share: np.ndarray
    matches: np.ndarray
    points: np.ndarray


@dataclass
class Weekly:
    """Deck x week counts, one column per Monday, with no gaps between weeks.

    `entries` feed meta share (over `total_entries`); `matches` and `points`
    feed score rate, and count only non-mirror matches against a known deck.
    """

    weeks: list[date]
    deck_ids: list[str]
    names: list[str]
    entries: np.ndarray
    total_entries: np.ndarray
    matches: np.ndarray
    points: np.ndarray


class Source:
    """A Supabase connection plus the on-disk cache in front of it."""

    def __init__(self, client: httpx.Client, refresh: bool = False):
        self.client = client
        self.refresh = refresh
        self.base, key = supabase.credentials()
        self.hdrs = supabase.headers(key)

    def rows(self, name: str, table: str, columns: list[str], params: dict[str, str]) -> list[list[str]]:
        """A table read, as strings in `columns` order ('' for null), cached by name."""
        path = CACHE_DIR / f"{name}.csv.gz"
        if path.exists() and not self.refresh:
            with gzip.open(path, "rt", newline="", encoding="utf-8") as f:
                reader = csv.reader(f)
                next(reader)
                return list(reader)

        print(f"  fetching {table} ({name}) ...", flush=True)
        fetched = supabase.select(
            self.client, self.base, self.hdrs, table,
            {"select": ",".join(columns), **params},
        )
        rows = [["" if r[c] is None else str(r[c]) for c in columns] for r in fetched]

        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        with gzip.open(tmp, "wt", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(columns)
            writer.writerows(rows)
        tmp.replace(path)
        return rows

    def deck_names(self) -> dict[str, str]:
        rows = self.rows("gold_decks", "gold_decks", ["deck_id", "deck_name"], {"order": "deck_id"})
        return {deck_id: name or deck_id for deck_id, name in rows}


def matrix(source: Source, period: str, top: int) -> Matrix:
    """The period's top-`top` decks by rank and every matchup cell between them."""
    decks = source.rows(
        f"gold_deck_stats_{period}", "gold_deck_stats",
        ["deck_id", "deck_name", "rank", "meta_share"],
        {"period": f"eq.{period}", "order": "rank"},
    )
    decks = [d for d in decks if int(d[2]) <= top]
    if not decks:
        raise RuntimeError(f"gold has no deck stats for period {period!r}")
    index = {d[0]: i for i, d in enumerate(decks)}

    cells = source.rows(
        f"gold_matchup_stats_{period}", "gold_matchup_stats",
        ["deck_a", "deck_b", "matches", "wins", "ties"],
        {"period": f"eq.{period}", "order": "deck_a,deck_b"},
    )
    n = len(decks)
    matches = np.zeros((n, n))
    points = np.zeros((n, n))
    for a, b, m, w, t in cells:
        if a in index and b in index:
            i, j = index[a], index[b]
            matches[i, j] = int(m)
            points[i, j] = int(w) + int(t) / 2

    return Matrix(
        period=period,
        deck_ids=[d[0] for d in decks],
        names=[d[1] or d[0] for d in decks],
        share=np.array([float(d[3] or 0) for d in decks]),
        matches=matches,
        points=points,
    )


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def weekly(source: Source, min_matches: int = MIN_TOURNAMENT_MATCHES) -> Weekly:
    """Silver's whole window as deck x week entries, matches and points."""
    tournaments = source.rows("silver_tournaments", "silver_tournaments", ["id", "date"], {"order": "id"})
    pairings = source.rows(
        "silver_pairings", "silver_pairings",
        ["tournament_id", "winner_deck_id", "loser_deck_id", "is_tie"],
        {"order": "id"},
    )
    standings = source.rows(
        "silver_standings", "silver_standings",
        ["tournament_id", "deck_id"],
        {"order": "tournament_id,player"},
    )
    return build_weekly(tournaments, pairings, standings, source.deck_names(), min_matches)


def build_weekly(
    tournaments: list[list[str]],
    pairings: list[list[str]],
    standings: list[list[str]],
    names: dict[str, str],
    min_matches: int = MIN_TOURNAMENT_MATCHES,
) -> Weekly:
    """The pure half of weekly(), split out so it can be tested without a network."""
    match_count: dict[str, int] = {}
    for tid, *_ in pairings:
        match_count[tid] = match_count.get(tid, 0) + 1

    week_of = {
        tid: monday(date.fromisoformat(day[:10]))
        for tid, day in tournaments
        if match_count.get(tid, 0) >= max(min_matches, 1)
    }
    if not week_of:
        raise RuntimeError("no tournament in silver meets the minimum match count")

    first, last = min(week_of.values()), max(week_of.values())
    weeks = [first + timedelta(weeks=k) for k in range((last - first).days // 7 + 1)]
    week_index = {w: k for k, w in enumerate(weeks)}

    known = lambda deck: bool(deck) and deck != OTHER  # noqa: E731
    deck_ids = sorted(
        {d for _, d in standings if known(d)}
        | {d for _, w, l, _ in pairings for d in (w, l) if known(d)}
    )
    deck_index = {d: i for i, d in enumerate(deck_ids)}

    shape = (len(deck_ids), len(weeks))
    entries = np.zeros(shape)
    matches = np.zeros(shape)
    points = np.zeros(shape)

    for tid, deck in standings:
        if tid in week_of and known(deck):
            entries[deck_index[deck], week_index[week_of[tid]]] += 1

    for tid, winner, loser, is_tie in pairings:
        if tid not in week_of or not (known(winner) and known(loser)) or winner == loser:
            continue
        k = week_index[week_of[tid]]
        i, j = deck_index[winner], deck_index[loser]
        matches[i, k] += 1
        matches[j, k] += 1
        if is_tie == "True":
            points[i, k] += 0.5
            points[j, k] += 0.5
        else:
            points[i, k] += 1

    return Weekly(
        weeks=weeks,
        deck_ids=deck_ids,
        names=[names.get(d, d) for d in deck_ids],
        entries=entries,
        total_entries=entries.sum(axis=0),
        matches=matches,
        points=points,
    )
