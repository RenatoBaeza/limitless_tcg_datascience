-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The gold layer: the deck-versus-deck question, answered. Silver is still one
-- row per match. Gold is one row per (tournament, deck, opponent deck), which
-- is the shape a matchup matrix is a direct read of.
--
-- Note: keep semicolons out of comments in this file. The Supabase SQL editor
-- splits statements on semicolons without regard for comments, so one inside a
-- comment truncates the statement. That is also why the function bodies below
-- carry no inline comments - their explanations live in this header.
--
-- The three tables:
--
--   gold_matchups     the fact. One row per (tournament, deck_a, deck_b) with
--                     deck_a's wins, losses and ties against deck_b at that
--                     event.
--
--   gold_deck_events  one row per (tournament, deck): how many players brought
--                     it and how they finished. This is what meta share is
--                     computed from, over any date range.
--
--   gold_decks        the deck dimension - display name, icons, when it was
--                     first and last seen - plus an all-time roll-up of the
--                     two tables above.
--
-- Why the fact keeps tournament_id rather than being pre-summed per deck pair:
-- an all-time matrix cannot be filtered. Matchups shift with every set release,
-- so "last 30 days" is the question people actually ask. Holding the grain at
-- the event lets any date range, country or single event be summed on demand,
-- and 2k tournaments x ~175 cells is a table Postgres aggregates in one pass.
--
-- The judgement calls, all of which the read functions below depend on:
--
--   * Every match is counted twice, once from each side. A win for Dragapult
--     over Gardevoir is a win in (dragapult, gardevoir) and a loss in
--     (gardevoir, dragapult). So the matrix is antisymmetric by construction -
--     wins(a,b) always equals losses(b,a) - and a deck's whole record is one
--     row-slice of the fact. gold_coverage halves the total to report distinct
--     matches.
--
--   * Ties are carried as their own column, never folded into either side.
--     silver_pairings labels a tie's two players winner/loser arbitrarily, so
--     the fan-out above lands one tie in each direction and the counts stay
--     symmetric. Two rates come out of that, and they answer different
--     questions:
--         win_rate    wins / (wins + losses)   - decisive games only
--         score_rate  (wins + ties/2) / matches - the match-points convention
--     score_rate is the honest headline for a format where ~6% of matches are
--     draws. win_rate is there because it is what most people mean by
--     "win rate" and hiding it invites someone to recompute it wrongly.
--
--   * Mirrors are excluded from gold_matchups. A deck against itself is 50% by
--     definition, and the fan-out would land both a win and a loss in the same
--     cell, so a diagonal would be noise dressed as data. The count is kept on
--     gold_decks.mirror_matches so a frontend can still label the diagonal, and
--     excluding it means a deck's win rate is the sum of its matchup row with
--     nothing left over.
--
--   * A match is only counted when both decks are known. silver_pairings fills
--     its deck columns from a standings ingest that can lag or be missing
--     entirely, and ~4% of rows still have a null on one side. A matchup
--     against "unknown" is not a matchup.
--
--   * deck_id 'other' is Limitless's catch-all bucket for unclassified lists,
--     not an archetype. It is stored like any other deck and flagged
--     gold_decks.is_other, and every read function excludes it unless asked.

create table if not exists public.gold_decks (
    deck_id        text primary key,
    deck_name      text,
    deck_icons     text[],
    is_other       boolean generated always as (deck_id = 'other') stored,
    first_seen     date,
    last_seen      date,
    tournaments    integer     not null default 0,
    entries        integer     not null default 0,
    champions      integer     not null default 0,
    top8           integer     not null default 0,
    matches        integer     not null default 0,
    wins           integer     not null default 0,
    losses         integer     not null default 0,
    ties           integer     not null default 0,
    mirror_matches integer     not null default 0,
    win_rate       numeric generated always as (
        case when wins + losses > 0
             then round(wins::numeric / (wins + losses), 4) end
    ) stored,
    score_rate     numeric generated always as (
        case when matches > 0
             then round((wins + ties / 2.0) / matches, 4) end
    ) stored,
    refreshed_at   timestamptz not null default now()
);

