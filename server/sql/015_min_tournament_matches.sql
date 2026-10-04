-- A minimum number of matches before a tournament counts in gold. Safe to re-run.
--
-- A tournament's matches are its silver_pairings rows: real head-to-heads,
-- byes and unpaired players already dropped by silver, ties and unknown decks
-- still in. Below the threshold a tournament is left out of every gold number
-- at once - its standings add no entries, rank or meta share, its pairings add
-- no matchup cells, it is not counted in a period's totals, and it cannot be
-- the "last event" a period counts back from. Leaving it out of one table but
-- not another would let the deck table and the matrix disagree.
--
-- Two kinds of event fall under it. Genuinely tiny ones (a 4-player local plays
-- 4-6 matches), and events whose pairings are incomplete - Limitless lists
-- 30-player events with fewer than 5 matches recorded, whose standings would
-- otherwise count in full against a handful of matches.
--
-- The threshold is a parameter of refresh_gold_periods, defaulted and
-- overridable in app/gold.py (MIN_TOURNAMENT_MATCHES, --min-matches). It is
-- written onto every gold_periods row, where every later step reads it beside
-- the dates, so one refresh cannot mix two thresholds and the API can say
-- which one the numbers were computed under. 0 counts every tournament, which
-- is the behaviour before this file.
--
-- gold_tournaments() is the one place the rule lives. It is a plain SQL
-- function so the planner inlines it into each caller - which is also why it
-- carries no "set search_path" (that clause blocks inlining) and qualifies
-- every name instead. The security advisor flags it for that
-- (function_search_path_mutable). That is expected: every name in it is
-- qualified, and only service_role can execute it.
--
-- Measured against the 'all' period before applying (2,205 tournaments,
-- 303,336 matches):
--
--   min_matches  tournaments left out  matches left out
--             5                    31                54
--            10                   199             1,299
--            20                   474             5,230
--            30                   732            11,358
--
-- Applied 2026-10-04, then refresh_gold with min_matches 10:
--
--   period  tournaments        matches           entries
--   3d           41 ->    38     4,221 ->   4,209    2,010
--   7d           86 ->    81    10,334 ->  10,313    4,897
--   30d         364 ->   346    48,961 ->  48,873   22,939
--   60d         697 ->   661   103,117 -> 102,930   47,168
--   90d       1,027 ->   958   144,827 -> 144,465   66,632
--   all       1,959 -> 1,823   260,426 -> 259,730  119,673
--
-- (Fewer tournaments drop out than the table above suggests because many of
-- the 199 already counted for nothing - no deck on any standing.) Deck counts
-- per period are unchanged. refresh_gold_matchup_stats('all') still runs in
-- 1.9s warm, so the per-tournament match count costs nothing measurable.

alter table public.gold_periods
    add column if not exists min_matches integer not null default 0
    check (min_matches >= 0);

create or replace function public.gold_tournaments(
    p_from date,
    p_to date,
    p_min_matches integer
)
returns table (id text, date date)
language sql
stable
security invoker
as $fn$
    select t.id, t.date
    from public.silver_tournaments t
    where (p_from is null or t.date >= p_from)
      and (p_to is null or t.date <= p_to)
      and (
          coalesce(p_min_matches, 0) <= 0
          or (
              select count(*)
              from public.silver_pairings s
              where s.tournament_id = t.id
          ) >= p_min_matches
      )
$fn$;

-- The signature grows a parameter, so the old one has to go or PostgREST would
-- have two candidates for a call naming only p_since.
drop function if exists public.refresh_gold_periods(date);

create or replace function public.refresh_gold_periods(
    p_since date default null,
    p_min_matches integer default 0
)
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
    from public.gold_tournaments(p_since, null, p_min_matches) t
    where exists (
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
    from public.gold_tournaments(p_since, null, p_min_matches) t
    where exists (
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
        min_matches  = greatest(coalesce(p_min_matches, 0), 0),
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
        from public.gold_periods p
        cross join lateral public.gold_tournaments(p.date_from, p.date_to, p.min_matches) t
        join public.silver_standings s on s.tournament_id = t.id
        where p.period = 'all'
          and s.deck_id is not null
          and s.deck_id <> 'other'
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
    v_min integer;
begin
    select p.date_from, p.date_to, p.min_matches into v_from, v_to, v_min
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
        join public.gold_tournaments(v_from, v_to, v_min) t on t.id = s.tournament_id
        where s.winner_deck_id is not null
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
    v_min integer;
begin
    select p.date_from, p.date_to, p.min_matches into v_from, v_to, v_min
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
    with eligible as (
        select t.id from public.gold_tournaments(v_from, v_to, v_min) t
    ),
    entered as (
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
            join eligible t on t.id = s.tournament_id
            where s.deck_id is not null
              and s.deck_id <> 'other'
            group by s.tournament_id, s.deck_id
        ) x
        group by x.deck_id
    ),
    mirrors as (
        select s.winner_deck_id as deck_id, count(*)::int as mirror_matches
        from public.silver_pairings s
        join eligible t on t.id = s.tournament_id
        where s.winner_deck_id = s.loser_deck_id
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
            from public.gold_tournaments(v_from, v_to, v_min) t
            where exists (
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

revoke all on function public.gold_tournaments(date, date, integer)      from public, anon, authenticated;
revoke all on function public.refresh_gold_periods(date, integer)        from public, anon, authenticated;
revoke all on function public.refresh_gold_decks()                       from public, anon, authenticated;
revoke all on function public.refresh_gold_matchup_stats(text)           from public, anon, authenticated;
revoke all on function public.refresh_gold_deck_stats(text)              from public, anon, authenticated;

grant execute on function public.gold_tournaments(date, date, integer)   to service_role;
grant execute on function public.refresh_gold_periods(date, integer)     to service_role;
grant execute on function public.refresh_gold_decks()                    to service_role;
grant execute on function public.refresh_gold_matchup_stats(text)        to service_role;
grant execute on function public.refresh_gold_deck_stats(text)           to service_role;
