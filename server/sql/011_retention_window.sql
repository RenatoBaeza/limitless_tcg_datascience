-- The retention window, applied 2026-08-12. Safe to re-run.
--
-- Two independent changes under one roof because they are the same policy: the
-- dataset is a rolling window, so the derived layers must both stop churning
-- dead tuples between prunes (autovacuum) and actually shed the rows the window
-- excludes (prune_derived_before).
--
-- The window itself is enforced in the app, not here: app/silver.py and
-- app/gold.py enumerate only tournaments inside app/limitless.RETAIN_MONTHS,
-- so the refreshes never re-add what the prune removed, and
-- scripts/prune_window.py computes the same cutoff and calls the function
-- below. This file only provides the primitives.
--
-- Why the gold tables needed autovacuum tuning: sql/007_shrink.sql set
-- autovacuum_vacuum_scale_factor = 0.02 on silver and bronze, but the gold
-- tables were missed. They are fully rewritten every six hours by the refresh,
-- which makes them the worst churn in the database - gold_matchups alone was
-- carrying 58,824 dead tuples (17% of the table) on 2026-08-12, because the
-- default 20% scale factor meant autovacuum never fired. From 2% onward the
-- churn is reclaimed between runs instead of accumulating.
--
-- prune_derived_before deletes the tournaments the window excludes from the
-- derived layers. Bronze is deliberately not touched: it is the only layer
-- that costs API time to rebuild, so it holds everything within
-- MIN_TOURNAMENT_DATE, and the window is only a question about what is worth
-- keeping derived. The deletes lean on the cascades:
--
--   silver_tournaments  cascades to silver_pairings, gold_deck_events and
--                       gold_matchups
--
-- gold_decks is keyed on deck, not tournament, so no cascade reaches it. It is
-- an all-time roll-up of the two fact tables and has to be recomputed whole or
-- it keeps counting matches just deleted. The roll-up is a separate call -
-- scripts/prune_window.py runs public.refresh_gold_decks() after this - because
-- the delete and a full re-roll together blow the PostgREST statement timeout.
-- refresh_gold_decks() also prunes decks that no longer appear in the window,
-- which is what keeps gold_decks (and the sprite index) bounded.
--
-- Rows deleted here are deleted for good - nothing in this repo restores them
-- except a re-run of the ingests, and the app-side window means the refreshes
-- will not. That is the point of a retention policy. See
-- sql/008_prune_pre_2026.sql for the same trade, made once.

alter table public.gold_matchups     set (autovacuum_vacuum_scale_factor = 0.02);
alter table public.gold_deck_events  set (autovacuum_vacuum_scale_factor = 0.02);
alter table public.gold_decks        set (autovacuum_vacuum_scale_factor = 0.02);

create or replace function public.prune_derived_before(p_cutoff date)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
    n bigint;
begin
    delete from public.silver_tournaments s
    where s.date < p_cutoff;

    get diagnostics n = row_count;
    return n;
end;
$fn$;

-- Same as the refresh functions: pruning is a job, so only the secret key
-- (service_role) may kick one off.
revoke all on function public.prune_derived_before(date) from public;

grant execute on function public.prune_derived_before(date) to service_role;
