-- Cloud backup of a player's local state.
--
-- One row per user holding the whole app state as JSONB, rather than a
-- normalised games/runs/deaths schema. Reasons:
--
--   * The app is local-first and offline-capable, so the phone is always the
--     source of truth. A snapshot restores with perfect fidelity and needs no
--     row-level conflict resolution.
--   * The shape of the local state is still moving. A snapshot absorbs schema
--     changes without a migration every time a field is added.
--
-- The global average will need real aggregate columns, but that reads
-- per-game totals across users, not one player's history — it gets its own
-- table when it's built rather than distorting this one now.

create table if not exists public.backups (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  payload     jsonb       not null,
  app_version text,
  -- Cheap sanity figures, so a backup can be described without parsing the
  -- payload and without a second round trip.
  game_count  integer     not null default 0,
  death_count integer     not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.backups enable row level security;

-- A user can only ever see or write their own row. There is no shared read
-- path here at all; the anon key alone grants nothing without a session.
create policy "read own backup"
  on public.backups for select
  using (auth.uid() = user_id);

create policy "create own backup"
  on public.backups for insert
  with check (auth.uid() = user_id);

create policy "update own backup"
  on public.backups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.backups is
  'Per-user snapshot of local app state. RLS: owner only.';