create index if not exists gold_decks_entries_idx  on public.gold_decks (entries desc);
create index if not exists gold_decks_last_seen_idx on public.gold_decks (last_seen desc);

create table if not exists public.gold_deck_events (
    tournament_id   text        not null references public.silver_tournaments(id) on delete cascade,
    deck_id         text        not null,
    event_date      date        not null,
    entries         integer     not null,
    reported_wins   integer,
    reported_losses integer,
    reported_ties   integer,
    best_placement  integer,
    champions       integer     not null default 0,
    top8            integer     not null default 0,
    refreshed_at    timestamptz not null default now(),
    primary key (tournament_id, deck_id)
);

create index if not exists gold_deck_events_deck_idx on public.gold_deck_events (deck_id);
create index if not exists gold_deck_events_date_idx on public.gold_deck_events (event_date);

create table if not exists public.gold_matchups (
    tournament_id text        not null references public.silver_tournaments(id) on delete cascade,
    deck_a        text        not null,
    deck_b        text        not null,
    event_date    date        not null,
    matches       integer     not null,
    wins          integer     not null,
    losses        integer     not null,
    ties          integer     not null,
    refreshed_at  timestamptz not null default now(),
    primary key (tournament_id, deck_a, deck_b)
);

create index if not exists gold_matchups_pair_idx on public.gold_matchups (deck_a, deck_b);
create index if not exists gold_matchups_date_idx on public.gold_matchups (event_date);

alter table public.gold_decks        enable row level security;
alter table public.gold_deck_events  enable row level security;
alter table public.gold_matchups     enable row level security;

drop policy if exists "gold_decks_public_read" on public.gold_decks;
create policy "gold_decks_public_read"
    on public.gold_decks
    for select
    to anon, authenticated
    using (true);

drop policy if exists "gold_deck_events_public_read" on public.gold_deck_events;
create policy "gold_deck_events_public_read"
    on public.gold_deck_events
    for select
    to anon, authenticated
    using (true);

drop policy if exists "gold_matchups_public_read" on public.gold_matchups;
create policy "gold_matchups_public_read"
    on public.gold_matchups
    for select
    to anon, authenticated
    using (true);

-- The transform.
--
-- gold_deck_events and gold_matchups take a batch of tournament ids so
-- app/gold.py can stay inside the statement timeout, exactly as the silver
-- refresh does. Passing null does the whole table.
--
-- gold_decks takes no batch: it is a roll-up keyed on deck, not on tournament,
-- so there is no slice of it that a subset of tournaments corresponds to. It
-- reads the two tables above, so it must run after both.
--
-- Each is a full reconcile of its slice - rows that no longer qualify are
-- deleted before the rest are upserted - so re-running is a no-op beyond
-- refreshed_at. They return the number of rows the upsert touched.

