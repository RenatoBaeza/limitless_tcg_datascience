"""Driver for the silver -> gold refresh.

The same arrangement as app/silver.py, and for the same reason: the transform is
Postgres functions (sql/006_gold.sql) and this module only calls them, a batch
of tournaments at a time, so no single statement gambles against the database's
timeout.

The one structural difference is that gold has a step which cannot be batched.
gold_deck_events and gold_matchups are keyed on tournament, so a batch of
tournament ids names a slice of them. gold_decks is keyed on deck and rolls up
both of those tables whole - there is no subset of it that a subset of
tournaments corresponds to - so it runs once, unbatched, after them.
"""

import argparse
import sys
from datetime import date
from typing import Any

import httpx2 as httpx

from app import supabase
from app.ingest import TOURNAMENTS_TABLE
from app.limitless import RETAIN_MONTHS, retention_cutoff

# Batched, and independent of each other.
FACT_STEPS = ("deck_events", "matchups")

# Rolls up both of the above, so it goes last and takes no batch.
ROLLUP_STEP = "decks"

STEPS = FACT_STEPS + (ROLLUP_STEP,)

CHUNK_SIZE = 200

# PostgREST caps a response at 1000 rows regardless of the limit asked for.
PAGE_SIZE = 1000


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=CHUNK_SIZE,
        help="Tournaments per refresh call. Lower it if a call hits a statement timeout.",
    )
    parser.add_argument(
        "--tournament",
        help="Refresh a single tournament id. The gold_decks roll-up still runs whole.",
    )
    parser.add_argument(
        "--only",
        choices=STEPS,
        action="append",
        help="Refresh just this table. Repeatable. Defaults to all three, in order.",
    )
    parser.add_argument(
        "--window-months",
        type=int,
        default=RETAIN_MONTHS,
        help="Only refresh tournaments from this many months back. Defaults to "
             "RETAIN_MONTHS so the derived layer stays inside the retention "
             "window; pass 0 to refresh everything.",
    )
    parser.add_argument("--dry-run", action="store_true")


def tournament_ids(
    client: httpx.Client, base: str, hdrs: dict[str, str], since: date | None = None
) -> list[str]:
    """Every bronze tournament id in scope, paged out.

    `since`, when given, filters to tournaments on or after that date. The
    refreshes are full reconciles of whatever slice they are handed, so
    handing them only in-window tournaments is what stops the derived layers
    re-adding rows the retention prune removed.
    """
    ids: list[str] = []
    while True:
        params: dict[str, str] = {"select": "id", "order": "id",
                                  "offset": str(len(ids)), "limit": str(PAGE_SIZE)}
        if since is not None:
            params["date"] = f"gte.{since.isoformat()}"
        response = supabase._send(
            client,
            "GET",
            f"{base}/rest/v1/{TOURNAMENTS_TABLE}",
            params=params,
            headers=hdrs,
        )
        response.raise_for_status()
        page = response.json()
        ids.extend(row["id"] for row in page)
        if len(page) < PAGE_SIZE:
            return ids


def run(args: argparse.Namespace) -> int:
    steps = [step for step in STEPS if not args.only or step in args.only]

    # A window of 0 means "everything", which is how a whole-database rebuild
    # is done. Otherwise the retention cutoff (today minus window-months) names
    # the oldest tournament the refresh is allowed to touch.
    since = None if args.window_months <= 0 else retention_cutoff(args.window_months)

    try:
        base, secret_key = supabase.credentials()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    hdrs = supabase.headers(secret_key)

    # Generous: a batch is a few seconds of database work, but the first build
    # of an empty gold layer is the slow case.
    with httpx.Client(timeout=300.0) as client:
        ids = [args.tournament] if args.tournament else tournament_ids(client, base, hdrs, since)
        batches = [ids[i : i + args.chunk_size] for i in range(0, len(ids), args.chunk_size)]
        print(f"{len(ids)} tournaments in {len(batches)} batches of up to {args.chunk_size}")
        if since is not None:
            print(f"retention window: tournaments on or after {since.isoformat()}")

        before = {step: supabase.count_rows(client, base, hdrs, f"gold_{step}") for step in steps}
        for step in steps:
            print(f"gold_{step}: {before[step]} rows before")

        if args.dry_run:
            print(f"dry run - would call {', '.join('refresh_gold_' + s for s in steps)}")
            return 0

        failed: list[str] = []
        attempted = 0
        for step in steps:
            written = 0
            if step == ROLLUP_STEP:
                attempted += 1
                try:
                    written = _refresh(client, base, hdrs, step, None)
                except Exception as exc:  # next run redoes it
                    failed.append(step)
                    print(f"  gold_{step} FAILED: {exc}")
            else:
                for i, batch in enumerate(batches, start=1):
                    attempted += 1
                    try:
                        written += _refresh(client, base, hdrs, step, batch)
                    except Exception as exc:  # next run redoes this batch
                        failed.append(f"{step}[{i}]")
                        print(f"  [{i}/{len(batches)}] gold_{step} FAILED: {exc}")
                        continue
                    print(f"  [{i}/{len(batches)}] gold_{step} {written:>7} rows so far")

            after = supabase.count_rows(client, base, hdrs, f"gold_{step}")
            print(
                f"gold_{step}: {after} rows after (+{after - before[step]} new, "
                f"{written - (after - before[step])} updated in place)"
            )

        if failed:
            print(f"\nfailed batches: {', '.join(failed)}")

    # Same tolerance as the ingest and silver loops: the odd failed batch
    # self-heals next run, a large share of them means something is broken.
    return 1 if len(failed) > max(1, attempted // 10) else 0


def _refresh(
    client: httpx.Client,
    base: str,
    hdrs: dict[str, str],
    step: str,
    batch: list[str] | None,
) -> int:
    result: Any = supabase.rpc(
        client,
        base,
        hdrs,
        f"refresh_gold_{step}",
        {} if batch is None else {"p_tournaments": batch},
    )
    return int(result or 0)
