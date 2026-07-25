"""Fetch pairings for tournaments that don't have them yet, into Supabase.

The Limitless API allows 50 requests per 5 minutes, so a full backfill of the
tournament table takes hours. This script therefore works through a bounded
budget of tournaments per run (--max-requests) and records progress on
`tournaments.pairings_ingested_at`, so consecutive runs resume where the last
one stopped rather than starting over.

Usage:
    uv run python scripts/ingest_pairings.py [--max-requests 400] [--dry-run]
    uv run python scripts/ingest_pairings.py --tournament <id>
"""

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx2 as httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import supabase  # noqa: E402
from app.limitless import (  # noqa: E402
    RATE_LIMIT_INTERVAL,
    fetch_pairings,
    to_pairing_row,
)

TABLE = "pairings"
CHUNK_SIZE = 500


def pending_tournaments(
    client: httpx.Client,
    base: str,
    hdrs: dict[str, str],
    budget: int,
    restale_hours: int,
) -> list[dict[str, Any]]:
    """Tournaments needing pairings: never fetched, or recent enough to still change.

    A tournament ingested while it was still running would otherwise keep its
    partial pairings forever, so anything from the last `restale_hours` is
    re-fetched.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=restale_hours)).isoformat()
    response = client.get(
        f"{base}/rest/v1/tournaments",
        params={
            "select": "id,name,players,date,pairings_ingested_at",
            "or": f"(pairings_ingested_at.is.null,date.gte.{cutoff})",
            "order": "date.desc",
            "limit": str(budget),
        },
        headers=hdrs,
    )
    response.raise_for_status()
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--max-requests",
        type=int,
        default=400,
        help="How many tournaments to fetch this run (~6.2s each under the rate limit).",
    )
    parser.add_argument(
        "--restale-hours",
        type=int,
        default=48,
        help="Re-fetch tournaments this recent even if already ingested.",
    )
    parser.add_argument("--tournament", help="Ingest a single tournament id and exit.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        base, secret_key = supabase.credentials()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    hdrs = supabase.headers(secret_key)

    with httpx.Client(timeout=60.0) as client:
        if args.tournament:
            targets = [{"id": args.tournament, "name": "<explicit>", "players": None}]
        else:
            targets = pending_tournaments(
                client, base, hdrs, args.max_requests, args.restale_hours
            )
            remaining = supabase.count_rows(
                client, base, hdrs, "tournaments",
                {"pairings_ingested_at": "is.null"},
            )
            print(f"{remaining} tournaments still have no pairings")

        before = supabase.count_rows(client, base, hdrs, TABLE)
        print(f"{TABLE}: {before} rows before")
        print(f"processing {len(targets)} tournaments this run")

        if args.dry_run:
            for t in targets[:10]:
                print(f"  would fetch {t['id']}  {t.get('name', '')[:60]}")
            if len(targets) > 10:
                print(f"  ... and {len(targets) - 10} more")
            print("dry run - nothing written")
            return 0

        written = failed = empty = 0
        for i, tournament in enumerate(targets, start=1):
            if i > 1:
                # Pace to stay inside 50 requests / 5 minutes.
                time.sleep(RATE_LIMIT_INTERVAL)

            tid = tournament["id"]
            try:
                pairings = fetch_pairings(client, tid)
            except Exception as exc:  # keep going; the next run retries this one
                failed += 1
                print(f"  [{i}/{len(targets)}] {tid} FAILED: {exc}")
                continue

            # The surrogate id collapses any repeated natural key, and PostgREST
            # rejects a batch touching the same primary key twice.
            rows = {r["id"]: r for r in (to_pairing_row(tid, p) for p in pairings)}
            batch = list(rows.values())

            for start in range(0, len(batch), CHUNK_SIZE):
                supabase.upsert(
                    client, base, hdrs, TABLE, batch[start : start + CHUNK_SIZE]
                )

            supabase.patch(
                client, base, hdrs, "tournaments",
                {"id": f"eq.{tid}"},
                {
                    "pairings_ingested_at": datetime.now(timezone.utc).isoformat(),
                    "pairings_count": len(batch),
                },
            )

            written += len(batch)
            if not batch:
                empty += 1
            print(f"  [{i}/{len(targets)}] {tid} {len(batch):>5} pairings")

        after = supabase.count_rows(client, base, hdrs, TABLE)
        print(
            f"\n{TABLE}: {after} rows after (+{after - before} new, "
            f"{written - (after - before)} updated in place)"
        )
        print(f"tournaments processed: {len(targets)}, empty: {empty}, failed: {failed}")

        still_pending = supabase.count_rows(
            client, base, hdrs, "tournaments", {"pairings_ingested_at": "is.null"}
        )
        print(f"tournaments still pending: {still_pending}")

    return 1 if failed and not written else 0


if __name__ == "__main__":
    raise SystemExit(main())