create or replace function public.refresh_gold_deck_events(p_tournaments text[] default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.gold_deck_events g
    where (p_tournaments is null or g.tournament_id = any(p_tournaments))
      and not exists (
          select 1 from public.silver_standings s
          where s.tournament_id = g.tournament_id
            and s.deck_id = g.deck_id
      );

    insert into public.gold_deck_events
        (tournament_id, deck_id, event_date, entries, reported_wins,
         reported_losses, reported_ties, best_placement, champions, top8,
         refreshed_at)
    select s.tournament_id,
           s.deck_id,
           t.date,
           count(*)::int,
           sum(s.wins)::int,
           sum(s.losses)::int,
           sum(s.ties)::int,
           min(s.placement)::int,
           (count(*) filter (where s.placement = 1))::int,
           (count(*) filter (where s.placement <= 8))::int,
           now()
    from public.silver_standings s
    join public.silver_tournaments t on t.id = s.tournament_id
    where s.deck_id is not null
      and (p_tournaments is null or s.tournament_id = any(p_tournaments))
    group by s.tournament_id, s.deck_id, t.date
    on conflict (tournament_id, deck_id) do update set
        event_date      = excluded.event_date,
        entries         = excluded.entries,
        reported_wins   = excluded.reported_wins,
        reported_losses = excluded.reported_losses,
        reported_ties   = excluded.reported_ties,
        best_placement  = excluded.best_placement,
        champions       = excluded.champions,
        top8            = excluded.top8,
        refreshed_at    = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

create or replace function public.refresh_gold_matchups(p_tournaments text[] default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.gold_matchups g
    where (p_tournaments is null or g.tournament_id = any(p_tournaments))
      and not exists (
          select 1 from public.silver_pairings s
          where s.tournament_id = g.tournament_id
            and s.winner_deck_id is not null
            and s.loser_deck_id is not null
            and s.winner_deck_id <> s.loser_deck_id
            and ((s.winner_deck_id = g.deck_a and s.loser_deck_id = g.deck_b)
              or (s.loser_deck_id = g.deck_a and s.winner_deck_id = g.deck_b))
      );

    insert into public.gold_matchups
        (tournament_id, deck_a, deck_b, event_date, matches, wins, losses,
         ties, refreshed_at)
    select e.tournament_id,
           e.deck_a,
           e.deck_b,
           t.date,
           count(*)::int,
           (count(*) filter (where e.outcome = 1))::int,
           (count(*) filter (where e.outcome = -1))::int,
           (count(*) filter (where e.outcome = 0))::int,
           now()
    from (
        select s.tournament_id,
               s.winner_deck_id as deck_a,
               s.loser_deck_id  as deck_b,
               case when s.is_tie then 0 else 1 end as outcome
        from public.silver_pairings s
        where s.winner_deck_id is not null
          and s.loser_deck_id is not null
          and s.winner_deck_id <> s.loser_deck_id
          and (p_tournaments is null or s.tournament_id = any(p_tournaments))
        union all
        select s.tournament_id,
               s.loser_deck_id  as deck_a,
               s.winner_deck_id as deck_b,
               case when s.is_tie then 0 else -1 end as outcome
        from public.silver_pairings s
        where s.winner_deck_id is not null
          and s.loser_deck_id is not null
          and s.winner_deck_id <> s.loser_deck_id
          and (p_tournaments is null or s.tournament_id = any(p_tournaments))
    ) e
    join public.silver_tournaments t on t.id = e.tournament_id
    group by e.tournament_id, e.deck_a, e.deck_b, t.date
    on conflict (tournament_id, deck_a, deck_b) do update set
        event_date   = excluded.event_date,
        matches      = excluded.matches,
        wins         = excluded.wins,
        losses       = excluded.losses,
        ties         = excluded.ties,
        refreshed_at = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

-- The naming CTE takes each deck's most recently seen display name and icons.
-- Limitless renames archetypes as they evolve, and the newest name is the one a
-- reader will recognise.
create or replace function public.refresh_gold_decks()
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.gold_decks d
    where not exists (
        select 1 from public.gold_deck_events e where e.deck_id = d.deck_id
    );

    with events as (
        select e.deck_id,
               min(e.event_date)     as first_seen,
               max(e.event_date)     as last_seen,
               count(*)::int         as tournaments,
               sum(e.entries)::int   as entries,
               sum(e.champions)::int as champions,
               sum(e.top8)::int      as top8
        from public.gold_deck_events e
        group by e.deck_id
    ),
    record as (
        select m.deck_a           as deck_id,
               sum(m.matches)::int as matches,
               sum(m.wins)::int    as wins,
               sum(m.losses)::int  as losses,
               sum(m.ties)::int    as ties
        from public.gold_matchups m
        group by m.deck_a
    ),
    mirrors as (
        select s.winner_deck_id as deck_id,
               count(*)::int    as mirror_matches
        from public.silver_pairings s
        where s.winner_deck_id is not null
          and s.winner_deck_id = s.loser_deck_id
        group by s.winner_deck_id
    ),
    naming as (
        select distinct on (s.deck_id)
               s.deck_id, s.deck_name, s.deck_icons
        from public.silver_standings s
        join public.silver_tournaments t on t.id = s.tournament_id
        where s.deck_id is not null
          and s.deck_name is not null
        order by s.deck_id, t.date desc
    )
    insert into public.gold_decks
        (deck_id, deck_name, deck_icons, first_seen, last_seen, tournaments,
         entries, champions, top8, matches, wins, losses, ties,
         mirror_matches, refreshed_at)
    select ev.deck_id,
           nm.deck_name,
           nm.deck_icons,
           ev.first_seen,
           ev.last_seen,
           ev.tournaments,
           ev.entries,
           ev.champions,
           ev.top8,
           coalesce(rc.matches, 0),
           coalesce(rc.wins, 0),
           coalesce(rc.losses, 0),
           coalesce(rc.ties, 0),
           coalesce(mi.mirror_matches, 0),
           now()
    from events ev
    left join naming  nm on nm.deck_id = ev.deck_id
    left join record  rc on rc.deck_id = ev.deck_id
    left join mirrors mi on mi.deck_id = ev.deck_id
    on conflict (deck_id) do update set
        deck_name      = excluded.deck_name,
        deck_icons     = excluded.deck_icons,
        first_seen     = excluded.first_seen,
        last_seen      = excluded.last_seen,
        tournaments    = excluded.tournaments,
        entries        = excluded.entries,
        champions      = excluded.champions,
        top8           = excluded.top8,
        matches        = excluded.matches,
        wins           = excluded.wins,
        losses         = excluded.losses,
        ties           = excluded.ties,
        mirror_matches = excluded.mirror_matches,
        refreshed_at   = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

-- Convenience wrapper for a whole-database rebuild from a SQL session. The
-- scheduled job drives the three functions individually so it can batch the
-- first two and report per step.
create or replace function public.refresh_gold(p_tournaments text[] default null)
returns table (step text, rows_written bigint)
language plpgsql
security invoker
set search_path = public
as $fn$
begin
    return query select 'gold_deck_events'::text, public.refresh_gold_deck_events(p_tournaments);
    return query select 'gold_matchups'::text,    public.refresh_gold_matchups(p_tournaments);
    return query select 'gold_decks'::text,       public.refresh_gold_decks();
end;
$fn$;

-- The read side.
--
-- A 3-match matchup at 100% and a 300-match matchup at 55% are not the same
-- claim, and a matrix that prints both as a percentage invites reading them as
-- if they were. Every rate below therefore ships with its match count and a
-- 95% Wilson score interval, which is the interval that stays inside 0..1 and
-- stays sane at small n - the normal approximation puts 3-0 at 100% +/- 0%.
--
-- Ties count as half a win for the interval, so successes is not an integer
-- and the binomial model is an approximation. At a ~6% tie rate the error is
-- far smaller than the interval it sits inside.

create or replace function public.wilson_interval(p_successes numeric, p_trials numeric)
returns numeric[]
language sql
immutable
parallel safe
set search_path = public
as $fn$
    select case when p_trials > 0
                then array[greatest(0, w.center - w.margin), least(1, w.center + w.margin)]
           end
    from (
        select (q.p + 1.9208 / p_trials) / (1 + 3.8416 / p_trials) as center,
               (1.96 / (1 + 3.8416 / p_trials))
                   * sqrt(q.p * (1 - q.p) / p_trials + 0.9604 / (p_trials * p_trials)) as margin
        from (select p_successes / nullif(p_trials, 0) as p) q
    ) w;
$fn$;

-- What the frontend needs before it can pick a default date range.
create or replace function public.gold_coverage()
returns table (
    first_event  date,
    last_event   date,
    tournaments  bigint,
    decks        bigint,
    matches      bigint,
    refreshed_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $fn$
    select min(m.event_date),
           max(m.event_date),
           count(distinct m.tournament_id),
           (select count(*) from public.gold_decks),
           coalesce(sum(m.matches), 0) / 2,
           (select max(d.refreshed_at) from public.gold_decks d)
    from public.gold_matchups m;
$fn$;

-- The deck list for a window: who is being played, how much, and how they did.
-- meta_share is the deck's entries over every entry in the window, so it sums
-- to 1 across all decks when p_include_other is true and p_limit is null.
create or replace function public.gold_deck_summary(
    p_from          date    default null,
    p_to            date    default null,
    p_limit         int     default 50,
    p_include_other boolean default false
)
returns table (
    deck_id     text,
    deck_name   text,
    deck_icons  text[],
    entries     bigint,
    tournaments bigint,
    meta_share  numeric,
    matches     bigint,
    wins        bigint,
    losses      bigint,
    ties        bigint,
    win_rate    numeric,
    score_rate  numeric,
    score_low   numeric,
    score_high  numeric,
    champions   bigint,
    top8        bigint
)
language sql
stable
security invoker
set search_path = public
as $fn$
    with scoped as (
        select e.deck_id, e.entries, e.champions, e.top8
        from public.gold_deck_events e
        where (p_from is null or e.event_date >= p_from)
          and (p_to is null or e.event_date <= p_to)
          and (p_include_other or e.deck_id <> 'other')
    ),
    total as (
        select coalesce(sum(s.entries), 0) as entries from scoped s
    ),
    record as (
        select m.deck_a        as deck_id,
               sum(m.matches)  as matches,
               sum(m.wins)     as wins,
               sum(m.losses)   as losses,
               sum(m.ties)     as ties
        from public.gold_matchups m
        where (p_from is null or m.event_date >= p_from)
          and (p_to is null or m.event_date <= p_to)
          and (p_include_other or (m.deck_a <> 'other' and m.deck_b <> 'other'))
        group by m.deck_a
    ),
    rolled as (
        select s.deck_id,
               sum(s.entries)   as entries,
               count(*)         as tournaments,
               sum(s.champions) as champions,
               sum(s.top8)      as top8
        from scoped s
        group by s.deck_id
    )
    select r.deck_id,
           d.deck_name,
           d.deck_icons,
           r.entries,
           r.tournaments,
           round(r.entries::numeric / nullif((select t.entries from total t), 0), 6),
           coalesce(rc.matches, 0),
           coalesce(rc.wins, 0),
           coalesce(rc.losses, 0),
           coalesce(rc.ties, 0),
           case when coalesce(rc.wins, 0) + coalesce(rc.losses, 0) > 0
                then round(rc.wins::numeric / (rc.wins + rc.losses), 4) end,
           case when coalesce(rc.matches, 0) > 0
                then round((rc.wins + rc.ties / 2.0) / rc.matches, 4) end,
           round(ci.bounds[1], 4),
           round(ci.bounds[2], 4),
           r.champions,
           r.top8
    from rolled r
    join public.gold_decks d on d.deck_id = r.deck_id
    left join record rc on rc.deck_id = r.deck_id
    left join lateral (
        select public.wilson_interval(rc.wins + rc.ties / 2.0, rc.matches) as bounds
    ) ci on true
    order by r.entries desc, r.deck_id
    limit p_limit;
$fn$;

-- The matrix itself. Both axes are the same deck set: either exactly p_decks,
-- or the p_limit most-played decks in the window. Cells below p_min_matches are
-- dropped rather than returned with a rate nobody should read - the frontend
-- draws those as empty.
--
-- Only cells with data come back, so the caller must treat a missing (a,b) as
-- "no matches", not as zero. A full 30x30 matrix is 870 cells and real data
-- fills perhaps two thirds of them.
create or replace function public.gold_matchup_matrix(
    p_from          date    default null,
    p_to            date    default null,
    p_decks         text[]  default null,
    p_limit         int     default 20,
    p_min_matches   int     default 1,
    p_include_other boolean default false
)
returns table (
    deck_a     text,
    deck_b     text,
    matches    bigint,
    wins       bigint,
    losses     bigint,
    ties       bigint,
    win_rate   numeric,
    score_rate numeric,
    score_low  numeric,
    score_high numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
    with axis as (
        select e.deck_id
        from public.gold_deck_events e
        where (p_from is null or e.event_date >= p_from)
          and (p_to is null or e.event_date <= p_to)
          and (p_include_other or e.deck_id <> 'other')
          and (p_decks is null or e.deck_id = any(p_decks))
        group by e.deck_id
        order by sum(e.entries) desc, e.deck_id
        limit case when p_decks is null then p_limit end
    ),
    cells as (
        select m.deck_a,
               m.deck_b,
               sum(m.matches) as matches,
               sum(m.wins)    as wins,
               sum(m.losses)  as losses,
               sum(m.ties)    as ties
        from public.gold_matchups m
        join axis a on a.deck_id = m.deck_a
        join axis b on b.deck_id = m.deck_b
        where (p_from is null or m.event_date >= p_from)
          and (p_to is null or m.event_date <= p_to)
        group by m.deck_a, m.deck_b
        having sum(m.matches) >= coalesce(p_min_matches, 1)
    )
    select c.deck_a,
           c.deck_b,
           c.matches,
           c.wins,
           c.losses,
           c.ties,
           case when c.wins + c.losses > 0
                then round(c.wins::numeric / (c.wins + c.losses), 4) end,
           round((c.wins + c.ties / 2.0) / c.matches, 4),
           round(ci.bounds[1], 4),
           round(ci.bounds[2], 4)
    from cells c
    cross join lateral (
        select public.wilson_interval(c.wins + c.ties / 2.0, c.matches) as bounds
    ) ci;
$fn$;

-- One deck against the whole field, which is the matrix restricted to a row but
-- without the opposite axis being capped - a deck detail view wants every
-- opponent it ever faced, not just the popular ones.
create or replace function public.gold_deck_matchups(
    p_deck          text,
    p_from          date    default null,
    p_to            date    default null,
    p_min_matches   int     default 1,
    p_include_other boolean default false
)
returns table (
    deck_b      text,
    deck_name   text,
    deck_icons  text[],
    matches     bigint,
    wins        bigint,
    losses      bigint,
    ties        bigint,
    win_rate    numeric,
    score_rate  numeric,
    score_low   numeric,
    score_high  numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
    with cells as (
        select m.deck_b,
               sum(m.matches) as matches,
               sum(m.wins)    as wins,
               sum(m.losses)  as losses,
               sum(m.ties)    as ties
        from public.gold_matchups m
        where m.deck_a = p_deck
          and (p_from is null or m.event_date >= p_from)
          and (p_to is null or m.event_date <= p_to)
          and (p_include_other or m.deck_b <> 'other')
        group by m.deck_b
        having sum(m.matches) >= coalesce(p_min_matches, 1)
    )
    select c.deck_b,
           d.deck_name,
           d.deck_icons,
           c.matches,
           c.wins,
           c.losses,
           c.ties,
           case when c.wins + c.losses > 0
                then round(c.wins::numeric / (c.wins + c.losses), 4) end,
           round((c.wins + c.ties / 2.0) / c.matches, 4),
           round(ci.bounds[1], 4),
           round(ci.bounds[2], 4)
    from cells c
    join public.gold_decks d on d.deck_id = c.deck_b
    cross join lateral (
        select public.wilson_interval(c.wins + c.ties / 2.0, c.matches) as bounds
    ) ci
    order by c.matches desc, c.deck_b;
$fn$;

-- Writing gold is a job, the same as writing silver: only the secret key, which
-- authenticates as service_role, may kick one off.
revoke all on function public.refresh_gold_deck_events(text[]) from public;
revoke all on function public.refresh_gold_matchups(text[])    from public;
revoke all on function public.refresh_gold_decks()             from public;
revoke all on function public.refresh_gold(text[])             from public;

grant execute on function public.refresh_gold_deck_events(text[]) to service_role;
grant execute on function public.refresh_gold_matchups(text[])    to service_role;
grant execute on function public.refresh_gold_decks()             to service_role;
grant execute on function public.refresh_gold(text[])             to service_role;

-- Reading it is what the whole layer is for, so the read functions are open to
-- the same roles the gold tables are.
grant execute on function public.wilson_interval(numeric, numeric)                        to anon, authenticated, service_role;
grant execute on function public.gold_coverage()                                          to anon, authenticated, service_role;
grant execute on function public.gold_deck_summary(date, date, int, boolean)              to anon, authenticated, service_role;
grant execute on function public.gold_matchup_matrix(date, date, text[], int, int, boolean) to anon, authenticated, service_role;
grant execute on function public.gold_deck_matchups(text, date, date, int, boolean)       to anon, authenticated, service_role;
