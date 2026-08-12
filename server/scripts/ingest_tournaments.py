"""Fetch tournaments from Limitless and upsert them into Supabase.

Idempotent: rows are upserted on the `id` primary key, so re-running only
refreshes existing rows instead of duplicating them.

Usage:
    uv run python scripts/ingest_tournaments.py [--dry-run] [--limit 2000]
"""

import argparse
import os
import sys
from datetime import date

import httpx2 as httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import supabase  # noqa: E402
from app.limitless import (  # noqa: E402
    MIN_TOURNAMENT_DATE,
    fetch_tournaments,
    in_scope,
    to_row,
)

TABLE = "bronze_tournaments"
CHUNK_SIZE = 500


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", default="PTCG")
    parser.add_argument("--format", default="STANDARD")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--limit", type=int, default=2000)
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        default=MIN_TOURNAMENT_DATE,
        help="Skip tournaments before this date (YYYY-MM-DD). Defaults to the "
             "start of the covered window.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and report what would change, but write nothing.",
    )
    args = parser.parse_args()

    try:
        base, secret_key = supabase.credentials()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    hdrs = supabase.headers(secret_key)

    tournaments = fetch_tournaments(
        game=args.game, format=args.format, page=args.page, limit=args.limit
    )
    # Drop out-of-window events before anything else sees them. The list is
    # re-fetched whole every run, so without this the pruned back-catalogue
    # returns on the next schedule.
    in_window = [t for t in tournaments if in_scope(t, args.since)]
    if len(in_window) != len(tournaments):
        print(f"skipped {len(tournaments) - len(in_window)} tournaments before {args.since}")
    rows = [to_row(t) for t in in_window]

    # Deduplicate within the payload itself; PostgREST rejects a batch that
    # touches the same primary key twice.
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        print(f"deduplicated payload: {len(rows)} -> {len(by_id)} rows")
    rows = list(by_id.values())
    print(f"fetched {len(rows)} tournaments from Limitless")

    with httpx.Client(timeout=60.0) as client:
        before = supabase.count_rows(client, base, hdrs, TABLE)
        print(f"{TABLE}: {before} rows before")

        if args.dry_run:
            print("dry run - nothing written")
            return 0

        for start in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[start : start + CHUNK_SIZE]
            supabase.upsert(client, base, hdrs, TABLE, chunk)
            print(f"  upserted {start + len(chunk)}/{len(rows)}")

        after = supabase.count_rows(client, base, hdrs, TABLE)
        print(f"{TABLE}: {after} rows after (+{after - before} new, "
              f"{len(rows) - (after - before)} updated in place)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
