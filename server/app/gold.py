"""Driver for the silver -> gold refresh.

The same arrangement as app/silver.py: the transform is Postgres functions
(sql/012_gold_finished.sql) and this module only calls them, one RPC at a time,
so no single statement gambles against the 8s PostgREST timeout.

Gold is finished tables - every number the frontend draws, computed here once
per period rather than summed on every request - so the unit of work is the
period, not the tournament:

    periods         resolve each window's dates and totals. Runs once, first,
                    because every step after it reads those dates.
    decks           the deck dimension (names, icons). Runs once.
    matchup_stats   one call per period.
    deck_stats      one call per period. Rolls up that period's matchup cells
                    into each deck's record, so it runs after them.
"""

import argparse
import sys
from typing import Any

import httpx2 as httpx

from app import supabase
from app.limitless import RETAIN_MONTHS, retention_cutoff

# Run once, unbatched, in this order.
SETUP_STEPS = ("periods", "decks")

# Run once per period, in this order.
PERIOD_STEPS = ("matchup_stats", "deck_stats")

STEPS = SETUP_STEPS + PERIOD_STEPS

PERIODS_TABLE = "gold_periods"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--only",
        choices=STEPS,
        action="append",
        help="Refresh just this step. Repeatable. Defaults to all four, in order.",
    )
    parser.add_argument(
        "--period",
        action="append",
        help="Refresh just this period (e.g. 30d). Repeatable. Defaults to every "
             "row of gold_periods.",
    )
    parser.add_argument(
        "--window-months",
        type=int,
        default=RETAIN_MONTHS,
        help="Clamp every period to tournaments from this many months back. "
             "Defaults to RETAIN_MONTHS so gold stays inside the retention "
             "window; pass 0 to use everything silver holds.",
    )
    parser.add_argument("--dry-run", action="store_true")


def periods(client: httpx.Client, base: str, hdrs: dict[str, str]) -> list[str]:
    """Every period gold_periods defines, shortest window first."""
    response = supabase._send(
        client,
        "GET",
        f"{base}/rest/v1/{PERIODS_TABLE}",
        params={"select": "period", "order": "days.asc.nullslast"},
        headers=hdrs,
    )
    response.raise_for_status()
    return [row["period"] for row in response.json()]


def run(args: argparse.Namespace) -> int:
    steps = [step for step in STEPS if not args.only or step in args.only]

    # A window of 0 means "everything silver holds". Otherwise the retention
    # cutoff clamps every period, so gold never reaches past the window even
    # before scripts/prune_window.py has trimmed silver.
    since = None if args.window_months <= 0 else retention_cutoff(args.window_months)

    try:
        base, secret_key = supabase.credentials()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    hdrs = supabase.headers(secret_key)

    with httpx.Client(timeout=60.0) as client:
        scope = args.period or periods(client, base, hdrs)
        print(f"periods: {', '.join(scope)}")
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
            if step == "periods":
                calls = [(step, {"p_since": since.isoformat() if since else None})]
            elif step == "decks":
                calls = [(step, {})]
            else:
                calls = [(f"{step}[{period}]", {"p_period": period}) for period in scope]

            for label, payload in calls:
                attempted += 1
                try:
                    written = _refresh(client, base, hdrs, step, payload)
                except Exception as exc:  # the next run redoes it
                    failed.append(label)
                    print(f"  gold_{label} FAILED: {exc}")
                    continue
                print(f"  gold_{label}: {written} rows written")

            after = supabase.count_rows(client, base, hdrs, f"gold_{step}")
            print(f"gold_{step}: {after} rows after")

        if failed:
            print(f"\nfailed calls: {', '.join(failed)}")

    # Same tolerance as the ingest and silver loops: the odd failed call
    # self-heals next run, a large share of them means something is broken.
    return 1 if len(failed) > max(1, attempted // 10) else 0


def _refresh(
    client: httpx.Client,
    base: str,
    hdrs: dict[str, str],
    step: str,
    payload: dict[str, Any],
) -> int:
    result: Any = supabase.rpc(client, base, hdrs, f"refresh_gold_{step}", payload)
    return int(result or 0)
