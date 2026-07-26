"""Download the deck sprites Limitless shows on https://limitlesstcg.com/decks.

Writes one PNG per deck into ../client/public/decks/, named by the deck_id that
silver_pairings carries, plus an index.json mapping ids to display names. See
app/sprites.py for why files are keyed on the id rather than the name.

Cheap to re-run: sprites already on disk are left alone unless --force.

Usage:
    uv run python scripts/download_deck_sprites.py [--dry-run]
    uv run python scripts/download_deck_sprites.py --force
    uv run python scripts/download_deck_sprites.py --out some/other/dir
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import sprites  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    sprites.add_arguments(parser)
    return sprites.run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
