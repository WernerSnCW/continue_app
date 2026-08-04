/**
 * Local persistence. localStorage for now — swappable for Capacitor
 * Preferences when the native wrapper exists, since everything goes through
 * load()/save().
 */
import type { DeathEntry, Entitlement, Game, Run, RunType, Session } from '@continue/shared';

const KEY = 'continue.state.v1';

/**
 * The play time tracker, hoisted out of the counter screen so it keeps
 * running while you browse elsewhere.
 *
 * `startedAt` is a wall-clock epoch rather than an accumulating counter, so
 * elapsed time stays correct across navigation, a reload, or the app being
 * backgrounded and killed — nothing has to be ticking for it to stay accurate.
 */
export interface RunningTimer {
  gameId: string;
  runId: string;
  /**
   * Minted when the clock starts, so deaths recorded during the session can
   * point at it immediately. The Session row itself is only written on stop,
   * when the end time is known.
   */
  sessionId: string;
  startedAt: number;
}

export interface AppState {
  games: Game[];
  runs: Run[];
  deaths: DeathEntry[];
  sessions: Session[];
  entitlement: Entitlement;
  timer: RunningTimer | null;
}

export const emptyState = (): AppState => ({
  games: [],
  runs: [],
  deaths: [],
  sessions: [],
  entitlement: { unlimitedGames: false, purchasedAt: null },
  timer: null,
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
      // Anything archived before this field existed was user-discarded; the
      // automatic swap path didn't exist yet.
      archivedReason: r.archivedReason ?? (r.archived ? 'discarded' : null),
    })),
    deaths: (raw.deaths ?? []).map((d) => ({
      ...d,
      runSeconds: d.runSeconds ?? null,
      sessionId: d.sessionId ?? null,
    })),
    sessions: raw.sessions ?? [],
    // A timer persisted before sessions existed has no id; give it one so the
    // stretch still in progress gets recorded when it stops.
    timer: raw.timer ? { ...raw.timer, sessionId: raw.timer.sessionId ?? id() } : null,
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

/**
 * Takes an untrusted snapshot (a cloud backup, possibly written by an older
 * build) and normalises it into current AppState, or returns null if it isn't
 * a plausible snapshot at all. Restoring must never leave the app holding a
 * half-shaped object.
 */
export function adoptSnapshot(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<AppState>;
  if (!Array.isArray(candidate.games) || !Array.isArray(candidate.runs)) return null;
  try {
    const state = migrate(candidate as AppState);
    // A restored snapshot's clock belongs to whatever device wrote it.
    return { ...state, timer: null };
  } catch {
    return null;
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
    archivedReason: null,
  };
}

export function newGame(input: Pick<Game, 'igdbId' | 'name' | 'coverUrl'>): Game {
  return { id: id(), platform: null, addedAt: now(), archived: false, ...input };
}

export function newDeath(
  gameId: string,
  runId: string,
  runSeconds: number | null = null,
  sessionId: string | null = null,
): DeathEntry {
  return {
    id: id(),
    gameId,
    runId,
    diedAt: now(),
    runSeconds,
    sessionId,
    bossName: null,
    location: null,
    note: null,
  };
}

// --- selectors -------------------------------------------------------------

export const activeGames = (s: AppState): Game[] => s.games.filter((g) => !g.archived);
export const archivedGames = (s: AppState): Game[] => s.games.filter((g) => g.archived);

/**
 * Games shown on the home screen: never the archived ones, paid or not.
 *
 * Unlocking restores archived games by actually un-archiving them (see the
 * entitlement action), rather than by showing archived ones. Otherwise "stop
 * tracking this game" would do nothing visible for a paid user, since the
 * game would simply stay on the home screen.
 */
export const visibleGames = (s: AppState): Game[] => activeGames(s);

/** Only unarchived games consume a free-tier slot. */
export const usedSlots = (s: AppState): number => activeGames(s).length;

