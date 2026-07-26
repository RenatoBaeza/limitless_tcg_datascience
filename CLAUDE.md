# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
uv sync                                    # install deps (Python 3.12, uv-managed)
uv run pytest                              # all tests
uv run pytest tests/test_limitless.py      # one file
uv run pytest tests/test_resilience.py::test_send_retries_transient_5xx   # one test
uv run uvicorn app.main:app --reload       # API on 127.0.0.1:8000, docs at /docs
```

Ingest scripts (all take `--dry-run`; the per-tournament ones also take
`--max-requests N`, `--tournament <id>`, `--restale-hours N`):

```bash
uv run python scripts/ingest_tournaments.py --dry-run
uv run python scripts/ingest_pairings.py --max-requests 400
uv run python scripts/ingest_standings.py --tournament <id>
```

Silver refresh (`--dry-run`, `--tournament <id>`, `--chunk-size N`, and
`--only tournaments|standings|pairings`, repeatable):

```bash
uv run python scripts/refresh_silver.py
uv run python scripts/refresh_silver.py --only pairings
```

Requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env` (repo secrets in CI).

## Architecture

Two loosely-coupled halves share `app/`:

**The ingest pipeline** is the substance of the repo. `scripts/*.py` are thin
`argparse` shims; the real loop is `app/ingest.py:run()`, a generic driver
parameterized by `(resource, table, row_mapper, on_conflict, key)`. It handles
budgeting, pacing, resume-on-restart and per-tournament fault isolation once for
both pairings and standings. `app/limitless.py` is the Limitless API client plus
all row mapping; `app/supabase.py` is a thin PostgREST layer where every request
goes through `_send` (retries timeouts, transport errors and 5xx/408/429; a 4xx
is surfaced immediately as a real bug).

**The FastAPI service** (`app/main.py`, `app/routers/`) is comparatively thin.
`decks.py` is an in-memory placeholder store that resets on restart. `admin.py`
exposes `GET /admin/ingest/{secret}` — the secret in the URL selects which job
runs (`ADMIN_KEY_PAIRINGS` / `ADMIN_KEY_STANDINGS` / `ADMIN_KEY_SILVER` env
vars) and dispatches it to a FastAPI background task, since an ingest run takes
~30 minutes.

### Bronze and silver

The database is two layers, and which one you want is rarely ambiguous:

- **Bronze** (`bronze_tournaments`, `bronze_pairings`, `bronze_standings`) is a
  faithful mirror of the Limitless API, quirks intact. Only the ingest writes
  it. It is the layer to debug against and the only one that can be rebuilt
  solely by re-fetching.
- **Silver** (`silver_tournaments`, `silver_standings`, `silver_pairings`) is
  analysis-shaped and is what queries should target. It is derived, so it is
  disposable — dropping and rebuilding it loses nothing.

The transform is **SQL, not Python**: three `refresh_silver_*(p_tournaments
text[])` functions in `sql/005_silver.sql`. `app/silver.py` only drives them
over PostgREST RPC, handing over a batch of tournaments at a time. That split is
deliberate — `silver_pairings` is ~290k bronze rows joined twice against
standings, and pulling that through PostgREST to reshape it in Python would
spend minutes of transfer on work Postgres does in place in seconds. Batching
keeps any one statement inside the database's timeout; if a call ever times out,
lower `--chunk-size` rather than reaching for a different design.

Three things about the refresh that are easy to get wrong:

- **Order matters.** Both child tables inner-join `silver_tournaments`, so a
  tournament missing from it yields no standings or pairings rows *silently*,
  not as a foreign-key error. `silver.STEPS` encodes the order.
- **It re-reads all of bronze every run**, not just what is new. A pairing's
  deck columns come from a standings ingest that usually lands *after* the
  pairing did, so an incremental-by-timestamp refresh would leave decks
  permanently null.
- **Each function is a full reconcile of its slice**, deleting rows that no
  longer qualify before upserting the rest. Re-running is a no-op beyond
  `refreshed_at`.

What silver changes, and why, is documented at the top of `sql/005_silver.sql`.
The judgement calls worth knowing here: `silver_pairings` drops every row with
no `player2` (byes and unpaired players alike — neither is a match with a loser
to name), restates `player1`/`player2`/`winner` as `winner`/`loser`, and sets
`is_tie` when bronze recorded no winner. On tie rows `winner`/`loser` hold
`player1`/`player2` in that order so both decks stay queryable, so **filter on
`is_tie` before computing win rates**.

### Adding a new per-tournament resource

