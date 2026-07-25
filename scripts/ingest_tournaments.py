"""Fetch tournaments from Limitless and upsert them into Supabase.

Idempotent: rows are upserted on the `id` primary key, so re-running only
refreshes existing rows instead of duplicating them.

Usage:
    uv run python scripts/ingest_tournaments.py [--dry-run] [--limit 2000]
"""

import argparse
import os
import sys
from typing import Any

import httpx2 as httpx
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.limitless import fetch_tournaments, to_row  # noqa: E402

TABLE = "tournaments"
CHUNK_SIZE = 500

def supabase_headers(secret_key: str) -> dict[str, str]:
    return {
        "apikey": secret_key,
        "Authorization": f"Bearer {secret_key}",
        "Content-Type": "application/json",
    }

def count_rows(client: httpx.Client, base: str, headers: dict[str, str]) -> int:
    """Row count via a HEAD-style exact count request."""
    response = client.get(
        f"{base}/rest/v1/{TABLE}",
        params={"select": "id", "limit": "1"},
        headers={**headers, "Prefer": "count=exact"},
    )
    response.raise_for_status()
    content_range = response.headers.get("content-range", "*/0")
    return int(content_range.split("/")[-1])


def upsert(
    client: httpx.Client,
    base: str,
    headers: dict[str, str],
    rows: list[dict[str, Any]],
) -> None:
    response = client.post(
        f"{base}/rest/v1/{TABLE}",
        params={"on_conflict": "id"},
        headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"upsert failed ({response.status_code}): {response.text}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", default="PTCG")
    parser.add_argument("--format", default="STANDARD")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--limit", type=int, default=2000)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and report what would change, but write nothing.",
    )
    args = parser.parse_args()

    # No-op when running in CI, where the values come from the environment.
    load_dotenv()
    missing = [
        name
        for name in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
        if not os.environ.get(name)
    ]
    if missing:
        print(
            f"error: missing {', '.join(missing)}. Set them in .env locally, or as "
            "repository secrets for the scheduled workflow.",
            file=sys.stderr,
        )
        return 1

    base = os.environ["SUPABASE_URL"].rstrip("/")
    secret_key = os.environ["SUPABASE_SECRET_KEY"]
    headers = supabase_headers(secret_key)

    tournaments = fetch_tournaments(
        game=args.game, format=args.format, page=args.page, limit=args.limit
    )
    rows = [to_row(t) for t in tournaments]

    # Deduplicate within the payload itself; PostgREST rejects a batch that
    # touches the same primary key twice.
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        print(f"deduplicated payload: {len(rows)} -> {len(by_id)} rows")
    rows = list(by_id.values())
    print(f"fetched {len(rows)} tournaments from Limitless")

    with httpx.Client(timeout=60.0) as client:
        before = count_rows(client, base, headers)
        print(f"{TABLE}: {before} rows before")

        if args.dry_run:
            print("dry run - nothing written")
            return 0

        for start in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[start : start + CHUNK_SIZE]
            upsert(client, base, headers, chunk)
            print(f"  upserted {start + len(chunk)}/{len(rows)}")

        after = count_rows(client, base, headers)
        print(f"{TABLE}: {after} rows after (+{after - before} new, "
              f"{len(rows) - (after - before)} updated in place)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
