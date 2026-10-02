-- Gold, rebuilt as finished tables. Applied 2026-10-02. Safe to re-run.
--
-- Supersedes the tables and functions of sql/006_gold.sql (wilson_interval is
-- the one survivor). That design kept gold at the grain of the tournament -
-- one gold_matchups row per (tournament, deck_a, deck_b) - so that any date
-- range could be summed on demand. The cost was that nothing in gold was ever
-- an answer. Every request the frontend made re-aggregated the whole fact
-- inside a read function, and the fact did not even compress silver: at 1.55
-- matches per row, gold_matchups was larger than the silver_pairings it was
-- derived from (~260k rows). When this was applied, the three old tables held
--
--   gold_matchups 312,484   gold_deck_events 46,817   gold_decks 151   (132 MB)
--
-- The frontend never asked for an arbitrary range. It asks for one of four
-- fixed windows, each counted back from the last event in the data. So those
-- windows are now computed once, in the silver -> gold refresh, and gold holds
-- exactly the rows the client draws:
--
--   gold_periods        one row per window - 30d, 90d, 180d, all - with the
--                       dates it resolved to on the last refresh and its
--                       headline totals. The window definitions live here
--                       (period, days), and adding a row adds a window.
--
--   gold_decks          the deck dimension: display name, icons, first and
--                       last seen. One row per deck in the retention window.
--
--   gold_deck_stats     one row per (period, include_other, deck): rank,
--                       entries, meta share and the full record with its rates
--                       and Wilson interval. The deck table, as drawn.
--
--   gold_matchup_stats  one row per (period, deck_a, deck_b): the cell of the
--                       matchup matrix, as drawn. Also the deck detail view,
--                       which is one deck_a slice.
--
-- Reading them is a filter on a primary key, nothing more - no read function,
-- no aggregate. The row counts after the first rebuild are at the bottom of
-- this header.
--
-- Why include_other is a key column of gold_deck_stats and not a read-time
-- filter: 'other' (Limitless's catch-all for unclassified lists) is the 7th
-- most played "deck". Leaving it out changes the meta-share denominator, every
-- deck's rank below it, and each deck's record, since the games against it
-- drop out too. So both variants are computed. gold_matchup_stats needs no such
-- split - a cell's numbers do not depend on it, so excluding 'other' there is
-- just not reading its row and column.
--
-- Every judgement call from sql/006_gold.sql still holds and is applied in the
-- refresh instead of at read time:
--
--   * Every match is counted twice, once from each side, so the matrix is
--     antisymmetric and a deck's whole record is one deck_a slice. Both
--     directions are stored so neither read has to flip a row.
--   * Ties are their own column. win_rate = wins / (wins + losses), and
--     score_rate = (wins + ties/2) / matches is the headline.
--   * Mirrors are left out of every rate and counted on
--     gold_deck_stats.mirror_matches.
--   * A match counts only when both decks are known.
--   * Every rate ships with a 95% Wilson interval (score_low, score_high).
--
-- The window bounds: the last event is the latest tournament with a counted
-- match, and a window of N days runs from N days before it to it, inclusive -
-- the same arithmetic the client used to do. Every bound is clamped to the
-- retention cutoff the refresh is handed (p_since), so gold never reaches past
-- the window even before scripts/prune_window.py has trimmed silver. That is
-- also why gold no longer has a foreign key to silver_tournaments: the prune
-- does not need to cascade into it.
--
-- Dropping the old tables loses nothing: gold is derived, and the refresh
-- rebuilds it from silver in a few seconds.
--
-- After the first rebuild (refresh_gold with a 2026-04-02 cutoff):
--
--   gold_periods 4   gold_decks 151   gold_deck_stats 1,158
--   gold_matchup_stats 36,502 (30d 4,972 / 90d 8,604 / 180d 11,424 / all 11,502)
--   (9.7 MB)
--
-- The slowest call is refresh_gold_matchup_stats('all'), at 2.3s warm. The
-- budget is the 8s PostgREST statement timeout, and a cold cache costs real
-- time here: a first draft of refresh_gold_periods that scanned silver_pairings
-- inside an UPDATE (which Postgres will not parallelise) ran 4-8s, which is why
-- it now only probes indexes and leaves the totals to the stats steps. A call
-- that does time out is redone by the next run.

drop function if exists public.gold_coverage();
drop function if exists public.gold_deck_summary(date, date, int, boolean);
drop function if exists public.gold_matchup_matrix(date, date, text[], int, int, boolean);
drop function if exists public.gold_deck_matchups(text, date, date, int, boolean);
drop function if exists public.refresh_gold(text[]);
drop function if exists public.refresh_gold_deck_events(text[]);
drop function if exists public.refresh_gold_matchups(text[]);

drop table if exists public.gold_matchups;
drop table if exists public.gold_deck_events;

-- gold_decks keeps its name but loses its all-time roll-up columns, which
-- gold_deck_stats (period 'all') now carries. Only the old shape is dropped,
-- so re-running this file does not empty the new one.
do $do$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'gold_decks' and column_name = 'entries'
    ) then
        drop table public.gold_decks;
    end if;
