-- Reclaims disk without losing information.
--
-- Three independent changes, each safe to run on its own. Sections A and B are
-- unconditional wins. Section C depends on numbers only your database has, so
-- it is left commented out - read the note above it before running it.
--
-- Nothing here touches bronze. Bronze is the only layer that cannot be
-- regenerated from something else in the database, and re-fetching it costs
-- hours against the Limitless rate limit.


-- ---------------------------------------------------------------------------
-- A. Drop two columns nothing reads.
--
-- silver_pairings.winner_deck_name and loser_deck_name are written by the
-- silver refresh and read by no consumer - not refresh_gold_matchups, which
-- takes only winner_deck_id, loser_deck_id and is_tie, not the read functions,
-- not the API, not the client. gold_decks sources its display names from
-- silver_standings instead.
--
-- Both are functionally dependent on their deck_id, so a join against
-- gold_decks recovers them exactly. Two text columns over ~276k rows.
-- ---------------------------------------------------------------------------

alter table public.silver_pairings
    drop column if exists winner_deck_name,
    drop column if exists loser_deck_name;

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
         winner_deck_id, loser_deck_id, is_tie, refreshed_at)
    select m.id,
           m.tournament_id,
           m.phase,
           m.round,
           m.winner,
           m.loser,
           w.deck_id,
           l.deck_id,
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
        loser_deck_id    = excluded.loser_deck_id,
        is_tie           = excluded.is_tie,
        refreshed_at     = excluded.refreshed_at;

    get diagnostics n = row_count;
    return n;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- B. Replace the silver_standings table with a view.
--
-- refresh_silver_standings copied bronze_standings column for column - every
-- field passed straight through, with an inner join to silver_tournaments as a
-- referential filter and refreshed_at set to now(). No filtering, no
-- reshaping, no derived column. It cost 118k duplicated rows plus three
-- indexes to store what bronze already held.
--
-- As a view the duplication disappears and silver_standings can no longer
-- drift from bronze. The inner join is preserved so the row set stays exactly
-- what the table held, and refreshed_at is mapped onto bronze's ingested_at so
-- the column list is unchanged for every reader.
--
-- Only the gold refresh reads this relation - refresh_silver_pairings joins
-- bronze_standings directly and is unaffected.
--
-- security_invoker makes the view run with the caller's permissions, so the
-- existing bronze_standings public-read policy governs access rather than the
-- view owner's rights.
-- ---------------------------------------------------------------------------

drop function if exists public.refresh_silver_standings(text[]);
drop table if exists public.silver_standings;

create or replace view public.silver_standings
with (security_invoker = true) as
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
       b.ingested_at as refreshed_at
from public.bronze_standings b
join public.silver_tournaments t on t.id = b.tournament_id;

grant select on public.silver_standings to anon, authenticated;

-- refresh_silver() in 005_silver.sql still calls the function just dropped, so
-- it has to be restated without that step or a whole-database rebuild from a
-- SQL session fails on a function that no longer exists.
create or replace function public.refresh_silver(p_tournaments text[] default null)
returns table (step text, rows_written bigint)
language plpgsql
security invoker
set search_path = public
as $fn$
begin
    return query select 'silver_tournaments'::text, public.refresh_silver_tournaments(p_tournaments);
    return query select 'silver_pairings'::text,    public.refresh_silver_pairings(p_tournaments);
end;
$fn$;


-- ---------------------------------------------------------------------------
-- D. Keep bloat from returning.
--
-- The refreshes are full reconciles that rewrite every row on a six-hourly
-- schedule, so these tables generate dead tuples far faster than the 20%
-- default scale factor expects. Vacuuming at 2% instead keeps the churn from
-- accumulating between runs.
-- ---------------------------------------------------------------------------

alter table public.silver_pairings    set (autovacuum_vacuum_scale_factor = 0.02);
alter table public.silver_tournaments set (autovacuum_vacuum_scale_factor = 0.02);
alter table public.bronze_pairings    set (autovacuum_vacuum_scale_factor = 0.05);
alter table public.bronze_standings   set (autovacuum_vacuum_scale_factor = 0.05);


-- Unused indexes are deliberately not handled here. silver_pairings carries
-- six indexes plus a primary key over ~276k rows, which on text columns is
-- plausibly more space than the heap, but which of them are dead is a question
-- only pg_stat_user_indexes.idx_scan can answer. Dropping an index loses no
-- information and 005_silver.sql recreates any of them, so that is a safe
-- follow-up once the numbers are in.
