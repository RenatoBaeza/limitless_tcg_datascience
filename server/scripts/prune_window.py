"""Drop derived rows outside the retention window.

The database is a rolling window of the last RETAIN_MONTHS (default 6). Bronze
keeps everything within MIN_TOURNAMENT_DATE - it is the only layer that costs
API time to rebuild - but silver and gold are pruned to the window and the
refreshes never re-add what this removes, because they enumerate only
in-window tournaments. See app/limitless.py:retention_cutoff and
sql/011_retention_window.sql.

One RPC call: the delete cascades silver_tournaments to silver_pairings. Gold
is not touched and needs nothing from this - it holds no per-tournament rows
for a cascade to reach, and the gold refresh clamps every period to the same
cutoff itself, so it never counted the tournaments being deleted here.

Usage:
    uv run python scripts/prune_window.py [--dry-run]
    uv run python scripts/prune_window.py --window-months 3
"""

import argparse
import os
import sys

import httpx2 as httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import supabase  # noqa: E402
from app.limitless import RETAIN_MONTHS, retention_cutoff  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--window-months",
        type=int,
        default=RETAIN_MONTHS,
        help="Months of derived history to keep. Defaults to RETAIN_MONTHS.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cutoff = retention_cutoff(args.window_months)
    print(f"retention window: pruning derived rows before {cutoff.isoformat()}")

    try:
        base, secret_key = supabase.credentials()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    hdrs = supabase.headers(secret_key)

    # Generous, like app/silver.py: a big prune cascades through every
    # silver_pairings row of the tournaments it drops.
    with httpx.Client(timeout=300.0) as client:
        before = supabase.count_rows(
            client, base, hdrs, "silver_tournaments",
            {"date": f"lt.{cutoff.isoformat()}"},
        )
        print(f"silver_tournaments: {before} rows before")

        if args.dry_run:
            print("dry run - nothing written")
            return 0

        deleted = supabase.rpc(
            client, base, hdrs, "prune_derived_before", {"p_cutoff": cutoff.isoformat()}
        )
        print(f"prune_derived_before: {deleted} tournaments deleted (cascading)")

        after = supabase.count_rows(client, base, hdrs, "silver_tournaments")
        print(f"silver_tournaments: {after} rows after")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
