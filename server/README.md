# Limitless TCG server

The ingest pipeline and the read API. The frontend that consumes it lives in
`../client`.

## Setup

```bash
uv sync
```

## Run

```bash
uv run uvicorn app.main:app --reload
```

- API: http://127.0.0.1:8000
- Interactive docs: http://127.0.0.1:8000/docs
- OpenAPI schema: http://127.0.0.1:8000/openapi.json

## Test

```bash
uv run pytest
```

## Tournament ingest

Pulls tournaments from `play.limitlesstcg.com` into the Supabase
`public.tournaments` table. Requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
in `.env` (see `sql/001_tournaments.sql` for the schema).

```bash
uv run python scripts/ingest_tournaments.py --dry-run   # report only
uv run python scripts/ingest_tournaments.py             # upsert
```

Rows are upserted on the `id` primary key, so re-running refreshes existing
rows rather than duplicating them. `ingested_at` is preserved on update, so it
records when a tournament first appeared.

## Pairings ingest

Pulls round-by-round pairings for tournaments that don't have them yet.

```bash
uv run python scripts/ingest_pairings.py --dry-run
uv run python scripts/ingest_pairings.py --max-requests 400
uv run python scripts/ingest_pairings.py --tournament <id>
```

The Limitless API rate limits to **50 requests per 5 minutes**, so the script
paces itself at ~6.2s per tournament and works a bounded batch per run.
Progress is recorded on `tournaments.pairings_ingested_at`, so consecutive runs
resume rather than restart. A full backfill of 2000 tournaments needs roughly
3.3 hours of wall time spread over several runs.

Tournaments from the last 48 hours (`--restale-hours`) are re-fetched even once
ingested, because an event ingested while still running would otherwise keep
its partial pairings permanently.

### Pairing data quirks

The endpoint returns more shapes than its happy path suggests:

| Field | Notes |
| --- | --- |
| `match` | Top-cut bracket slot (`"T8-1"`). Absent during swiss. Top-cut rows share one round number and have no table, so this is what separates them. |
| `table` | Null for unpaired players and some top-cut rows. |
| `player2` | Null for a bye, or a player left unpaired that round. |
| `winner` | Usually the winner's username, but sometimes the integer `-1` or `0`. |

Because `winner` is a union type, it is stored as `winner` (text, null when the
API gave an integer) plus `result_code` (the raw integer). `-1` appears both for
unpaired players and for two-player matches, so it is stored verbatim rather
than interpreted as a draw.

Since `match` and `table_number` are nullable they cannot form a Postgres
primary key, so `pairings.id` is a sha1 of
`tournament_id|phase|round|match|table_number|player1` — deterministic, which is
what makes re-ingesting idempotent.

## Standings ingest

Final placements, records and deck archetypes per player.

```bash
uv run python scripts/ingest_standings.py --dry-run
uv run python scripts/ingest_standings.py --max-requests 300
uv run python scripts/ingest_standings.py --tournament <id>
```

Same driver as the pairings ingest (`app/ingest.py`): rate-limit paced, bounded
per run, resumable via `tournaments.standings_ingested_at`.

The API returns a full `decklist` per player - every card, count, set and
number. It is **not** stored: it is roughly two orders of magnitude larger than
the rest of the payload and nothing else here depends on it. `app/limitless.py`
drops it in `to_standing_row`, so it never reaches the database.

`deck` and `record` are flattened into `deck_id` / `deck_name` / `deck_icons`
and `wins` / `losses` / `ties`. `deck` is occasionally an empty object, and
`placing`, `country` and `drop` are all nullable, so every one is read
defensively. The API's `placing` is stored as `placement`. Unlike pairings, `player` is unique within a tournament, so
`(tournament_id, player)` is the primary key and no surrogate hash is needed.

## Silver and gold

Two derived layers sit on bronze, both rebuilt by SQL functions this repo only
*calls* — see `sql/005_silver.sql` and `sql/006_gold.sql` for the transforms
and the reasoning behind them.

```bash
uv run python scripts/refresh_silver.py     # bronze -> silver
uv run python scripts/refresh_gold.py       # silver -> gold
```

Both are full reconciles rather than appends, so re-running is a no-op beyond
`refreshed_at`, and both take `--dry-run`, `--tournament <id>`, `--chunk-size N`
and a repeatable `--only <step>`. Run them in that order: gold reads silver, and
silver reads bronze.

**Silver** is one row per real match, restated as winner/loser with each side's
deck joined in from standings. **Gold** is one row per
`(tournament, deck, opponent deck)` — the matchup matrix at event grain, so any
date range can be summed out of it on demand.

The gold decisions that matter downstream: every match is counted from both
sides, ties are their own column rather than folded into either, mirrors are
excluded (50% by definition), a match needs both decks known to count, and
`deck_id = 'other'` is a catch-all bucket rather than an archetype. The header
of `sql/006_gold.sql` explains each.

## Read API

Four endpoints, one per gold read function. All take `?from=&to=` and
`include_other`.

```
GET /coverage                     date bounds and totals
GET /decks                        deck list with meta share and record
GET /decks/{deck_id}/matchups     one deck against the whole field
GET /matchups                     the matrix, as a flat list of cells
```

Every rate comes back as `score_rate` (ties count half), `win_rate` (ties
excluded) and a 95% Wilson interval, beside the raw `wins`/`losses`/`ties`.
Results are memoed for five minutes, since gold only changes every six hours.

Set `CLIENT_ORIGINS` to the frontend's origin in production; it defaults to the
Vite dev server.

## Deck sprites

```bash
uv run python scripts/download_deck_sprites.py
```

Writes `../client/public/decks/`: one composited PNG per deck, the individual
Pokémon sprites, and an `index.json`. Keyed on `deck_id` rather than deck name,
since names are not unique and `deck_id` is what the pairing rows carry.

## Scheduled job

`.github/workflows/ingest-tournaments.yml` runs the three ingests every 6 hours
(`0 */6 * * *` UTC), then the silver and gold refreshes, and can be triggered
manually from the Actions tab. It needs `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` set as repository secrets.

`GET /admin/ingest/{secret}` triggers the same jobs from anywhere that can
issue a GET. Which secret matches picks the job — `ADMIN_KEY_PAIRINGS`,
`ADMIN_KEY_STANDINGS`, `ADMIN_KEY_SILVER`, `ADMIN_KEY_GOLD`.

## Layout

```
app/
  main.py          # FastAPI app, CORS, router wiring
  models.py        # Pydantic response schemas
  limitless.py     # play.limitlesstcg.com API client + row mapping
  supabase.py      # PostgREST helpers, with retries
  ingest.py        # shared per-tournament ingest loop
  silver.py        # bronze -> silver refresh driver
  gold.py          # silver -> gold refresh driver
  metagame.py      # gold read side: client, cache, four RPC calls
  sprites.py       # deck image assets for the frontend
  routers/
    meta.py        # the read endpoints
    admin.py       # secret-gated job trigger
scripts/           # thin argparse shims over the modules above
sql/               # migrations, applied by hand in the Supabase SQL editor
tests/
```
