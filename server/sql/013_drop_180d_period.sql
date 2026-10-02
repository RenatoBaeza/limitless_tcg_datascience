-- Drop the 180d period. Applied 2026-10-02. Safe to re-run.
--
-- With the retention window at six months (app/limitless.py RETAIN_MONTHS),
-- "last 180 days" and "all" were the same question asked twice: 2026-04-05 to
-- 2026-10-02 against 2026-04-02 to 2026-10-02, three days apart, and 11,424
-- matchup cells against 11,502. 'all' stays - it is the API's default, what
-- /coverage reports and the window gold_decks is built over, and it follows
-- RETAIN_MONTHS if that ever changes.
--
-- Deleting the gold_periods row cascades to its gold_deck_stats and
-- gold_matchup_stats rows, and app/gold.py refreshes only the periods the table
-- lists, so nothing re-creates them. Re-running sql/012_gold_finished.sql would
-- re-seed the row - run this file after it.
--
-- Before:  gold_periods 4   gold_matchup_stats 36,502   gold_deck_stats 1,158
-- Deleted: gold_periods 1   gold_matchup_stats 11,424   gold_deck_stats   301
-- After:   gold_periods 3   gold_matchup_stats 25,078   gold_deck_stats   857

delete from public.gold_periods where period = '180d';
