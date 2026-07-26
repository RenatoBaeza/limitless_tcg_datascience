-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The silver layer: analysis-shaped tables derived from bronze. Bronze stays a
-- faithful mirror of the Limitless API, warts and all. Silver is what queries
-- should actually target.
--
-- Note: keep semicolons out of comments in this file. The Supabase SQL editor
-- splits statements on semicolons without regard for comments, so one inside a
-- comment truncates the statement. That is also why the function bodies below
-- carry no inline comments - their explanations live in this header instead.
--
-- What each table changes relative to its bronze source:
--
--   silver_tournaments  drops game and format (every row is PTCG/STANDARD, so
--                       they carry no information), narrows date from
--                       timestamptz to a date, and adds country - the most
--                       common country among the tournament's players, read
--                       off bronze_standings. Null until standings land, and
--                       null for events where every player's country is null.
--
--   silver_standings    a straight copy. The bronze shape was already right.
--
--   silver_pairings     one row per actual head-to-head match, restated as
--                       winner/loser instead of player1/player2/winner, with
--                       each side's deck joined in from standings.
--
-- The pairings reshaping, in detail, because it is where the judgement calls
-- are:
--
--   * Rows with no player2 are dropped. That covers byes (winner is player1)
--     and unpaired players (winner is null, result_code -1). Neither is a
--     match, and neither has a loser to name.
--   * When bronze winner is a username, it is the winner and the other player
--     is the loser. Verified against a 6k-row sample: winner is always one of
--     player1/player2, never a third name.
--   * When bronze winner is null, both players were recorded without a result.
--     is_tie is set, and player1/player2 fill winner/loser in that order so
--     both sides and both decks stay queryable. The labels are meaningless on
--     those rows - filter on is_tie before computing win rates.
--   * result_code is not carried over. It only ever distinguished flavours of
--     "no winner", which is_tie already captures.
--
--   * Decks come from bronze_standings on (tournament_id, player), which is
--     that table's primary key, so the join cannot multiply rows. They are
--     null for tournaments whose standings have not been ingested yet, and
--     for events where Limitless recorded no decklists. A later refresh fills
--     them in - that is why the transform re-reads all of bronze rather than
--     only rows newer than the last run.

create table if not exists public.silver_tournaments (
    id           text primary key,
    name         text        not null,
    date         date        not null,
    players      integer     not null,
    organizer_id integer,
    country      text,
    refreshed_at timestamptz not null default now()
);

create index if not exists silver_tournaments_date_idx    on public.silver_tournaments (date desc);
create index if not exists silver_tournaments_country_idx on public.silver_tournaments (country);

create table if not exists public.silver_standings (
    tournament_id text        not null references public.silver_tournaments(id) on delete cascade,
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
    refreshed_at  timestamptz not null default now(),
    primary key (tournament_id, player)
);

create index if not exists silver_standings_player_idx    on public.silver_standings (player);
create index if not exists silver_standings_deck_idx      on public.silver_standings (deck_id);
create index if not exists silver_standings_placement_idx on public.silver_standings (tournament_id, placement);

-- id is carried over from bronze_pairings unchanged, so a silver row keeps
-- pointing at the bronze row it came from.
create table if not exists public.silver_pairings (
    id               text        primary key,
    tournament_id    text        not null references public.silver_tournaments(id) on delete cascade,
    phase            integer     not null,
    round            integer     not null,
    winner           text        not null,
    loser            text        not null,
    winner_deck_id   text,
    winner_deck_name text,
    loser_deck_id    text,
    loser_deck_name  text,
    is_tie           boolean     not null,
    refreshed_at     timestamptz not null default now()
);

create index if not exists silver_pairings_tournament_idx  on public.silver_pairings (tournament_id);
create index if not exists silver_pairings_winner_idx      on public.silver_pairings (winner);
create index if not exists silver_pairings_loser_idx       on public.silver_pairings (loser);
create index if not exists silver_pairings_winner_deck_idx on public.silver_pairings (winner_deck_id);
create index if not exists silver_pairings_loser_deck_idx  on public.silver_pairings (loser_deck_id);
create index if not exists silver_pairings_matchup_idx     on public.silver_pairings (winner_deck_id, loser_deck_id) where is_tie is false;

alter table public.silver_tournaments enable row level security;
alter table public.silver_standings   enable row level security;
alter table public.silver_pairings    enable row level security;

drop policy if exists "silver_tournaments_public_read" on public.silver_tournaments;
create policy "silver_tournaments_public_read"
    on public.silver_tournaments
    for select
    to anon, authenticated
    using (true);

drop policy if exists "silver_standings_public_read" on public.silver_standings;
create policy "silver_standings_public_read"
    on public.silver_standings
    for select
    to anon, authenticated
    using (true);

drop policy if exists "silver_pairings_public_read" on public.silver_pairings;
create policy "silver_pairings_public_read"
    on public.silver_pairings
    for select
    to anon, authenticated
    using (true);

-- The transform itself.
--
-- Each function takes an optional array of tournament ids and refreshes only
-- those, so app/silver.py can submit the ~2k tournaments in batches instead of
-- betting one statement against the database's timeout. Passing null refreshes
-- everything, which is what a psql session would want.
--
-- Each is a full reconcile of its slice, not an append: rows that no longer
-- qualify are deleted first, then every surviving row is upserted. Running any
-- of them twice is therefore a no-op beyond bumping refreshed_at. They return
-- the number of rows the upsert touched.
--
-- Ordering matters when calling them: both child tables carry a foreign key
-- onto silver_tournaments and inner-join it, so tournaments must go first or
-- the children silently produce nothing for a tournament silver has not seen.

