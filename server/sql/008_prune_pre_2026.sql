-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Narrows the dataset to 2026 and later.
--
-- Note: keep semicolons out of comments in this file. The Supabase SQL editor
-- splits statements on semicolons without regard for comments, so one inside a
-- comment truncates the statement.
--
-- This has already been applied through PostgREST, so on a fresh run against
-- the live database every statement below is a no-op. It is kept because it is
-- the only durable record of the cutoff, and because a rebuilt database needs
-- it. The matching ingest-side gate is limitless.MIN_TOURNAMENT_DATE, which
-- stops out-of-window events being re-added by the six-hourly run.
--
-- Both deletes lean on the foreign keys rather than naming the child tables:
--
--   bronze_tournaments  cascades to bronze_pairings and bronze_standings
--   silver_tournaments  cascades to silver_pairings, gold_deck_events and
--                       gold_matchups
--
-- Silver goes first only so the gold facts are gone before their roll-up is
-- recomputed at the end. The two trees are independent - silver_tournaments
-- carries no foreign key onto bronze - so the order is not load-bearing beyond
-- that.
--
-- What this removed on the live database, 2026-08-12:
--
--   bronze_tournaments      2248 ->   2230   (-18)
--   bronze_pairings       328442 -> 322636   (-5806)
--   bronze_standings      133688 -> 131486   (-2202)
--   silver_tournaments      2248 ->   2230   (-18)
--   silver_pairings       298224 -> 292664   (-5560)
--   gold_matchups         354854 -> 348966   (-5888)
--   gold_deck_events       48044 ->  47421   (-623)
--   gold_decks               211 ->    210   (-1)
--
-- That is ~1.7% of the row count, because the Limitless tournament list only
-- reaches back to 2025-12-27 in the first place. This bounds the dataset, but
-- it is not a fix for a full database - see the diagnostic at the foot of this
-- file for where the space actually goes.

delete from public.silver_tournaments where date < date '2026-01-01';

delete from public.bronze_tournaments where date < timestamptz '2026-01-01 00:00+00';

-- gold_decks is keyed on deck, not tournament, so no cascade reaches it. It is
-- an all-time roll-up of the two fact tables and has to be recomputed whole or
-- it keeps counting the matches just deleted.
select public.refresh_gold_decks();


-- Note on what this does NOT achieve: deleting rows does not return disk to
-- the operating system. Postgres marks the tuples dead and reuses the pages
-- for later writes, so a delete this size does not move the reported database
-- size at all. Only a rewrite - vacuum full, which takes an exclusive lock -
-- gives the space back.
--
-- For where the space actually goes, run sql/diagnostics_size.sql. It is
-- read-only and deliberately kept out of this file: comments cannot be
-- executed, so a diagnostic pasted in as a comment silently returns nothing.
