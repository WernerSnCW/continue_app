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

export function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...(JSON.parse(raw) as AppState) };
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

export function newRun(gameId: string, cycle: number): Run {
  return {
    id: id(),
    gameId,
    runType: runTypeForCycle(cycle),
    cycle,
    startedAt: now(),
    completedAt: null,
  };
}

export function newGame(input: Pick<Game, 'igdbId' | 'name' | 'coverUrl'>): Game {
  return { id: id(), platform: null, addedAt: now(), ...input };
}

export function newDeath(gameId: string, runId: string): DeathEntry {
  return { id: id(), gameId, runId, diedAt: now(), bossName: null, location: null, note: null };
}

// --- selectors -------------------------------------------------------------

export const runsForGame = (s: AppState, gameId: string): Run[] =>
  s.runs.filter((r) => r.gameId === gameId).sort((a, b) => a.cycle - b.cycle);

export const activeRun = (s: AppState, gameId: string): Run | undefined => {
  const runs = runsForGame(s, gameId);
  return runs.find((r) => !r.completedAt) ?? runs[runs.length - 1];
};

export const deathsForGame = (s: AppState, gameId: string): number =>
  s.deaths.reduce((n, d) => (d.gameId === gameId ? n + 1 : n), 0);

export const deathsForRun = (s: AppState, runId: string): number =>
  s.deaths.reduce((n, d) => (d.runId === runId ? n + 1 : n), 0);
