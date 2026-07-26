# Limitless TCG metagame

Deck-versus-deck performance for the Pokémon TCG, built from
[play.limitlesstcg.com](https://play.limitlesstcg.com) tournament data.

```
server/   ingest pipeline + FastAPI read API   (Python 3.12, uv)   → server/README.md
client/   matchup matrix frontend              (Vite + React + TS) → client/README.md
```

## What it does

Every six hours a scheduled job pulls new tournaments, their pairings and their
standings into Supabase, then rebuilds two derived layers on top:

| Layer | Tables | Shape |
| --- | --- | --- |
| **bronze** | `bronze_tournaments`, `bronze_pairings`, `bronze_standings` | the API, mirrored verbatim |
| **silver** | `silver_tournaments`, `silver_standings`, `silver_pairings` | one row per real match, as winner/loser with decks joined in |
| **gold** | `gold_decks`, `gold_deck_events`, `gold_matchups` | one row per (event, deck, opponent deck) — the matrix, unsummed |

The frontend reads gold and nothing else. Roughly 2,000 tournaments and 130,000
head-to-head matches across ~200 archetypes.

## Getting started

Both halves need Supabase credentials in `server/.env`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=<service role key>
```

Apply `server/sql/*.sql` in order in the Supabase SQL editor — nothing in this
repo runs migrations. Then:

```bash
cd server && uv sync
uv run python scripts/ingest_tournaments.py     # then pairings, standings
uv run python scripts/refresh_silver.py
uv run python scripts/refresh_gold.py
uv run uvicorn app.main:app --reload            # API on :8000

cd ../client && npm install && npm run dev      # UI on :5173
```

## Reading the numbers

Two conventions run through the whole gold layer and the UI on top of it, and
both are easy to get wrong:

- **Ties are counted, not dropped.** About 6% of matches are draws. The headline
  `score_rate` counts a tie as half a win — `(wins + ties/2) / matches` — which
  is the match-points convention. `win_rate`, `wins / (wins + losses)`, is
  reported beside it because that is what most people mean by "win rate".
- **Mirrors are excluded.** A deck against itself is 50% by definition, so it
  is left out of every rate and counted separately as `mirror_matches`.

Every rate ships with its match count and a 95% Wilson interval. A matchup whose
interval still spans 50% is drawn with a dotted underline: the point estimate is
there, but the data cannot call it yet.
