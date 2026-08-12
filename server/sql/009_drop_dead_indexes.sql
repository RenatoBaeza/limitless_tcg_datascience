-- One-off disk reclaim, applied 2026-08-12.
--
-- The project sits at the 500 MB database budget, and deletes do not return
-- disk - Postgres keeps the pages for reuse. The lever, per the note at the
-- foot of sql/007_shrink.sql and sql/diagnostics_size.sql, is indexes that are
-- never read. pg_stat_user_indexes reported idx_scan = 0 for these three
-- since the last stats reset:
--
--   silver_pairings_loser_deck_idx   7160 kB   0 scans
--   silver_pairings_matchup_idx      5512 kB   0 scans
--   pairings_player1_idx             3888 kB   0 scans
--
--   total                          ~16.6 MB
--
-- silver_pairings_winner_deck_idx (11 scans) was left in place: non-zero is
-- a scan, and a deck-filtered matchup view is a plausible future consumer of
-- the pair. The two silver indexes are recreated by sql/005_silver.sql, so a
-- rebuild restores them; pairings_player1_idx is bronze, which nothing in this
-- repo recreates outside a migration, and it is dropped permanently.
--
-- Safe to re-run (drop index if exists).

drop index if exists public.silver_pairings_loser_deck_idx;

drop index if exists public.silver_pairings_matchup_idx;

drop index if exists public.pairings_player1_idx;
