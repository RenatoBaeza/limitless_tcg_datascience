"""Fetch final standings for tournaments that don't have them yet, into Supabase.

Same shape as the pairings ingest: rate-limit paced, bounded per run, and
resumable via `tournaments.standings_ingested_at`. The API's `decklist` field
is dropped in the row mapper - see app/limitless.to_standing_row.

Usage:
    uv run python scripts/ingest_standings.py [--max-requests 300] [--dry-run]
    uv run python scripts/ingest_standings.py --tournament <id>
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import ingest  # noqa: E402
from app.limitless import to_standing_row  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    ingest.add_common_arguments(parser, default_budget=300)
    args = parser.parse_args()

    return ingest.run(
        args,
        resource="standings",
        table="standings",
        row_mapper=to_standing_row,
        # `player` is unique within a tournament, so the natural key works and
        # no surrogate id is needed.
        on_conflict="tournament_id,player",
        key=lambda row: (row["tournament_id"], row["player"]),
    )


if __name__ == "__main__":
    raise SystemExit(main())
