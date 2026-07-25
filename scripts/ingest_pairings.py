"""Fetch pairings for tournaments that don't have them yet, into Supabase.

The Limitless API allows 50 requests per 5 minutes, so a full backfill takes
hours. This works through a bounded budget of tournaments per run and records
progress on `tournaments.pairings_ingested_at`, so consecutive runs resume
where the last one stopped. See app/ingest.py for the shared loop.

Usage:
    uv run python scripts/ingest_pairings.py [--max-requests 300] [--dry-run]
    uv run python scripts/ingest_pairings.py --tournament <id>
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import ingest  # noqa: E402
from app.limitless import to_pairing_row  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    ingest.add_common_arguments(parser, default_budget=300)
    args = parser.parse_args()

    return ingest.run(
        args,
        resource="pairings",
        table="pairings",
        row_mapper=to_pairing_row,
        on_conflict="id",
        key=lambda row: row["id"],
    )


if __name__ == "__main__":
    raise SystemExit(main())