/** Runs that count: everything except archived ones, oldest cycle first. */
export const runsForGame = (s: AppState, gameId: string): Run[] =>
  s.runs
    .filter((r) => r.gameId === gameId && !r.archived)
    .sort((a, b) => a.cycle - b.cycle || a.startedAt.localeCompare(b.startedAt));

export const archivedRunsForGame = (s: AppState, gameId: string): Run[] =>
  s.runs.filter((r) => r.gameId === gameId && r.archived);

export const runsArchivedBecause = (
  s: AppState,
  gameId: string,
  reason: 'discarded' | 'swapped',
): Run[] => archivedRunsForGame(s, gameId).filter((r) => r.archivedReason === reason);

/**
 * What a game holds in total, counted or not — used to tell someone re-adding
 * a swapped-out game exactly what's sitting behind the unlock.
 */
export function historyForIgdbId(
  s: AppState,
  igdbId: number,
): { archived: boolean; runs: number; deaths: number; lockedRuns: number; lockedDeaths: number } | null {
  const game = s.games.find((g) => g.igdbId === igdbId);
  if (!game) return null;

  const all = s.runs.filter((r) => r.gameId === game.id);
  const countDeaths = (runs: Run[]) => {
    const ids = new Set(runs.map((r) => r.id));
    return s.deaths.reduce((n, d) => (ids.has(d.runId) ? n + 1 : n), 0);
  };
  // What would be set aside if they start fresh: everything still live, plus
  // anything already swapped out on a previous round-trip.
  const locked = all.filter((r) => !r.archived || r.archivedReason === 'swapped');

  return {
    archived: game.archived,
    runs: all.length,
    deaths: countDeaths(all),
    lockedRuns: locked.length,
    lockedDeaths: countDeaths(locked),
  };
}

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

