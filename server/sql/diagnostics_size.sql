-- Read-only. Nothing here writes, so it is safe to run against production at
-- any time. This is not a migration and is not part of the numbered sequence.
--
-- Answers "what is actually using the disk", which the numbered migrations
-- cannot: deleting rows does not shrink a Postgres database. Dead tuples are
-- reused in place, so row counts and disk size drift apart, and the gap is
-- only closed by a rewrite.
--
-- Run the two queries ONE AT A TIME. The Supabase SQL editor splits on
-- semicolons and shows only the last result set, so pasting the whole file
-- returns query 2 and silently discards query 1.


-- ---------------------------------------------------------------------------
-- 1. Size per table, heap versus indexes, with dead-tuple counts.
--
-- indexes > heap means the row data is not the problem and index pruning is
-- the lever. A large n_dead_tup means a vacuum full would reclaim real space.
-- ---------------------------------------------------------------------------

select c.relname                                          as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid))      as total,
       pg_size_pretty(pg_table_size(c.oid))               as heap,
       pg_size_pretty(pg_indexes_size(c.oid))             as indexes,
       s.n_live_tup                                       as live_rows,
       s.n_dead_tup                                       as dead_rows
from pg_class c
join pg_namespace ns on ns.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where ns.nspname = 'public'
  and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;


-- ---------------------------------------------------------------------------
-- 2. Index size against how often each index is actually used.
--
-- sql/007_shrink.sql left this open deliberately: silver_pairings carries six
-- indexes plus a primary key over ~293k rows of text columns, which is
-- plausibly more space than the heap it indexes, but which of them are dead is
-- a question only idx_scan can answer.
--
-- idx_scan = 0 means the index has not been read since the last stats reset.
-- Dropping one loses no information - sql/005_silver.sql and sql/006_gold.sql
-- recreate every index they declare - so this is a safe, reversible win.
--
-- Primary keys and unique constraints will show up here too. Do not drop
-- those: they enforce the upsert conflict targets the whole pipeline relies
-- on, whatever their scan count says.
-- ---------------------------------------------------------------------------

select relname                                       as table_name,
       indexrelname                                  as index_name,
       idx_scan                                      as scans,
       pg_size_pretty(pg_relation_size(indexrelid))  as size
from pg_stat_user_indexes
where schemaname = 'public'
order by pg_relation_size(indexrelid) desc;
