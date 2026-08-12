-- One-off disk reclaim, applied 2026-08-12. Follow-up to 009_drop_dead_indexes.
--
-- The project sits at the 500 MB database budget. The zero-scan indexes went in
-- sql/009_drop_dead_indexes.sql; these four are the next tranche - non-zero but
-- negligible scans since the last stats reset, on text columns no planner
-- reachable from this app's query patterns ever filters by:
--
--   silver_pairings_winner_deck_idx   7160 kB   11 scans
--   silver_pairings_loser_idx         5064 kB    7 scans
--   bronze_pairings_player2_idx       3928 kB    9 scans
--   gold_decks_entries_idx               16 kB   0 scans
--
--   total                          ~16.2 MB
--
-- The two silver_pairings indexes are recreated by sql/005_silver.sql on a
-- rebuild. bronze_pairings_player2_idx is bronze - nothing in this repo
-- recreates it outside a migration - and gold_decks_entries_idx is declared in
-- sql/006_gold.sql, so both return with a rebuild. None back a primary key or
-- an upsert conflict target.
--
-- Safe to re-run (drop index if exists).

drop index if exists public.silver_pairings_winner_deck_idx;

drop index if exists public.silver_pairings_loser_idx;

drop index if exists public.bronze_pairings_player2_idx;

drop index if exists public.gold_decks_entries_idx;
