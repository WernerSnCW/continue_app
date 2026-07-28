-- Cache for the IGDB (Twitch) app access token.
--
-- Twitch client_credentials tokens live ~60 days and the token endpoint is
-- rate limited, so we exchange once and reuse until close to expiry rather
-- than exchanging per request.
--
-- Single row, enforced by the id = 1 check constraint.

create table if not exists public.igdb_token_cache (
  id           smallint     primary key default 1,
  access_token text         not null,
  expires_at   timestamptz  not null,
  updated_at   timestamptz  not null default now(),
  constraint igdb_token_cache_singleton check (id = 1)
);

-- RLS on with no policies: anon and authenticated get nothing. Only the
-- service role (which bypasses RLS) can read or write, and only Edge
-- Functions hold that key.
alter table public.igdb_token_cache enable row level security;

revoke all on public.igdb_token_cache from anon, authenticated;

comment on table public.igdb_token_cache is
  'Single-row cache of the Twitch/IGDB app access token. Service-role access only.';
