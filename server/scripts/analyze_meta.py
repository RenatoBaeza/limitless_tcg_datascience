"""Archetype clustering, cycle detection and meta-shift detection, as one report.

Reads gold (the matchup matrix) and silver (weekly series), models them in
memory and writes exports/meta_analysis.md plus a JSON twin, and publishes the
JSON to client/public/analysis.json for the Insights view. Writes nothing to
the database. Silver is ~330k rows, so the first run fetches for a minute or
two and caches under cache/analysis/; pass --refresh to fetch again.

Usage:
    uv run --group analysis python scripts/analyze_meta.py
    uv run --group analysis python scripts/analyze_meta.py --period all --only cycles
    uv run --group analysis python scripts/analyze_meta.py --refresh

See analysis/archetypes.py, analysis/cycles.py and analysis/shifts.py for the
methods.
"""

import argparse
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx2 as httpx  # noqa: E402
import numpy as np  # noqa: E402

from analysis import archetypes, cycles, data, report, shifts  # noqa: E402
from app.gold import MIN_TOURNAMENT_MATCHES  # noqa: E402
from app.metagame import TOP_DECKS  # noqa: E402

STEPS = ("archetypes", "cycles", "shifts")
PERIODS = ("3d", "7d", "30d", "60d", "90d", "all")

# Static, beside the deck sprites: the analysis is a snapshot taken when this
# script runs, not something the API recomputes, so it ships with the client.
CLIENT_OUT = Path(__file__).resolve().parents[2] / "client" / "public" / "analysis.json"


def _plain(value: object) -> object:
    """JSON for a stray numpy scalar (an index out of argsort, a count out of sum)."""
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=STEPS, action="append",
                        help="Run just this analysis. Repeatable. Defaults to all three.")
    parser.add_argument("--period", choices=PERIODS, default="90d",
                        help="Gold period the archetypes and cycles read. Defaults to 90d: "
                             "enough matches to fill the matrix, recent enough that the decks "
                             "in it are still the decks being played.")
    parser.add_argument("--top", type=int, default=TOP_DECKS,
                        help="Decks in the matrix, by rank. Defaults to the frontend's axis.")
    parser.add_argument("--clusters", type=int, help="Fix the archetype count instead of choosing by silhouette.")
    parser.add_argument("--bootstrap", type=int, default=200, help="Resamples for archetype stability.")
    parser.add_argument("--sims", type=int, default=500, help="Simulated metagames for the cycle null test.")
    parser.add_argument("--min-entries", type=int, default=300,
                        help="Entries a deck needs across the window for its weekly series to be analysed.")
    parser.add_argument("--min-matches", type=int, default=MIN_TOURNAMENT_MATCHES,
                        help="Matches a tournament needs to count in the weekly series, as in gold.")
    parser.add_argument("--penalty", type=float, default=3.0,
                        help="Change-point penalty, in units of log(weeks). Higher finds fewer.")
    parser.add_argument("--recent", type=int, default=6, help="Weeks that count as recent for trends.")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--refresh", action="store_true", help="Re-fetch instead of reading the cache.")
    parser.add_argument("--out", type=Path, default=Path("exports") / "meta_analysis",
                        help="Output path, without extension; .md and .json are written.")
    parser.add_argument("--client-out", type=Path, default=CLIENT_OUT,
                        help="Where the client's Insights view reads its data. Written only on a "
                             "full run (no --only). Pass '' to skip.")
    args = parser.parse_args()

    steps = [s for s in STEPS if not args.only or s in args.only]
    rng = np.random.default_rng(args.seed)
    m = a = c = s = None

    try:
        with httpx.Client(timeout=60.0) as client:
            source = data.Source(client, refresh=args.refresh)
            if "archetypes" in steps or "cycles" in steps:
                m = data.matrix(source, args.period, args.top)
                print(f"matrix: {args.period}, {len(m.deck_ids)} decks, {int(m.matches.sum() / 2)} matches")
            if "shifts" in steps:
                w = data.weekly(source, args.min_matches)
                print(f"weekly: {len(w.weeks)} weeks, {len(w.deck_ids)} decks, "
                      f"{int(w.total_entries.sum())} entries")
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if "archetypes" in steps:
        t = time.perf_counter()
        a = archetypes.fit(m, k=args.clusters, bootstrap=args.bootstrap, rng=rng)
        print(f"archetypes: {a.k} clusters, silhouette {a.silhouettes[a.k]:.3f} ({time.perf_counter() - t:.1f}s)")
    if "cycles" in steps:
        t = time.perf_counter()
        c = cycles.fit(m, sims=args.sims, rng=rng)
        b = c.breakdown
        print(f"cycles: transitive {b.transitive:.3f}, cyclic {b.cyclic:.3f}, noise {b.noise:.3f}, "
              f"p = {c.null.p_value:.3f}, {len(c.triangles)} triangles ({time.perf_counter() - t:.1f}s)")
    if "shifts" in steps:
        s = shifts.fit(w, min_entries=args.min_entries, penalty=args.penalty, recent=args.recent)
        print(f"shifts: {len(s.decks)} decks, {len(s.changes)} change points, {len(s.trends)} trends")

    today = date.today()
    payload = report.as_json(m, a, c, s, today)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    md, js = args.out.with_suffix(".md"), args.out.with_suffix(".json")
    md.write_text(report.markdown(m, a, c, s, args.recent, today), encoding="utf-8")
    js.write_text(json.dumps(payload, indent=1, default=_plain), encoding="utf-8")
    print(f"wrote {md} and {js}")

    # The client's Insights view reads this. Only a full run is published:
    # a partial one would blank the sections it skipped.
    if args.client_out and not args.only:
        args.client_out.parent.mkdir(parents=True, exist_ok=True)
        args.client_out.write_text(json.dumps(payload, separators=(",", ":"), default=_plain), encoding="utf-8")
        print(f"wrote {args.client_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