The driver couples column names to the *resource* by convention: `app/ingest.py`
derives `{resource}_ingested_at` and `{resource}_count` and writes both on
`bronze_tournaments`. (Derived from the resource, not the table, so the progress
columns kept their bare names when the tables gained the `bronze_` prefix.) So a
new resource needs, in order:

1. A `sql/00N_<resource>.sql` migration adding those two columns to
   `bronze_tournaments`, the partial index on
   `... where <resource>_ingested_at is null`, and the `bronze_<resource>` table.
2. A `to_<resource>_row(tournament_id, item)` mapper in `app/limitless.py`.
3. A ~15-line `scripts/ingest_<resource>.py` calling `ingest.run(...)`.
4. Optionally a silver counterpart: a table, a `refresh_silver_<resource>`
   function alongside the others, and its name added to `silver.STEPS`.

**SQL migrations are applied by hand** in the Supabase SQL editor — nothing in
this repo runs them. They are written to be idempotent and re-runnable. Keep
semicolons out of SQL comments: the Supabase editor splits statements on
semicolons without regard for comments, so one inside a comment truncates the
statement. That is also why `sql/005_silver.sql` carries no comments *inside*
its function bodies.

Since nothing runs the migrations, there is no schema test either. Syntax-check
edits before pasting them in:

```bash
uv run --with pglast python -c "import pglast,sys; pglast.parse_sql(open(sys.argv[1]).read())" sql/005_silver.sql
```

### Rate limiting is the dominant constraint

The Limitless API allows **50 requests / 5 minutes per IP, shared across the
whole API**. `RATE_LIMIT_INTERVAL` (~6.2s) is the pacing budget, and
`ingest.run` sleeps it between every tournament. Consequences that are easy to
break accidentally:

- Never run two per-tournament ingests concurrently — the GitHub workflow steps
  are deliberately sequential for this reason, and the `concurrency` group stops
  overlapping workflow runs.
- A full backfill of ~2000 tournaments is hours of wall time spread over many
  runs, which is why every run is bounded and resumable.

### Idempotency and resumption

Everything is designed to be re-run safely:

- All writes are PostgREST upserts. `ingest.run` also collapses duplicate keys
  *within* one payload, because PostgREST rejects a batch touching the same key
  twice — that's what the `key` callable is for.
- `bronze_pairings.id` is a sha1 of
  `tournament_id|phase|round|match|table_number|player1` (see
  `limitless.pairing_id`), a surrogate key because `match` and `table_number`
  are nullable and can't be part of a Postgres PK. Changing that hash recipe
  orphans every existing row, in silver as well as bronze — `silver_pairings`
  carries the same id. `bronze_standings` needs no surrogate:
  `(tournament_id, player)` is naturally unique.
- Progress lives in `bronze_tournaments.<resource>_ingested_at`. Anything from the last
  `--restale-hours` (default 48) is re-fetched even once ingested, so a
  tournament captured mid-event doesn't keep partial data forever.
- One failing tournament is caught and skipped, leaving its progress column
  null so the next run retries it. `run()` returns exit 1 only when more than
  10% of a run's tournaments failed — occasional failures are expected and
  self-healing. `silver.run()` applies the same tolerance to failed batches.

### API payload quirks worth knowing before touching the mappers

- `pairings.winner` is a union: usually a username, sometimes the bare integer
  `-1` or `0`. Split into `winner` (text) and `result_code` (int); `-1` appears
  for both unpaired players and two-player matches, so it is stored verbatim
  rather than interpreted as a draw.
- `pairings.match` is a top-cut bracket slot (`"T8-1"`), absent during swiss —
  top-cut rows share a round number and have no table, so `match` is what
  distinguishes them. `table` and `player2` are both nullable.
- `standings.deck` is occasionally an empty object, and `placing`, `country`,
  `drop` are all nullable, so `to_standing_row` reads everything defensively.
  The API's `placing` is stored as `placement`.
- **`standings.decklist` is deliberately dropped** in `to_standing_row` — it is
  ~2 orders of magnitude larger than the rest of the payload and nothing here
  depends on it. Don't "restore" it without a concrete consumer.

## Conventions

- The HTTP library is `httpx2`, imported as `import httpx2 as httpx` throughout.
- Scripts prepend the repo root to `sys.path` before importing `app`, hence the
  `# noqa: E402` on those imports.
- Tests use hand-rolled `FakeClient`/`FakeResponse` fakes (see
  `tests/test_resilience.py`) and monkeypatch `time.sleep` away rather than
  mocking libraries.
- `.github/workflows/ingest-tournaments.yml` runs all three ingests every 6
  hours, then the silver refresh, and is manually dispatchable with `dry_run` /
  `max_requests` inputs. The silver step is skipped on a dry run, since there
  would be nothing new to derive from.
