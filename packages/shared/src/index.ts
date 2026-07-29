/**
 * Shared domain types for Continue?
 *
 * Consumed by both the mobile app and the Supabase Edge Functions, so keep
 * this free of runtime dependencies — types and plain constants only.
 */

/** ISO-8601 timestamp, e.g. "2026-07-28T13:41:00.000Z". */
export type IsoTimestamp = string;

/** How many games the free tier can track before the unlock is required. */
export const FREE_TIER_GAME_LIMIT = 3;

/** A run through a game. NG+ cycles beyond the second are tracked by `cycle`. */
export type RunType = 'ng' | 'ng+' | 'ng++';

export interface Game {
  id: string;
  /** IGDB game id, if the game was matched from IGDB rather than added by hand. */
  igdbId: number | null;
  name: string;
  coverUrl: string | null;
  /** Free-text platform label, e.g. "PS5". Null when the user didn't specify. */
  platform: string | null;
  addedAt: IsoTimestamp;
  /**
   * Archived games stop counting toward the free-tier slot limit and drop off
   * the home screen, but their Runs and DeathEntrys are kept. Archiving is
   * never a delete — restoring is a paid feature.
   */
  archived: boolean;
}

export interface Run {
  id: string;
  gameId: string;
  runType: RunType;
  /**
   * NG+ cycle number: 0 for a first playthrough, 1 for NG+, 2 for NG++, and so
   * on. `runType` caps out at 'ng++' for display; this keeps counting.
   */
  cycle: number;
  startedAt: IsoTimestamp;
  /** Null while the run is still in progress. */
  completedAt: IsoTimestamp | null;
  /**
   * Accumulated play time in seconds, from the counter screen's session timer.
   * Only time the user actually clocked in counts — the difficulty ranking
   * needs deaths-per-hour, so a run with 0 here is unrankable rather than
   * infinitely hard.
   */
  playedSeconds: number;
}

export interface DeathEntry {
  id: string;
  gameId: string;
  runId: string;
  diedAt: IsoTimestamp;
  /**
   * How many seconds into the run's logged play time this death happened,
   * giving an ordered timeline within the run. Null when the session timer
   * wasn't running — the death still counts, it just can't be placed on the
   * timeline.
   */
  runSeconds: number | null;
  /** What killed you, when the user bothers to record it. */
  bossName: string | null;
  location: string | null;
  note: string | null;
}

/** Per-game death totals for the local user. */
export interface GameStats {
  gameId: string;
  totalDeaths: number;
  deathsByRun: Record<string, number>;
  currentRunId: string | null;
}

/** Community death average for a game, synced down from the API. */
export interface GlobalAverage {
  igdbId: number;
  averageDeaths: number;
  /** Number of players contributing to this average. */
  sampleSize: number;
  updatedAt: IsoTimestamp;
}

/** Local entitlement state — the $1.99 one-time unlock. */
export interface Entitlement {
  unlimitedGames: boolean;
  /** Null on the free tier; set once the unlock purchase is verified. */
  purchasedAt: IsoTimestamp | null;
}

// --- IGDB ------------------------------------------------------------------

/** Shape returned by the token-exchange Edge Function. */
export interface IgdbTokenResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: 'bearer';
}

/** Trimmed IGDB search result — only the fields the app actually renders. */
export interface IgdbSearchResult {
  id: number;
  name: string;
  coverUrl: string | null;
  firstReleaseYear: number | null;
}
