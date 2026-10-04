-- Gold for the fixed view: six periods, no 'other'. Safe to re-run.
--
-- The frontend stopped offering the knobs that gold was computed to answer.
-- The matrix is always the top 50 decks, every cell with at least one match is
-- drawn, and 'other' is never shown. The only choice left to a reader is the
-- period, and there are now six of them:
--
--   3d  7d  30d  60d  90d  all
--
-- Three things change here:
--
--   * gold_periods gains 3d, 7d and 60d. Every period is resolved by the same
--     arithmetic as before (sql/012_gold_finished.sql): N days back from the
--     last event, clamped to the retention cutoff.
--
--   * 'other' leaves gold entirely. It was kept as both variants of
--     gold_deck_stats (include_other true and false) so a reader could flip it.
--     Nothing flips it now, so the include_other column is dropped, the key
--     becomes (period, deck_id), and every refresh skips 'other' at the source:
--     a match against it is not counted in either deck's record, it holds no
--     rank and no share of the field, and it has no matchup cells. The period
--     totals on gold_periods follow suit - entries, decks, tournaments and
--     matches all leave it out, so a total still agrees with the table beside
--     it.
--
--   * The rank index loses include_other with it: (period, rank).
--
-- Nothing is truncated: the include_other = false half of gold_deck_stats was
-- already ranked without 'other', so it survives as the new table, and the
-- 'other' rows and cells are deleted. The new periods are empty until the next
-- refresh, which is run straight after applying this (see the bottom).
--
-- Applied 2026-10-04 to a gold layer holding
--
--   gold_periods 3   gold_deck_stats 855   gold_matchup_stats 27,116
--   gold_decks 151
--
-- of which this deletes: gold_deck_stats 429 (the whole include_other = true
-- half - the false half held no 'other' row), gold_matchup_stats 764 (every
-- cell with 'other' on either side), gold_decks 1.
--
-- and after refresh_gold('2026-04-04'):
--
--   gold_periods 6   gold_decks 150   gold_deck_stats 761
--   gold_matchup_stats 39,438
--
--   period  from        to          tournaments  matches  decks  top-50 cells
--   3d      2026-10-01  2026-10-04           41    4,221     89         1,568
--   7d      2026-09-27  2026-10-04           86   10,334    105         1,994
--   30d     2026-09-04  2026-10-04          364   48,961    131         2,358
--   60d     2026-08-05  2026-10-04          697  103,117    141         2,426
--   90d     2026-07-06  2026-10-04        1,027  144,827    145         2,438
--   all     2026-04-04  2026-10-04        1,959  260,426    150         2,444
--
-- "top-50 cells" is what the matrix reads: at most 50 x 49 = 2,450.
--
-- Still the slowest calls, measured warm with explain analyze:
-- refresh_gold_matchup_stats('all') 1.8s, refresh_gold_deck_stats('all') 1.5s,
-- against the 8s PostgREST budget. The first cold run of the matchups call took
-- ~5.7s, so a cold cache still costs real time here. Six periods means twelve
-- per-period RPCs instead of six, each under the budget on its own.

insert into public.gold_periods (period, days) values
    ('3d', 3),
    ('7d', 7),
    ('30d', 30),
    ('60d', 60),
    ('90d', 90),
    ('all', null)
on conflict (period) do update set days = excluded.days;

-- Keep the half that was already ranked without 'other', then drop the column.
-- Guarded, so a re-run after the column is gone is a no-op.
do $do$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'gold_deck_stats'
          and column_name = 'include_other'
    ) then
        delete from public.gold_deck_stats where include_other;
        alter table public.gold_deck_stats drop constraint if exists gold_deck_stats_pkey;
        drop index if exists public.gold_deck_stats_rank_idx;
        alter table public.gold_deck_stats drop column include_other;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.gold_deck_stats'::regclass and contype = 'p'
    ) then
        alter table public.gold_deck_stats add primary key (period, deck_id);
    end if;
end;
$do$;

-- The deck list and the matrix axis both read "the top N by rank".
create unique index if not exists gold_deck_stats_rank_idx
    on public.gold_deck_stats (period, rank);