/** Sessions for a run, oldest first. */
export const sessionsForRun = (s: AppState, runId: string): Session[] =>
  s.sessions
    .filter((x) => x.runId === runId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

export const deathsInSession = (s: AppState, sessionId: string): number =>
  s.deaths.reduce((n, d) => (d.sessionId === sessionId ? n + 1 : n), 0);

/**
 * Play time on a run that no session accounts for.
 *
 * Almost entirely time logged before sessions were recorded, which cannot be
 * reconstructed. Surfaced rather than hidden so the per-session figures always
 * add up to the run total in front of the user.
 */
export const unsessionedSecondsForRun = (s: AppState, run: Run): number => {
  const accounted = sessionsForRun(s, run.id).reduce((n, x) => n + x.seconds, 0);
  return Math.max(0, run.playedSeconds - accounted);
};

/** Deaths on a run that happened with the tracker off. */
export const untimedDeathsForRun = (s: AppState, runId: string): number =>
  s.deaths.reduce((n, d) => (d.runId === runId && d.sessionId === null ? n + 1 : n), 0);

/** Seconds accrued on the running clock but not yet committed to the run. */
export const liveSecondsFor = (s: AppState, runId: string): number =>
  s.timer?.runId === runId ? Math.max(0, (Date.now() - s.timer.startedAt) / 1000) : 0;

/** A run's play time including whatever is currently on the clock. */
export const playedSecondsForRun = (s: AppState, run: Run): number =>
  run.playedSeconds + liveSecondsFor(s, run.id);

export const playedSecondsForGame = (s: AppState, gameId: string): number =>
  runsForGame(s, gameId).reduce((n, r) => n + playedSecondsForRun(s, r), 0);

/**
 * Folds any running clock into its run and clears the timer. Call before
 * finishing, resetting or discarding a run so its time isn't left dangling on
 * a timer pointing at a run that no longer accepts it.
 */
export function commitTimer(s: AppState): AppState {
  if (!s.timer) return s;
  const { runId, gameId, sessionId, startedAt } = s.timer;
  const elapsed = Math.floor(liveSecondsFor(s, runId));

  // Every stop funnels through here, so this is the one place a session has
  // to be written. Zero-length stretches (a mis-tap) add nothing and are not
  // worth a row.
  const session: Session[] =
    elapsed >= 1
      ? [
          {
            id: sessionId,
            gameId,
            runId,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(startedAt + elapsed * 1000).toISOString(),
            seconds: elapsed,
          },
        ]
      : [];

  return {
    ...s,
    runs: s.runs.map((r) =>
      r.id === runId ? { ...r, playedSeconds: r.playedSeconds + elapsed } : r,
    ),
    sessions: [...s.sessions, ...session],
    timer: null,
  };
}

/**
 * When a game was last actually touched — latest death, latest run start, or
 * failing both, when it was added. Used to decide which games keep their slots
 * when an unlock lapses.
 */
export function lastActiveAt(s: AppState, gameId: string): number {
  const runs = s.runs.filter((r) => r.gameId === gameId);
  const runIds = new Set(runs.map((r) => r.id));

  let latest = 0;
  const game = s.games.find((g) => g.id === gameId);
  if (game) latest = Date.parse(game.addedAt) || 0;
  for (const r of runs) latest = Math.max(latest, Date.parse(r.startedAt) || 0);
  for (const d of s.deaths) {
    if (runIds.has(d.runId)) latest = Math.max(latest, Date.parse(d.diedAt) || 0);
  }
  // Starting a clock counts as activity at that moment — but only that moment.
  // Treating a *running* timer as permanently the most recent would let one
  // forgotten clock pin the wrong game to the home screen indefinitely, which
  // is precisely the situation the "still running" reminder exists to catch.
  if (s.timer?.gameId === gameId) latest = Math.max(latest, s.timer.startedAt);
  return latest;
}

/**
 * Enforces the free-tier limit after an unlock lapses, by archiving the least
 * recently played games until only `limit` remain active.
 *
 * Nothing is deleted — the surplus is archived exactly as a swap would archive
 * it, so it comes back if they unlock again, and they can swap which games are
 * live in the meantime. Without this, buying the unlock, adding a pile of
 * games and then refunding would leave the limit permanently bypassed.
 */
export function enforceGameLimit(s: AppState, limit: number): AppState {
  const active = activeGames(s);
  if (active.length <= limit) return s;

  const keep = new Set(
    [...active]
      .sort((a, b) => lastActiveAt(s, b.id) - lastActiveAt(s, a.id))
      .slice(0, limit)
      .map((g) => g.id),
  );

  // A clock running on a game about to be archived has to be banked first.
  const base = s.timer && !keep.has(s.timer.gameId) ? commitTimer(s) : s;

  return {
    ...base,
    games: base.games.map((g) => (!g.archived && !keep.has(g.id) ? { ...g, archived: true } : g)),
  };
}

/**
 * The game to put front and centre on the home screen — whatever was touched
 * most recently. A clock currently running always wins, since that's the game
 * they're sitting in front of right now.
 */
export const lastPlayedGame = (s: AppState): Game | undefined => {
  const candidates = visibleGames(s);
  if (!candidates.length) return undefined;
  return candidates.reduce((best, g) =>
    lastActiveAt(s, g.id) > lastActiveAt(s, best.id) ? g : best,
  );
};

/**
 * Totals across every game on file, archived or not.
 *
 * Deliberately built from `deathsForGame`/`playedSecondsForGame`, which skip
 * archived runs — so a swapped-out game's locked history stays locked and the
 * headline number can't quietly hand back what the unlock is meant to sell.
 */
export function lifetimeTotals(s: AppState): {
  deaths: number;
  seconds: number;
  ratePerHour: number | null;
} {
  let deaths = 0;
  let seconds = 0;
  for (const g of s.games) {
    deaths += deathsForGame(s, g.id);
    seconds += playedSecondsForGame(s, g.id);
  }
  return {
    deaths,
    seconds,
    ratePerHour: seconds > 0 ? deaths / (seconds / 3600) : null,
  };
}

/** The game whose clock is running, if any. */
export const timedGame = (s: AppState): Game | undefined =>
  s.timer ? s.games.find((g) => g.id === s.timer!.gameId) : undefined;
