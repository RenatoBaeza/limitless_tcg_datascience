-- Run once in the Supabase SQL editor. Safe to re-run.

-- Tracks which tournaments have had their pairings pulled, so the ingest loop
-- can skip ones already registered.
alter table public.tournaments
    add column if not exists pairings_ingested_at timestamptz,
    add column if not exists pairings_count       integer;

-- Partial index: the ingest job's "what's still pending" query.
create index if not exists tournaments_pairings_pending_idx
    on public.tournaments (date desc)
    where pairings_ingested_at is null;

create table if not exists public.pairings (
    -- sha1 of tournament_id|phase|round|match|table_number|player1.
    -- A surrogate key because `match` and `table_number` are both nullable and
    -- so cannot participate in a Postgres primary key; hashing them gives a
    -- deterministic id that makes re-ingesting idempotent.
    id            text        primary key,
    tournament_id text        not null references public.tournaments(id) on delete cascade,
    phase         integer     not null,
    round         integer     not null,
    match         text,        -- top-cut bracket slot ("T8-1"); null during swiss
    table_number  integer,     -- null for unpaired players and some top-cut rows
    player1       text        not null,
    player2       text,        -- null = bye or player left unpaired that round
    winner        text,        -- username of the winner; null when none recorded
    -- Raw non-name value the API returns in `winner` (observed: -1 and 0).
    -- Kept verbatim rather than interpreted: -1 appears both for unpaired
    -- players and for two-player matches with no winner, and 0 only for
    -- two-player matches. Exact semantics are not documented.
    result_code   integer,
    ingested_at   timestamptz not null default now()
);

create index if not exists pairings_tournament_idx on public.pairings (tournament_id);
create index if not exists pairings_player1_idx    on public.pairings (player1);
create index if not exists pairings_player2_idx    on public.pairings (player2);
create index if not exists pairings_winner_idx     on public.pairings (winner);

alter table public.pairings enable row level security;

drop policy if exists "pairings_public_read" on public.pairings;
create policy "pairings_public_read"
    on public.pairings
    for select
    to anon, authenticated
    using (true);