create or replace function public.refresh_silver_tournaments(p_tournaments text[] default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.silver_tournaments s
    where (p_tournaments is null or s.id = any(p_tournaments))
      and not exists (
          select 1 from public.bronze_tournaments b where b.id = s.id
      );

    insert into public.silver_tournaments
        (id, name, date, players, organizer_id, country, refreshed_at)
    select t.id,
           t.name,
           (t.date at time zone 'utc')::date,
           t.players,
           t.organizer_id,
           c.country,
           now()
    from public.bronze_tournaments t
    left join lateral (
        select st.country
        from public.bronze_standings st
        where st.tournament_id = t.id
          and st.country is not null
        group by st.country
        order by count(*) desc, st.country
        limit 1
    ) c on true
    where p_tournaments is null or t.id = any(p_tournaments)
    on conflict (id) do update set
        name         = excluded.name,
        date         = excluded.date,
        players      = excluded.players,
        organizer_id = excluded.organizer_id,
        country      = excluded.country,
        refreshed_at = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

create or replace function public.refresh_silver_standings(p_tournaments text[] default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.silver_standings s
    where (p_tournaments is null or s.tournament_id = any(p_tournaments))
      and not exists (
          select 1 from public.bronze_standings b
          where b.tournament_id = s.tournament_id
            and b.player = s.player
      );

    insert into public.silver_standings
        (tournament_id, player, name, country, placement, wins, losses, ties,
         drop_round, deck_id, deck_name, deck_icons, refreshed_at)
    select b.tournament_id,
           b.player,
           b.name,
           b.country,
           b.placement,
           b.wins,
           b.losses,
           b.ties,
           b.drop_round,
           b.deck_id,
           b.deck_name,
           b.deck_icons,
           now()
    from public.bronze_standings b
    join public.silver_tournaments t on t.id = b.tournament_id
    where p_tournaments is null or b.tournament_id = any(p_tournaments)
    on conflict (tournament_id, player) do update set
        name         = excluded.name,
        country      = excluded.country,
        placement    = excluded.placement,
        wins         = excluded.wins,
        losses       = excluded.losses,
        ties         = excluded.ties,
        drop_round   = excluded.drop_round,
        deck_id      = excluded.deck_id,
        deck_name    = excluded.deck_name,
        deck_icons   = excluded.deck_icons,
        refreshed_at = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

create or replace function public.refresh_silver_pairings(p_tournaments text[] default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.silver_pairings s
    where (p_tournaments is null or s.tournament_id = any(p_tournaments))
      and not exists (
          select 1 from public.bronze_pairings b
          where b.id = s.id
            and b.player2 is not null
      );

    insert into public.silver_pairings
        (id, tournament_id, phase, round, winner, loser,
         winner_deck_id, winner_deck_name, loser_deck_id, loser_deck_name,
         is_tie, refreshed_at)
    select m.id,
           m.tournament_id,
           m.phase,
           m.round,
           m.winner,
           m.loser,
           w.deck_id,
           w.deck_name,
           l.deck_id,
           l.deck_name,
           m.is_tie,
           now()
    from (
        select b.id,
               b.tournament_id,
               b.phase,
               b.round,
               coalesce(b.winner, b.player1) as winner,
               case when b.winner is null          then b.player2
                    when b.winner = b.player1      then b.player2
                    when b.winner = b.player2      then b.player1
               end                            as loser,
               (b.winner is null)             as is_tie
        from public.bronze_pairings b
        where b.player2 is not null
          and (p_tournaments is null or b.tournament_id = any(p_tournaments))
    ) m
    join public.silver_tournaments t on t.id = m.tournament_id
    left join public.bronze_standings w
           on w.tournament_id = m.tournament_id and w.player = m.winner
    left join public.bronze_standings l
           on l.tournament_id = m.tournament_id and l.player = m.loser
    where m.loser is not null
    on conflict (id) do update set
        tournament_id    = excluded.tournament_id,
        phase            = excluded.phase,
        round            = excluded.round,
        winner           = excluded.winner,
        loser            = excluded.loser,
        winner_deck_id   = excluded.winner_deck_id,
        winner_deck_name = excluded.winner_deck_name,
        loser_deck_id    = excluded.loser_deck_id,
        loser_deck_name  = excluded.loser_deck_name,
        is_tie           = excluded.is_tie,
        refreshed_at     = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

-- Convenience wrapper for a whole-database rebuild from a SQL session. The
-- scheduled job drives the three functions individually so it can batch and
-- report per step, so this exists mainly for one-off manual rebuilds.
create or replace function public.refresh_silver(p_tournaments text[] default null)
returns table (step text, rows_written bigint)
language plpgsql
security invoker
set search_path = public
as $fn$
begin
    return query select 'silver_tournaments'::text, public.refresh_silver_tournaments(p_tournaments);
    return query select 'silver_standings'::text,   public.refresh_silver_standings(p_tournaments);
    return query select 'silver_pairings'::text,    public.refresh_silver_pairings(p_tournaments);
end;
$fn$;

-- Writing silver is a job, not something the read-only keys should be able to
-- kick off. The secret key authenticates as service_role.
revoke all on function public.refresh_silver_tournaments(text[]) from public;
revoke all on function public.refresh_silver_standings(text[])   from public;
revoke all on function public.refresh_silver_pairings(text[])    from public;
revoke all on function public.refresh_silver(text[])             from public;

grant execute on function public.refresh_silver_tournaments(text[]) to service_role;
grant execute on function public.refresh_silver_standings(text[])   to service_role;
grant execute on function public.refresh_silver_pairings(text[])    to service_role;
grant execute on function public.refresh_silver(text[])             to service_role;
