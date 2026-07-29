/**
 * Local persistence. localStorage for now — swappable for Capacitor
 * Preferences when the native wrapper exists, since everything goes through
 * load()/save().
 */
import type { DeathEntry, Entitlement, Game, Run, RunType } from '@continue/shared';

const KEY = 'continue.state.v1';

export interface AppState {
  games: Game[];
  runs: Run[];
  deaths: DeathEntry[];
  entitlement: Entitlement;
}

export const emptyState = (): AppState => ({
  games: [],
  runs: [],
  deaths: [],
  entitlement: { unlimitedGames: false, purchasedAt: null },
});

/** Older saved states predate `archived` / `playedSeconds`; fill them in. */
function migrate(raw: AppState): AppState {
  return {
    ...emptyState(),
    ...raw,
    games: (raw.games ?? []).map((g) => ({ ...g, archived: g.archived ?? false })),
    runs: (raw.runs ?? []).map((r) => ({
      ...r,
      playedSeconds: r.playedSeconds ?? 0,
      archived: r.archived ?? false,
    })),
    deaths: (raw.deaths ?? []).map((d) => ({ ...d, runSeconds: d.runSeconds ?? null })),
  };
}

export function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return migrate(JSON.parse(raw) as AppState);
  } catch {
    // Corrupt state shouldn't brick the app — start clean rather than crash.
    return emptyState();
  }
}

export function save(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode failures are non-fatal; the in-memory state stands.
  }
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export const runTypeForCycle = (cycle: number): RunType =>
  cycle <= 0 ? 'ng' : cycle === 1 ? 'ng+' : 'ng++';

/** "NG", "NG+", "NG++", then "NG+3" and up — NG++++ gets unreadable fast. */
export const runLabel = (cycle: number): string =>
  cycle <= 0 ? 'NG' : cycle === 1 ? 'NG+' : cycle === 2 ? 'NG++' : `NG+${cycle}`;

/** Longer form used on cards, matching the mockup's "First run" wording. */
export const runLabelLong = (cycle: number): string =>
  cycle <= 0 ? 'First run' : runLabel(cycle);

export function newRun(gameId: string, cycle: number): Run {
  return {
    id: id(),
    gameId,
    runType: runTypeForCycle(cycle),
    cycle,
    startedAt: now(),
    completedAt: null,
    playedSeconds: 0,
    archived: false,
  };
}

export function newGame(input: Pick<Game, 'igdbId' | 'name' | 'coverUrl'>): Game {
  return { id: id(), platform: null, addedAt: now(), archived: false, ...input };
}

export function newDeath(
  gameId: string,
  runId: string,
  runSeconds: number | null = null,
): DeathEntry {
  return {
    id: id(),
    gameId,
    runId,
    diedAt: now(),
    runSeconds,
    bossName: null,
    location: null,
    note: null,
  };
}

// --- selectors -------------------------------------------------------------

export const activeGames = (s: AppState): Game[] => s.games.filter((g) => !g.archived);
export const archivedGames = (s: AppState): Game[] => s.games.filter((g) => g.archived);

/**
 * Games shown on the home screen. Archived games come back only once the
 * unlock is owned — that's the "restore archived history" promise.
 */
export const visibleGames = (s: AppState): Game[] =>
  s.entitlement.unlimitedGames ? s.games : activeGames(s);

/** Only unarchived games consume a free-tier slot. */
export const usedSlots = (s: AppState): number => activeGames(s).length;

/** Runs that count: everything except archived ones, oldest cycle first. */
export const runsForGame = (s: AppState, gameId: string): Run[] =>
  s.runs
    .filter((r) => r.gameId === gameId && !r.archived)
    .sort((a, b) => a.cycle - b.cycle || a.startedAt.localeCompare(b.startedAt));

export const archivedRunsForGame = (s: AppState, gameId: string): Run[] =>
  s.runs.filter((r) => r.gameId === gameId && r.archived);

/**
 * The run deaths are recorded against — strictly one that is unfinished and
 * unarchived. Returns undefined when the last run has been finished, which is
 * what locks a completed run: there is nothing to attribute a death to until
 * the player starts a new run.
 */
export const activeRun = (s: AppState, gameId: string): Run | undefined =>
  runsForGame(s, gameId).find((r) => !r.completedAt);

/** Most recent run, finished or not — used for labels when nothing is active. */
export const latestRun = (s: AppState, gameId: string): Run | undefined => {
  const runs = runsForGame(s, gameId);
  return runs[runs.length - 1];
};

/** The cycle a "next playthrough" should start on. */
export const nextCycle = (s: AppState, gameId: string): number => {
  const runs = runsForGame(s, gameId);
  return runs.length ? Math.max(...runs.map((r) => r.cycle)) + 1 : 0;
};

const countedRunIds = (s: AppState, gameId: string): Set<string> =>
  new Set(runsForGame(s, gameId).map((r) => r.id));

/** Deaths in archived runs don't count toward the game's totals. */
export const deathsForGame = (s: AppState, gameId: string): number => {
  const ids = countedRunIds(s, gameId);
  return s.deaths.reduce((n, d) => (ids.has(d.runId) ? n + 1 : n), 0);
};

export const deathsForRun = (s: AppState, runId: string): number =>
  s.deaths.reduce((n, d) => (d.runId === runId ? n + 1 : n), 0);

export const deathsToday = (s: AppState, gameId: string): number => {
  const today = new Date().toDateString();
  const ids = countedRunIds(s, gameId);
  return s.deaths.reduce(
    (n, d) => (ids.has(d.runId) && new Date(d.diedAt).toDateString() === today ? n + 1 : n),
    0,
  );
};

export const playedSecondsForGame = (s: AppState, gameId: string): number =>
  runsForGame(s, gameId).reduce((n, r) => n + r.playedSeconds, 0);
