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

`.github/workflows/ingest-tournaments.yml` runs this every 6 hours (`0 */6 * * *`
UTC) and can be triggered manually from the Actions tab. It needs `SUPABASE_URL`
and `SUPABASE_SECRET_KEY` set as repository secrets.

## Layout

```
app/
  main.py          # FastAPI app, health endpoint, router wiring
  models.py        # Pydantic schemas
  limitless.py     # play.limitlesstcg.com API client
  routers/
    decks.py       # /decks endpoints (in-memory store)
scripts/
  ingest_tournaments.py
sql/
  001_tournaments.sql
tests/
  test_main.py
```

The deck store in `app/routers/decks.py` is in-memory and resets on restart —
replace it with a real database when you outgrow it.
