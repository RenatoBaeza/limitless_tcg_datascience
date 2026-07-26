"""Rebuild the gold layer from silver.

Gold answers one question - how does each deck do against each other deck - and
gets its answer entirely from silver, so run it after refresh_silver.py, never
before. Like that one it is a full reconcile rather than an append, so
re-running only bumps refreshed_at.

Usage:
    uv run python scripts/refresh_gold.py [--dry-run]
    uv run python scripts/refresh_gold.py --only matchups
    uv run python scripts/refresh_gold.py --tournament <id>

See app/gold.py for the loop and sql/006_gold.sql for the transform.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import gold  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    gold.add_arguments(parser)
    return gold.run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
