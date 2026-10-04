"""Offline analyses of the metagame: archetypes, cycles and meta shifts.

Nothing here runs in the API or the scheduled workflow. It reads gold and
silver, models them in memory and writes a report; see
scripts/analyze_meta.py. Needs the `analysis` dependency group:

    uv run --group analysis python scripts/analyze_meta.py
"""
