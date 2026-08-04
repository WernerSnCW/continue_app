-- Retained history for cloud backups.
--
-- `backups` holds exactly one row per user and every push overwrites it, so a
-- single bad write destroys the only copy that exists. That is not a
-- hypothetical: a restore running against a stale device overwrote a good
-- backup and it survived only because a copy had been taken by hand.
--
-- This keeps periodic snapshots alongside the live row, so recovery becomes
-- "restore an earlier version" rather than "it is gone".

create table if not exists public.backup_versions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  payload     jsonb       not null,
  game_count  integer     not null default 0,
  death_count integer     not null default 0,
  app_version text,
  -- What prompted the snapshot, so the restore list can explain itself.
  reason      text        not null default 'periodic',
  created_at  timestamptz not null default now()
);

create index if not exists backup_versions_user_created_idx
  on public.backup_versions (user_id, created_at desc);

alter table public.backup_versions enable row level security;

create policy "read own backup versions"
  on public.backup_versions for select
  using (auth.uid() = user_id);

create policy "create own backup versions"
  on public.backup_versions for insert
  with check (auth.uid() = user_id);

-- Deliberately no update or delete policy: a client can add history and read
-- it, but cannot rewrite or erase it. Pruning happens below, server side.

/*
 * Tiered retention, run after each insert.
 *
 *   - everything from the last 48 hours
 *   - the newest snapshot per day for 30 days
 *
 * Fine-grained where a mistake was probably just made, sparse further back
 * where the useful question is "what did this look like last week".
 */
create or replace function public.prune_backup_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.backup_versions v
  where v.user_id = new.user_id
    and v.created_at < now() - interval '48 hours'
    and v.id not in (
      select distinct on (date_trunc('day', b.created_at)) b.id
      from public.backup_versions b
      where b.user_id = new.user_id
        and b.created_at >= now() - interval '30 days'
      order by date_trunc('day', b.created_at), b.created_at desc
    );
  return null;
end;
$$;

drop trigger if exists prune_backup_versions_trigger on public.backup_versions;
create trigger prune_backup_versions_trigger
  after insert on public.backup_versions
  for each row execute function public.prune_backup_versions();

comment on table public.backup_versions is
  'Retained snapshots of a user backup. RLS: owner may read and append only.';
