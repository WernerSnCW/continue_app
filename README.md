# Continue?

A death-tally tracker for Souls-likes. Count every death, per game, per run.

- **Free tier** — track up to 3 games.
- **Unlock ($1.99, one-time)** — unlimited games.
- **Run tracking** — NG, NG+, NG++ and beyond, counted separately.
- **Global average** — see how your death count compares to everyone else's.

This is a deliberately lightweight, **standalone** repo. It is not part of any
monorepo, and it isn't meant to become one. Three workspace packages, shared
types, no build orchestration layer, no code generation. Keep it that way
unless there's a concrete reason not to.

## Structure

```
apps/mobile             React + TypeScript (Vite), wrapped with Capacitor for Android
services/continue-api   Supabase project — Edge Functions (IGDB token exchange,
                        global-average sync)
packages/shared         Shared TypeScript types (Game, RunType, DeathEntry, ...)
```

`packages/shared` is consumed as source (`main` points at `src/index.ts`), so
there's no build step between editing a type and using it — Vite and Deno both
read the TypeScript directly.

## Getting started

```bash
pnpm install
```

Run the app in a browser:

```bash
pnpm dev
```

## Android

Capacitor is configured (`apps/mobile/capacitor.config.ts`) but the native
project hasn't been generated yet. When it's time:

```bash
pnpm --filter @continue/mobile build
pnpm --filter @continue/mobile cap:add:android
pnpm --filter @continue/mobile cap:sync
```

`apps/mobile/android/` is gitignored — it's regenerated from config, not
hand-edited.

## Environment

Copy `.env.example` to `.env` and fill in the values.

| Key | Used by | Notes |
| --- | --- | --- |
| `TWITCH_CLIENT_ID` | Edge Function | IGDB auth goes through Twitch OAuth |
| `TWITCH_CLIENT_SECRET` | Edge Function | Server-side only |
| `SUPABASE_URL` | app + functions | |
| `SUPABASE_ANON_KEY` | app | Safe to ship in the client |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function | **Never** ship to the client |

Once `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are filled in, confirm they
work before writing any code against IGDB:

```bash
node scripts/check-igdb.mjs
```

## IGDB data layer

Two Edge Functions in `services/continue-api/supabase/functions`:

| Function | Purpose |
| --- | --- |
| `igdb-token` | Returns a valid IGDB bearer token. Exchanges via Twitch `client_credentials` only when the cached token is missing or within 24h of expiry — never per request. |
| `igdb-search` | Game search for the picker. Uses the token server-side (never exposes it) and collapses editions onto canonical ids. |

The token is cached in `public.igdb_token_cache`, a single-row table with RLS
on and no policies — service role only. Credentials live in Supabase secrets,
not in the repo:

```bash
supabase secrets set TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=...
```

**Why editions are collapsed:** IGDB lists every retail edition as its own row
with its own id (Deluxe, Collector's, Launch...). If the picker offered those,
death counts for one game would fragment across several ids and the global
average would be meaningless. Rows carrying `version_parent` collapse onto that
parent; rows without one stay distinct. `game_type` then filters out DLC,
expansions, bundles, mods and ports — remakes and remasters are kept on purpose,
since Demon's Souls (2020) is its own playthrough.

Verify the collapse rule against live IGDB:

```bash
node scripts/check-igdb-search.mjs
```

## Branches

`dev` is the working branch. Don't commit directly to `main`.
