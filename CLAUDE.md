# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Two projects, one repo. They share nothing but the HTTP contract between them.

```
server/    the ingest pipeline and the FastAPI service (Python, uv)
client/    the Vite + React frontend (TypeScript, npm)
```

Everything under `## Commands` runs from `server/` unless it says otherwise.

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

Silver and gold refreshes (both take `--dry-run`, `--tournament <id>`,
`--chunk-size N`, and a repeatable `--only <step>`):

```bash
uv run python scripts/refresh_silver.py
uv run python scripts/refresh_gold.py --only matchups
```

Deck sprite assets, written into `client/public/decks/` (`--dry-run`,
`--force`, `--out`, `--public-base`):

```bash
uv run python scripts/download_deck_sprites.py
```

Requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `server/.env` (repo
secrets in CI).

From `client/`:

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to the FastAPI service
npm run build      # tsc -b && vite build
```

## Architecture

### The medallion layers

The database is three layers, and which one you want is rarely ambiguous:

- **Bronze** (`bronze_tournaments`, `bronze_pairings`, `bronze_standings`) is a
  faithful mirror of the Limitless API, quirks intact. Only the ingest writes
  it. It is the layer to debug against and the only one that can be rebuilt
  solely by re-fetching.
- **Silver** (`silver_tournaments`, `silver_pairings`, plus the
  `silver_standings` *view*) is analysis-shaped: one row per real match,
  restated as winner/loser with each side's deck joined in. `silver_standings`
  is a view over `bronze_standings`, not a table — the transform was a
  column-for-column copy, so materialising it bought nothing and cost 118k
  duplicated rows (`sql/007_shrink.sql`).
- **Gold** (`gold_decks`, `gold_deck_events`, `gold_matchups`) is
  question-shaped. It exists to answer *how does each deck do against each
  other deck*, and it is what the frontend reads.

Silver and gold are both derived, so both are disposable — dropping and
rebuilding either loses nothing.

Each transform is **SQL, not Python**: `refresh_silver_*` in `sql/005_silver.sql`
and `refresh_gold_*` in `sql/006_gold.sql`. `app/silver.py` and `app/gold.py`
only drive them over PostgREST RPC, a batch of tournaments at a time. That split
is deliberate — `silver_pairings` alone is ~290k bronze rows joined twice
against standings, and pulling that through PostgREST to reshape it in Python
would spend minutes of transfer on work Postgres does in place in seconds.
Batching keeps any one statement inside the database's timeout; if a call ever
times out, lower `--chunk-size` rather than reaching for a different design.

Things about both refreshes that are easy to get wrong:

- **Order matters.** In silver, `silver_pairings` inner-joins
  `silver_tournaments`, so a tournament missing from it yields no pairings rows
  *silently*, not as a foreign-key error. In gold, `gold_decks` is a roll-up of
  the other two and must run after them. `silver.STEPS` and `gold.STEPS` encode
  the orders — silver has no standings step, since the view cannot fall behind.
- **They re-read their whole source every run**, not just what is new. A
  pairing's deck columns come from a standings ingest that usually lands
  *after* the pairing did, so an incremental-by-timestamp refresh would leave
  decks permanently null.
- **Each function is a full reconcile of its slice**, deleting rows that no
  longer qualify before upserting the rest. Re-running is a no-op beyond
  `refreshed_at`.

### The ingest pipeline

`scripts/*.py` are thin `argparse` shims; the real loop is `app/ingest.py:run()`,
a generic driver parameterized by `(resource, table, row_mapper, on_conflict,
key)`. It handles budgeting, pacing, resume-on-restart and per-tournament fault
isolation once for both pairings and standings. `app/limitless.py` is the
Limitless API client plus all row mapping; `app/supabase.py` is a thin PostgREST
layer where every request goes through `_send` (retries timeouts, transport
errors and 5xx/408/429; a 4xx is surfaced immediately as a real bug).

### The FastAPI service

`app/routers/meta.py` is the read API and is deliberately thin: it validates a
query string and hands off to `app/metagame.py`, which calls the matching gold
function. Four endpoints, one per gold read function:

```
GET /coverage                     date bounds and totals
GET /decks                        deck list with meta share and record
GET /decks/{deck_id}/matchups     one deck against the whole field
GET /matchups                     the matrix, as a flat list of cells
```

All of them take the same `?from=&to=` window plus `include_other`. Results are
memoed for 5 minutes in `metagame._cached` — gold only changes every six hours,
so the memo costs nothing and makes filter-flipping instant.

`app/routers/admin.py` exposes `GET /admin/ingest/{secret}` — the secret in the
URL selects which job runs (`ADMIN_KEY_PAIRINGS` / `ADMIN_KEY_STANDINGS` /
`ADMIN_KEY_SILVER` / `ADMIN_KEY_GOLD` env vars) and dispatches it to a FastAPI
background task, since an ingest run takes ~30 minutes.

### What silver decides

Documented at the top of `sql/005_silver.sql`. The judgement calls worth knowing
here: `silver_pairings` drops every row with no `player2` (byes and unpaired
players alike — neither is a match with a loser to name), restates
`player1`/`player2`/`winner` as `winner`/`loser`, and sets `is_tie` when bronze
recorded no winner. On tie rows `winner`/`loser` hold `player1`/`player2` in
that order so both decks stay queryable, so **filter on `is_tie` before
computing win rates**.

### What gold decides

Documented at the top of `sql/006_gold.sql`. `gold_matchups` is the fact table,
one row per `(tournament_id, deck_a, deck_b)`. Five decisions everything
downstream depends on:

- **Every match is counted twice**, once from each side, so the matrix is
  antisymmetric by construction and a deck's whole record is one row-slice.
  `gold_coverage` halves the total to report distinct matches.
- **Ties are their own column**, never folded into either side. Two rates come
  out of that: `win_rate` = wins/(wins+losses), and `score_rate` =
  (wins + ties/2)/matches. Ties are ~6% of matches, so they genuinely differ.
  `score_rate` is the headline; `win_rate` exists because it is what most
  people mean by "win rate" and hiding it invites someone to recompute it
  wrongly.
- **Mirrors are excluded.** A deck against itself is 50% by definition and the
  two-perspective fan-out would land a win and a loss in the same cell. The
  count lives on `gold_decks.mirror_matches` instead, so a frontend can still
  label the diagonal.
- **Both decks must be known.** ~4% of `silver_pairings` rows still have a null
  deck on one side; a matchup against "unknown" is not a matchup.
- **`deck_id = 'other'`** is Limitless's catch-all for unclassified lists, not
  an archetype. It is flagged `gold_decks.is_other` and every read function
  excludes it unless asked.

The grain is the *tournament*, not an all-time sum, because an all-time matrix
cannot be filtered and matchups shift with every set release. Read functions
(`gold_matchup_matrix`, `gold_deck_matchups`, `gold_deck_summary`) sum it over
whatever window they are given, and each returns a 95% Wilson interval beside
every rate — a 3-match cell at 100% and a 300-match cell at 55% are not the same
claim, and the interval is what stops them being drawn as if they were.

### Deck sprites

`scripts/download_deck_sprites.py` builds `client/public/decks/`: one composited
PNG per deck plus the individual Pokemon sprites and an `index.json`. Files are
keyed on `deck_id`, not `deck_name` — names are not unique (two unrelated decks
are both "Alakazam"), and `deck_id` is what `silver_pairings` and `gold_matchups`
carry. The deck-to-sprite mapping comes from `silver_standings.deck_icons`, so
nothing is scraped or name-matched; only the images themselves are fetched, from
the same CDN limitlesstcg.com uses. See `app/sprites.py`.

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
statement. That is also why `sql/005_silver.sql` and `sql/006_gold.sql` carry no
comments *inside* their function bodies.

Since nothing runs the migrations, there is no schema test either. Syntax-check
edits before pasting them in:

```bash
uv run --with pglast python -c "import pglast,sys; pglast.parse_sql(open(sys.argv[1]).read())" sql/006_gold.sql
```

That parses the outer statements but treats each `$fn$ ... $fn$` body as an
opaque string, so it will not catch a typo inside a function. `pglast.parse_sql`
on a `language sql` body and `pglast.parse_plpgsql` on a plpgsql one do.

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
- The silver and gold refreshes are *not* subject to this. They talk only to
  Supabase and the work happens inside Postgres, so they cost a minute, not
  thirty.

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
  self-healing. `silver.run()` and `gold.run()` apply the same tolerance to
  failed batches.

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

## The client

Vite + React + TypeScript, three runtime dependencies (react, react-dom,
`@tanstack/react-query`). No component library and no charting library: the one
real chart is a matchup heatmap, which is a `<table>` of coloured cells, and a
library would cost more than it saved.

- `src/api.ts` types the four endpoints. Base URL is `/api` in dev, which
  `vite.config.ts` proxies to the FastAPI service so the browser stays on one
  origin; set `VITE_API_URL` to point at a deployed API instead.
- `src/scale.ts` is the diverging colour scale, and it is the file to read
  before changing any colour. Blue is favourable, red unfavourable, neutral
  gray at 50%, saturating at 25%/75% because real matchups between decks anyone
  plays live between roughly 35% and 65%. The stops mirror the design system's
  blue ramp step for step in OKLCH lightness and were validated (monotone
  lightness, adjacent ΔL ≥ 0.06, single hue per arm). It is deliberately *not*
  green/red: those two collapse under the most common colour blindness, which
  is exactly what a matchup chart cannot afford. Dark mode is a separate set of
  stops, not an inversion — on a dark surface the neutral end has to recede
  toward the surface, which is the opposite direction of travel.
- Filters live in one row above everything they scope, and every panel reads
  the same window, so the numbers on screen always agree. Date presets count
  back from the last event in the data rather than from today: results land
  days after an event happens, so "last 30 days" from today's date would
  quietly clip the most recent weekend.
- Every rate is drawn with its match count and Wilson interval reachable, and
  the matrix has a table-view twin, so nothing is encoded by colour alone.

## Conventions

- The HTTP library is `httpx2`, imported as `import httpx2 as httpx` throughout.
- Scripts prepend `server/` to `sys.path` before importing `app`, hence the
  `# noqa: E402` on those imports.
- Tests use hand-rolled `FakeClient`/`FakeResponse` fakes (see
  `tests/test_resilience.py`) and monkeypatch `time.sleep` away rather than
  mocking libraries.
- `.github/workflows/ingest-tournaments.yml` runs all three ingests every 6
  hours, then the silver refresh, then the gold refresh, and is manually
  dispatchable with `dry_run` / `max_requests` inputs. Its steps all run with
  `working-directory: server`. The silver and gold steps are skipped on a dry
  run, since there would be nothing new to derive from.