delete from public.gold_deck_stats    where deck_id = 'other';
delete from public.gold_matchup_stats where deck_a = 'other' or deck_b = 'other';
delete from public.gold_decks         where deck_id = 'other';

-- The last event is the latest tournament with a counted match, and a counted
-- match now also needs neither side to be 'other'.
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
            and s.winner_deck_id <> 'other'
            and s.loser_deck_id <> 'other'
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
            and s.winner_deck_id <> 'other'
            and s.loser_deck_id <> 'other'
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
          and s.deck_id <> 'other'
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
    with counted as (
        select s.winner_deck_id, s.loser_deck_id, s.is_tie
        from public.silver_pairings s
        join public.silver_tournaments t on t.id = s.tournament_id
        where t.date between v_from and v_to
          and s.winner_deck_id is not null
          and s.loser_deck_id is not null
          and s.winner_deck_id <> s.loser_deck_id
          and s.winner_deck_id <> 'other'
          and s.loser_deck_id <> 'other'
    )
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
            select k.winner_deck_id as deck_a,
                   k.loser_deck_id  as deck_b,
                   case when k.is_tie then 0 else 1 end as outcome
            from counted k
            union all
            select k.loser_deck_id  as deck_a,
                   k.winner_deck_id as deck_b,
                   case when k.is_tie then 0 else -1 end as outcome
            from counted k
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

-- One ranking per period now, over every deck but 'other'. Entries are still
-- grouped by (tournament, deck) before they are rolled up by deck, for the
-- reason recorded in sql/012_gold_finished.sql (a distinct count spilled to disk).
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
        (period, deck_id, rank, deck_name, entries, tournaments,
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
              and s.deck_id <> 'other'
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
          and s.winner_deck_id <> 'other'
        group by s.winner_deck_id
    ),
    records as (
        select m.deck_a            as deck_id,
               sum(m.matches)::int as matches,
               sum(m.wins)::int    as wins,
               sum(m.losses)::int  as losses,
               sum(m.ties)::int    as ties
        from public.gold_matchup_stats m
        where m.period = p_period
        group by m.deck_a
    ),
    ranked as (
        select en.deck_id,
               en.entries,
               en.tournaments,
               en.champions,
               en.top8,
               sum(en.entries) over () as total_entries,
               row_number() over (order by en.entries desc, en.deck_id) as rank
        from entered en
    )
    select p_period,
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
    left join records rc on rc.deck_id = r.deck_id
    left join mirrors mi on mi.deck_id = r.deck_id
    left join lateral (
        select public.wilson_interval(rc.wins + rc.ties / 2.0, rc.matches) as bounds
    ) ci on true;

    get diagnostics n = row_count;

    update public.gold_periods g
    set entries = (
            select coalesce(sum(d.entries), 0)
            from public.gold_deck_stats d
            where d.period = p_period
        ),
        decks = (
            select count(*)
            from public.gold_deck_stats d
            where d.period = p_period
        ),
        tournaments = (
            select count(*)
            from public.silver_tournaments t
            where t.date between v_from and v_to
              and exists (
                  select 1 from public.silver_standings s
                  where s.tournament_id = t.id
                    and s.deck_id is not null
                    and s.deck_id <> 'other'
              )
        )
    where g.period = p_period;

    return n;
end;
$fn$;

-- create or replace keeps a function's grants, but restating them makes this
-- file correct on its own.
revoke all on function public.refresh_gold_periods(date)       from public, anon, authenticated;
revoke all on function public.refresh_gold_decks()             from public, anon, authenticated;
revoke all on function public.refresh_gold_matchup_stats(text) from public, anon, authenticated;
revoke all on function public.refresh_gold_deck_stats(text)    from public, anon, authenticated;

grant execute on function public.refresh_gold_periods(date)       to service_role;
grant execute on function public.refresh_gold_decks()             to service_role;
grant execute on function public.refresh_gold_matchup_stats(text) to service_role;
grant execute on function public.refresh_gold_deck_stats(text)    to service_role;
