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

-- Note: keep semicolons out of comments in this file. The Supabase SQL editor
-- splits statements on semicolons without regard for comments, so one inside a
-- comment truncates the statement and produces a syntax error on the next line.
--
-- Column notes, kept out of the table body for the same reason:
--   id            sha1 of tournament_id|phase|round|match|table_number|player1.
--                 A surrogate key because match and table_number are both
--                 nullable and so cannot participate in a Postgres primary
--                 key. Hashing them gives a deterministic id, which is what
--                 makes re-ingesting idempotent.
--   match         top-cut bracket slot such as "T8-1", null during swiss
--   table_number  null for unpaired players and some top-cut rows
--   player2       null for a bye, or a player left unpaired that round
--   winner        username of the winner, null when none was recorded
--   result_code   raw non-name value the API returns in winner (observed -1
--                 and 0). Kept verbatim rather than interpreted, because -1
--                 appears both for unpaired players and for two-player matches
--                 with no winner, while 0 appears only for two-player matches.
--                 The exact semantics are not documented.

create table if not exists public.pairings (
    id            text        primary key,
    tournament_id text        not null references public.tournaments(id) on delete cascade,
    phase         integer     not null,
    round         integer     not null,
    match         text,
    table_number  integer,
    player1       text        not null,
    player2       text,
    winner        text,
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