end;
$do$;

create table if not exists public.gold_periods (
    period       text primary key,
    days         integer check (days > 0),
    date_from    date,
    date_to      date,
    tournaments  integer     not null default 0,
    entries      integer     not null default 0,
    matches      integer     not null default 0,
    decks        integer     not null default 0,
    refreshed_at timestamptz
);

insert into public.gold_periods (period, days) values
    ('30d', 30),
    ('90d', 90),
    ('180d', 180),
    ('all', null)
on conflict (period) do update set days = excluded.days;

create table if not exists public.gold_decks (
    deck_id      text primary key,
    deck_name    text,
    deck_icons   text[],
    is_other     boolean generated always as (deck_id = 'other') stored,
    first_seen   date,
    last_seen    date,
    refreshed_at timestamptz not null default now()
);

create table if not exists public.gold_deck_stats (
    period         text        not null references public.gold_periods(period) on delete cascade,
    include_other  boolean     not null,
    deck_id        text        not null,
    rank           integer     not null,
    deck_name      text,
    entries        integer     not null,
    tournaments    integer     not null,
    meta_share     numeric,
    matches        integer     not null,
    wins           integer     not null,
    losses         integer     not null,
    ties           integer     not null,
    mirror_matches integer     not null,
    win_rate       numeric,
    score_rate     numeric,
    score_low      numeric,
    score_high     numeric,
    champions      integer     not null,
    top8           integer     not null,
    refreshed_at   timestamptz not null default now(),
    primary key (period, include_other, deck_id)
);

-- The deck list and the matrix axis both read "the top N by rank".
create unique index if not exists gold_deck_stats_rank_idx
    on public.gold_deck_stats (period, include_other, rank);

create table if not exists public.gold_matchup_stats (
    period       text        not null references public.gold_periods(period) on delete cascade,
    deck_a       text        not null,
    deck_b       text        not null,
    deck_b_name  text,
    matches      integer     not null,
    wins         integer     not null,
    losses       integer     not null,
    ties         integer     not null,
    win_rate     numeric,
    score_rate   numeric     not null,
    score_low    numeric,
    score_high   numeric,
    refreshed_at timestamptz not null default now(),
    primary key (period, deck_a, deck_b)
);

alter table public.gold_periods       enable row level security;
alter table public.gold_decks         enable row level security;
alter table public.gold_deck_stats    enable row level security;
alter table public.gold_matchup_stats enable row level security;

drop policy if exists "gold_periods_public_read" on public.gold_periods;
create policy "gold_periods_public_read"
    on public.gold_periods for select to anon, authenticated using (true);

drop policy if exists "gold_decks_public_read" on public.gold_decks;
create policy "gold_decks_public_read"
    on public.gold_decks for select to anon, authenticated using (true);

drop policy if exists "gold_deck_stats_public_read" on public.gold_deck_stats;
create policy "gold_deck_stats_public_read"
    on public.gold_deck_stats for select to anon, authenticated using (true);

drop policy if exists "gold_matchup_stats_public_read" on public.gold_matchup_stats;
create policy "gold_matchup_stats_public_read"
    on public.gold_matchup_stats for select to anon, authenticated using (true);

