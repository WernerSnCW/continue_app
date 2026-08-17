-- Feature suggestions from players.
--
-- A private inbox, not a public roadmap: nobody but the developer ever reads
-- these, and no reply is promised. That shapes the schema — there is no status
-- column, no voting, no threading. If any of that is ever wanted it can be
-- added; guessing at it now would be building a support desk nobody asked for.
--
-- No email address is captured. Somebody who wants a reply can write to
-- contact@quietfoundry.io, and not collecting a contact detail we would not use
-- is one less thing to disclose and one less thing to delete.

create table if not exists public.suggestions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  body        text        not null,
  -- Which build it came from, so a suggestion that is really a bug report about
  -- an old version can be recognised as one.
  app_version text,
  created_at  timestamptz not null default now(),

  -- Four characters rejects an accidental submit; 2000 is far more than anyone
  -- types on a phone and stops the table being used as storage.
  constraint suggestions_body_length check (char_length(body) between 4 and 2000)
);

create index if not exists suggestions_created_idx
  on public.suggestions (created_at desc);

alter table public.suggestions enable row level security;

-- Insert only. Deliberately no select policy: a player has no reason to read
-- anybody's suggestions, including their own, and granting select here would
-- turn a private inbox into a public one the moment the anon key is inspected.
-- The developer reads these with the service role.
create policy "submit own suggestion"
  on public.suggestions for insert
  with check (auth.uid() = user_id);

-- No update or delete policy either: a suggestion is a sent message.

/*
 * Caps submissions per account per day.
 *
 * Cheap insurance rather than a real anti-abuse system. Anonymous accounts are
 * free to create, so a determined actor can still get around this — the point
 * is that one bored player with a held-down send button cannot fill the table.
 *
 * `security definer` because the inserting user cannot select from this table,
 * so the count has to run with elevated rights.
 */
create or replace function public.limit_suggestion_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  select count(*) into recent
  from public.suggestions
  where user_id = new.user_id
    and created_at > now() - interval '24 hours';

  if recent >= 10 then
    raise exception 'Too many suggestions from this account in 24 hours';
  end if;

  return new;
end;
$$;

drop trigger if exists limit_suggestion_rate_trigger on public.suggestions;
create trigger limit_suggestion_rate_trigger
  before insert on public.suggestions
  for each row execute function public.limit_suggestion_rate();

comment on table public.suggestions is
  'Player feature suggestions. RLS: owner may insert only; nobody may read via the anon key.';
