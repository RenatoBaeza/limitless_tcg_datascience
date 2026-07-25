-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: everything is idempotent.

create table if not exists public.tournaments (
    id           text primary key,          -- Limitless tournament id
    name         text        not null,
    date         timestamptz not null,
    game         text        not null,
    format       text        not null,
    players      integer     not null,
    organizer_id integer,
    ingested_at  timestamptz not null default now()
);

create index if not exists tournaments_date_idx on public.tournaments (date desc);
create index if not exists tournaments_game_format_idx on public.tournaments (game, format);

alter table public.tournaments enable row level security;

-- Read-only access for the publishable/anon key. Writes go through the secret
-- key, which bypasses RLS.
drop policy if exists "tournaments_public_read" on public.tournaments;
create policy "tournaments_public_read"
    on public.tournaments
    for select
    to anon, authenticated
    using (true);