-- The transform. app/gold.py calls these in this order, each its own RPC so
-- every call stays inside the 8s PostgREST statement timeout:
--
--   refresh_gold_periods(p_since)        resolves every window's dates.
--                                        Everything below reads them.
--   refresh_gold_decks()                 the dimension, over the 'all' window.
--   refresh_gold_matchup_stats(period)   one call per window. Also writes the
--                                        period's match total.
--   refresh_gold_deck_stats(period)      one call per window. Rolls up the
--                                        period's matchup cells into each
--                                        deck's record, so it goes last. Also
--                                        writes the period's entries, decks
--                                        and tournaments.
--
-- Each period total is written by the step that has just computed the rows it
-- sums, so a total can never disagree with the table beside it. A period's
-- tournaments are the events in it with at least one deck entry. That is a
-- superset of the events with a counted match (a counted match needs both
-- players' decks, which come from standings), so it also agrees with the
-- per-deck tournament counts in gold_deck_stats.
--
-- The window's last event is found by probing silver_tournaments newest first
-- for one with a counted match, through the date and tournament_id indexes,
-- rather than by aggregating every pairing.
--
-- The per-period steps delete their period and re-insert it inside the one
-- function call, so a reader sees either the old window or the new one, never
-- a half-written mix. Each run is a full rebuild from silver - nothing is
-- incremental, so nothing can drift.

create or replace function public.refresh_gold_periods(p_since date default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
    v_first date;
    v_last date;
begin
    select t.date into v_last
    from public.silver_tournaments t
    where (p_since is null or t.date >= p_since)
      and exists (
          select 1 from public.silver_pairings s
          where s.tournament_id = t.id
            and s.winner_deck_id is not null
            and s.loser_deck_id is not null
            and s.winner_deck_id <> s.loser_deck_id
      )
    order by t.date desc
    limit 1;

    select t.date into v_first
    from public.silver_tournaments t
    where (p_since is null or t.date >= p_since)
      and exists (
          select 1 from public.silver_pairings s
          where s.tournament_id = t.id
            and s.winner_deck_id is not null
            and s.loser_deck_id is not null
            and s.winner_deck_id <> s.loser_deck_id
      )
    order by t.date
    limit 1;

    update public.gold_periods g
    set date_from    = case when g.days is null then v_first
                            else greatest(v_last - g.days, p_since) end,
        date_to      = v_last,
        refreshed_at = now()
    where g.period is not null;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

-- Each deck's most recently seen display name and icons: Limitless renames
-- archetypes as they evolve, and the newest name is the one a reader will
-- recognise. Rows the upsert did not touch belong to decks that left the
-- window, and now() is fixed for the transaction, so they are exactly the rows
-- with an older refreshed_at.
create or replace function public.refresh_gold_decks()
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    with scoped as (
        select s.deck_id, s.deck_name, s.deck_icons, t.date
        from public.silver_standings s
        join public.silver_tournaments t on t.id = s.tournament_id
        join public.gold_periods p on p.period = 'all'
        where s.deck_id is not null
          and t.date between p.date_from and p.date_to
    ),
    seen as (
        select sc.deck_id, min(sc.date) as first_seen, max(sc.date) as last_seen
        from scoped sc
        group by sc.deck_id
    ),
    naming as (
        select distinct on (sc.deck_id) sc.deck_id, sc.deck_name, sc.deck_icons
        from scoped sc
        where sc.deck_name is not null
        order by sc.deck_id, sc.date desc
    )
    insert into public.gold_decks
        (deck_id, deck_name, deck_icons, first_seen, last_seen, refreshed_at)
    select se.deck_id, nm.deck_name, nm.deck_icons, se.first_seen, se.last_seen, now()
    from seen se
    left join naming nm on nm.deck_id = se.deck_id
    on conflict (deck_id) do update set
        deck_name    = excluded.deck_name,
        deck_icons   = excluded.deck_icons,
        first_seen   = excluded.first_seen,
        last_seen    = excluded.last_seen,
        refreshed_at = excluded.refreshed_at;

    get diagnostics n = row_count;

    delete from public.gold_decks d where d.refreshed_at < now();

    return n;
end;
$fn$;

create or replace function public.refresh_gold_matchup_stats(p_period text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
    v_from date;
    v_to date;
begin
    select p.date_from, p.date_to into v_from, v_to
    from public.gold_periods p
    where p.period = p_period;
    if not found then
        raise exception 'unknown gold period: %', p_period;
    end if;

    delete from public.gold_matchup_stats m where m.period = p_period;

    insert into public.gold_matchup_stats
        (period, deck_a, deck_b, deck_b_name, matches, wins, losses, ties,
         win_rate, score_rate, score_low, score_high, refreshed_at)
    select p_period,
           c.deck_a,
           c.deck_b,
           d.deck_name,
           c.matches,
           c.wins,
           c.losses,
           c.ties,
           case when c.wins + c.losses > 0
                then round(c.wins::numeric / (c.wins + c.losses), 4) end,
           round((c.wins + c.ties / 2.0) / c.matches, 4),
           round(ci.bounds[1], 4),
           round(ci.bounds[2], 4),
           now()
    from (
        select e.deck_a,
               e.deck_b,
               count(*)::int                                  as matches,
               (count(*) filter (where e.outcome = 1))::int   as wins,
               (count(*) filter (where e.outcome = -1))::int  as losses,
               (count(*) filter (where e.outcome = 0))::int   as ties
        from (
            select s.winner_deck_id as deck_a,
                   s.loser_deck_id  as deck_b,
                   case when s.is_tie then 0 else 1 end as outcome
            from public.silver_pairings s
            join public.silver_tournaments t on t.id = s.tournament_id
            where t.date between v_from and v_to
              and s.winner_deck_id is not null
              and s.loser_deck_id is not null
              and s.winner_deck_id <> s.loser_deck_id
            union all
            select s.loser_deck_id  as deck_a,
                   s.winner_deck_id as deck_b,
                   case when s.is_tie then 0 else -1 end as outcome
            from public.silver_pairings s
            join public.silver_tournaments t on t.id = s.tournament_id
            where t.date between v_from and v_to
              and s.winner_deck_id is not null
              and s.loser_deck_id is not null
              and s.winner_deck_id <> s.loser_deck_id
        ) e
        group by e.deck_a, e.deck_b
    ) c
    left join public.gold_decks d on d.deck_id = c.deck_b
    cross join lateral (
        select public.wilson_interval(c.wins + c.ties / 2.0, c.matches) as bounds
    ) ci;

    get diagnostics n = row_count;

    update public.gold_periods g
    set matches = (
            select coalesce(sum(m.matches), 0) / 2
            from public.gold_matchup_stats m
            where m.period = p_period
        )
    where g.period = p_period;

    return n;
end;
$fn$;

-- Entries are grouped by (tournament, deck) before they are rolled up by deck.
-- Counting distinct tournaments straight off the standings forces a sort that
-- spills to disk and took 5.6s of the 8s budget on 2026-10-02. Two hash
-- aggregates take 1.4s.
create or replace function public.refresh_gold_deck_stats(p_period text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
    v_from date;
    v_to date;
begin
    select p.date_from, p.date_to into v_from, v_to
    from public.gold_periods p
    where p.period = p_period;
    if not found then
        raise exception 'unknown gold period: %', p_period;
    end if;

    delete from public.gold_deck_stats g where g.period = p_period;

    insert into public.gold_deck_stats
        (period, include_other, deck_id, rank, deck_name, entries, tournaments,
         meta_share, matches, wins, losses, ties, mirror_matches, win_rate,
         score_rate, score_low, score_high, champions, top8, refreshed_at)
    with entered as (
        select x.deck_id,
               sum(x.entries)::int   as entries,
               count(*)::int         as tournaments,
               sum(x.champions)::int as champions,
               sum(x.top8)::int      as top8
        from (
            select s.tournament_id,
                   s.deck_id,
                   count(*)                                   as entries,
                   count(*) filter (where s.placement = 1)    as champions,
                   count(*) filter (where s.placement <= 8)   as top8
            from public.silver_standings s
            join public.silver_tournaments t on t.id = s.tournament_id
            where s.deck_id is not null
              and t.date between v_from and v_to
            group by s.tournament_id, s.deck_id
        ) x
        group by x.deck_id
    ),
    mirrors as (
        select s.winner_deck_id as deck_id, count(*)::int as mirror_matches
        from public.silver_pairings s
        join public.silver_tournaments t on t.id = s.tournament_id
        where t.date between v_from and v_to
          and s.winner_deck_id = s.loser_deck_id
        group by s.winner_deck_id
    ),
    scopes (include_other) as (
        values (true), (false)
    ),
    records as (
        select sc.include_other,
               m.deck_a           as deck_id,
               sum(m.matches)::int as matches,
               sum(m.wins)::int    as wins,
               sum(m.losses)::int  as losses,
               sum(m.ties)::int    as ties
        from scopes sc
        join public.gold_matchup_stats m
          on m.period = p_period
         and (sc.include_other or m.deck_b <> 'other')
        group by sc.include_other, m.deck_a
    ),
    ranked as (
        select sc.include_other,
               en.deck_id,
               en.entries,
               en.tournaments,
               en.champions,
               en.top8,
               sum(en.entries) over (partition by sc.include_other) as total_entries,
               row_number() over (partition by sc.include_other
                                  order by en.entries desc, en.deck_id) as rank
        from scopes sc
        cross join entered en
        where sc.include_other or en.deck_id <> 'other'
    )
    select p_period,
           r.include_other,
           r.deck_id,
           r.rank,
           d.deck_name,
           r.entries,
           r.tournaments,
           round(r.entries::numeric / nullif(r.total_entries, 0), 6),
           coalesce(rc.matches, 0),
           coalesce(rc.wins, 0),
           coalesce(rc.losses, 0),
           coalesce(rc.ties, 0),
           coalesce(mi.mirror_matches, 0),
           case when coalesce(rc.wins, 0) + coalesce(rc.losses, 0) > 0
                then round(rc.wins::numeric / (rc.wins + rc.losses), 4) end,
           case when coalesce(rc.matches, 0) > 0
                then round((rc.wins + rc.ties / 2.0) / rc.matches, 4) end,
           round(ci.bounds[1], 4),
           round(ci.bounds[2], 4),
           r.champions,
           r.top8,
           now()
    from ranked r
    left join public.gold_decks d on d.deck_id = r.deck_id
    left join records rc on rc.include_other = r.include_other and rc.deck_id = r.deck_id
    left join mirrors mi on mi.deck_id = r.deck_id
    left join lateral (
        select public.wilson_interval(rc.wins + rc.ties / 2.0, rc.matches) as bounds
    ) ci on true;

    get diagnostics n = row_count;

    update public.gold_periods g
    set entries = (
            select coalesce(sum(d.entries), 0)
            from public.gold_deck_stats d
            where d.period = p_period and d.include_other
        ),
        decks = (
            select count(*)
            from public.gold_deck_stats d
            where d.period = p_period and d.include_other
        ),
        tournaments = (
            select count(*)
            from public.silver_tournaments t
            where t.date between v_from and v_to
              and exists (
                  select 1 from public.silver_standings s
                  where s.tournament_id = t.id and s.deck_id is not null
              )
        )
    where g.period = p_period;

    return n;
end;
$fn$;

-- A whole rebuild in one call, for a SQL session (the MCP execute_sql tool, the
-- web editor). Together the steps run well past the 8s PostgREST timeout, so the
-- scheduled job drives them individually through app/gold.py instead.
create or replace function public.refresh_gold(p_since date default null)
returns table (step text, period text, rows_written bigint)
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    p text;
begin
    return query select 'periods'::text, null::text, public.refresh_gold_periods(p_since);
    return query select 'decks'::text, null::text, public.refresh_gold_decks();
    for p in select g.period from public.gold_periods g order by g.days nulls last loop
        return query select 'matchup_stats'::text, p, public.refresh_gold_matchup_stats(p);
    end loop;
    for p in select g.period from public.gold_periods g order by g.days nulls last loop
        return query select 'deck_stats'::text, p, public.refresh_gold_deck_stats(p);
    end loop;
end;
$fn$;

-- Writing gold is a job: only the secret key, which authenticates as
-- service_role, may run one. Supabase's default privileges grant every new
-- function in public to anon and authenticated, so those are revoked by name.
revoke all on function public.refresh_gold_periods(date)       from public, anon, authenticated;
revoke all on function public.refresh_gold_decks()             from public, anon, authenticated;
revoke all on function public.refresh_gold_matchup_stats(text) from public, anon, authenticated;
revoke all on function public.refresh_gold_deck_stats(text)    from public, anon, authenticated;
revoke all on function public.refresh_gold(date)               from public, anon, authenticated;

grant execute on function public.refresh_gold_periods(date)       to service_role;
grant execute on function public.refresh_gold_decks()             to service_role;
grant execute on function public.refresh_gold_matchup_stats(text) to service_role;
grant execute on function public.refresh_gold_deck_stats(text)    to service_role;
grant execute on function public.refresh_gold(date)               to service_role;
