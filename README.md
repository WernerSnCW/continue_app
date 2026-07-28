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

## Branches

`dev` is the working branch. Don't commit directly to `main`.
