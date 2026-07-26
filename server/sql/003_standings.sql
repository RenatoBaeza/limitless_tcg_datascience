-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Note: keep semicolons out of comments in this file. The Supabase SQL editor
-- splits statements on semicolons without regard for comments, so one inside a
-- comment truncates the statement and produces a syntax error on the line after.
--
-- Column notes, kept out of the table body for the same reason:
--   country     ISO-2 country code, null for roughly 9% of entries
--   placement   the API calls this "placing". Null for players with no final
--               placement, and not unique (251 ties in a 3.4k-row sample) so
--               it cannot be the key.
--   drop_round  round the player dropped, null if they stayed in
--   deck_id     archetype slug such as "dragapult-blaziken"
--   deck_icons  up to 2 archetype icons
--
-- The API also returns a full decklist per player. It is deliberately not
-- stored: it is roughly two orders of magnitude more data than everything
-- else here, and nothing above depends on it.

alter table public.tournaments
    add column if not exists standings_ingested_at timestamptz,
    add column if not exists standings_count       integer;

create index if not exists tournaments_standings_pending_idx
    on public.tournaments (date desc)
    where standings_ingested_at is null;

create table if not exists public.standings (
    tournament_id text        not null references public.tournaments(id) on delete cascade,
    player        text        not null,
    name          text,
    country       text,
    placement     integer,
    wins          integer,
    losses        integer,
    ties          integer,
    drop_round    integer,
    deck_id       text,
    deck_name     text,
    deck_icons    text[],
    ingested_at   timestamptz not null default now(),
    primary key (tournament_id, player)
);

create index if not exists standings_player_idx  on public.standings (player);
create index if not exists standings_deck_idx    on public.standings (deck_id);
create index if not exists standings_placement_idx on public.standings (tournament_id, placement);

alter table public.standings enable row level security;

drop policy if exists "standings_public_read" on public.standings;

create policy "standings_public_read"
    on public.standings
    for select
    to anon, authenticated
    using (true);
