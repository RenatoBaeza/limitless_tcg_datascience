-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Renames the three ingest tables into the bronze layer. Nothing about their
-- shape changes - this is a relabelling of what was already the raw layer, so
-- that silver (sql/005_silver.sql) has an unambiguous name to derive from.
--
-- Note: keep semicolons out of comments in this file. The Supabase SQL editor
-- splits statements on semicolons without regard for comments, so one inside a
-- comment truncates the statement.
--
-- Re-runnable because of "alter table if exists": on a second run the old names
-- are already gone, so each rename degrades to a notice instead of an error.
--
-- Two things deliberately do NOT get the bronze_ prefix:
--
--   * Indexes, constraints and foreign keys. They follow their table
--     automatically and keep their old names. Renaming them would add a dozen
--     more statements that can half-apply, for a purely cosmetic gain.
--   * The ingest progress columns pairings_ingested_at / standings_ingested_at
--     and their _count siblings. They name a *resource*, not a table, and
--     app/ingest.py derives them from the resource for exactly that reason.

alter table if exists public.tournaments rename to bronze_tournaments;
alter table if exists public.pairings    rename to bronze_pairings;
alter table if exists public.standings   rename to bronze_standings;

-- Policies follow the rename too, but keep their old names, which is confusing
-- in the dashboard. Re-declare them.
drop policy if exists "tournaments_public_read" on public.bronze_tournaments;
drop policy if exists "pairings_public_read"    on public.bronze_pairings;
drop policy if exists "standings_public_read"   on public.bronze_standings;

alter table public.bronze_tournaments enable row level security;
alter table public.bronze_pairings    enable row level security;
alter table public.bronze_standings   enable row level security;

drop policy if exists "bronze_tournaments_public_read" on public.bronze_tournaments;
create policy "bronze_tournaments_public_read"
    on public.bronze_tournaments
    for select
    to anon, authenticated
    using (true);

drop policy if exists "bronze_pairings_public_read" on public.bronze_pairings;
create policy "bronze_pairings_public_read"
    on public.bronze_pairings
    for select
    to anon, authenticated
    using (true);

drop policy if exists "bronze_standings_public_read" on public.bronze_standings;
create policy "bronze_standings_public_read"
    on public.bronze_standings
    for select
    to anon, authenticated
    using (true);
