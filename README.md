# Limitless TCG API

FastAPI service for Limitless TCG data.

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

## Scheduled job

`.github/workflows/ingest-tournaments.yml` runs both ingests every 6 hours
(`0 */6 * * *` UTC) and can be triggered manually from the Actions tab. It needs
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` set as repository secrets.

## Layout

```
app/
  main.py          # FastAPI app, health endpoint, router wiring
  models.py        # Pydantic schemas
  limitless.py     # play.limitlesstcg.com API client + row mapping
  supabase.py      # PostgREST helpers, with retries
  ingest.py        # shared per-tournament ingest loop
  routers/
    decks.py       # /decks endpoints (in-memory store)
scripts/
  ingest_tournaments.py
  ingest_pairings.py
  ingest_standings.py
sql/
  001_tournaments.sql
  002_pairings.sql
  003_standings.sql
tests/
  test_main.py
  test_limitless.py
  test_resilience.py
```

The deck store in `app/routers/decks.py` is in-memory and resets on restart —
replace it with a real database when you outgrow it.
