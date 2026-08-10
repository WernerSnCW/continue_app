/**
 * The store's data-safety surface: reading state written by an older build,
 * adopting an untrusted cloud snapshot, and reporting a failed write.
 *
 * These are the paths where a mistake costs someone their tally rather than
 * merely rendering something wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeRun,
  adoptSnapshot,
  archivedRunsForGame,
  deathsForGame,
  emptyState,
  enforceGameLimit,
  lastDeathAtForRun,
  lastPlayedGame,
  lifetimeTotals,
  load,
  save,
  unsessionedSecondsForRun,
  type AppState,
} from './store';
import type { Game, Run } from '@continue/shared';

const KEY = 'continue.state.v1';

const game = (id: string, over: Partial<Game> = {}): Game => ({
  id,
  igdbId: Number(id.replace(/\D/g, '')) || 1,
  name: `Game ${id}`,
  coverUrl: null,
  platform: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  archived: false,
  ...over,
});

const run = (id: string, gameId: string, over: Partial<Run> = {}): Run => ({
  id,
  gameId,
  runType: 'ng',
  cycle: 0,
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  playedSeconds: 0,
  archived: false,
  archivedReason: null,
  ...over,
});

const death = (id: string, gameId: string, runId: string, over = {}) => ({
  id,
  gameId,
  runId,
  diedAt: '2026-01-02T00:00:00.000Z',
  runSeconds: null,
  sessionId: null,
  bossName: null,
  location: null,
  note: null,
  ...over,
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('load', () => {
  it('returns an empty state rather than throwing on corrupt storage', () => {
    // A crash here would brick the app on launch with no way back in.
    localStorage.setItem(KEY, '{ this is not json');
    expect(load()).toEqual(emptyState());
  });

  it('backfills fields added after a state was written', () => {
    // A build predating archived / playedSeconds / sessions.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        games: [{ id: 'g1', igdbId: 1, name: 'Old', coverUrl: null, addedAt: 'x' }],
        runs: [{ id: 'r1', gameId: 'g1', runType: 'ng', cycle: 0, startedAt: 'x' }],
        deaths: [{ id: 'd1', gameId: 'g1', runId: 'r1', diedAt: 'x' }],
        entitlement: { unlimitedGames: false, purchasedAt: null },
      }),
    );

    const s = load();
    expect(s.games[0].archived).toBe(false);
    expect(s.runs[0].playedSeconds).toBe(0);
    expect(s.runs[0].archived).toBe(false);
    expect(s.runs[0].archivedReason).toBe(null);
    expect(s.deaths[0].runSeconds).toBe(null);
    expect(s.deaths[0].sessionId).toBe(null);
    expect(s.sessions).toEqual([]);
  });

  it('treats a run archived before archivedReason existed as discarded', () => {
    // It must not be read as "swapped", or unlocking would silently resurrect
    // runs the user deliberately threw away.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        games: [game('g1')],
        runs: [{ ...run('r1', 'g1'), archived: true, archivedReason: undefined }],
        deaths: [],
      }),
    );
    expect(load().runs[0].archivedReason).toBe('discarded');
  });
});

describe('adoptSnapshot', () => {
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a number', 7],
    ['an object with no arrays', { games: 'x', runs: 'y' }],
    ['games missing', { runs: [] }],
    ['runs missing', { games: [] }],
  ])('rejects %s', (_label, input) => {
    expect(adoptSnapshot(input)).toBe(null);
  });

  it('accepts a minimal snapshot and normalises it', () => {
    const s = adoptSnapshot({ games: [game('g1')], runs: [run('r1', 'g1')] });
    expect(s).not.toBe(null);
    expect(s!.deaths).toEqual([]);
    expect(s!.sessions).toEqual([]);
    expect(s!.entitlement).toEqual({ unlimitedGames: false, purchasedAt: null });
  });

  it('drops a timer belonging to the device that wrote the snapshot', () => {
    // Adopting a foreign clock would attribute someone else's elapsed wall time
    // to this run the moment it is committed.
    const s = adoptSnapshot({
      games: [game('g1')],
      runs: [run('r1', 'g1')],
      timer: { gameId: 'g1', runId: 'r1', sessionId: 's1', startedAt: 1 },
    });
    expect(s!.timer).toBe(null);
  });
});

describe('save', () => {
  it('reports failure instead of swallowing it', () => {
    // Quota exhaustion used to be silent: the counter kept rising and nothing
    // was kept.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(save(emptyState())).toBe(false);
  });

  it('reports success on a normal write', () => {
    expect(save(emptyState())).toBe(true);
    expect(localStorage.getItem(KEY)).not.toBe(null);
  });
});

describe('activeRun', () => {
  const base = (runs: Run[]): AppState => ({ ...emptyState(), games: [game('g1')], runs });

  it('is undefined once every run is finished, locking the tally', () => {
    // The lock: with no active run there is nothing to attribute a death to.
    const s = base([run('r1', 'g1', { completedAt: '2026-02-01T00:00:00.000Z' })]);
    expect(activeRun(s, 'g1')).toBeUndefined();
  });

  it('ignores archived runs', () => {
    const s = base([run('r1', 'g1', { archived: true, archivedReason: 'swapped' })]);
    expect(activeRun(s, 'g1')).toBeUndefined();
  });

  it('finds the unfinished run', () => {
    const s = base([
      run('r1', 'g1', { cycle: 0, completedAt: '2026-02-01T00:00:00.000Z' }),
      run('r2', 'g1', { cycle: 1 }),
    ]);
    expect(activeRun(s, 'g1')?.id).toBe('r2');
  });
});

describe('deaths and totals exclude archived runs', () => {
  const s: AppState = {
    ...emptyState(),
    games: [game('g1')],
    runs: [
      run('live', 'g1', { cycle: 1, playedSeconds: 3600 }),
      run('swapped', 'g1', { archived: true, archivedReason: 'swapped', playedSeconds: 7200 }),
    ],
    deaths: [
      death('d1', 'g1', 'live'),
      death('d2', 'g1', 'live'),
      death('d3', 'g1', 'swapped'),
    ],
  };

  it('counts only live runs for a game', () => {
    expect(deathsForGame(s, 'g1')).toBe(2);
  });

  it('keeps locked history out of the lifetime headline', () => {
    // Otherwise the free-tier headline hands back exactly what the unlock sells.
    const totals = lifetimeTotals(s);
    expect(totals.deaths).toBe(2);
    expect(totals.seconds).toBe(3600);
    expect(totals.ratePerHour).toBe(2);
  });

  it('reports no rate rather than dividing by zero', () => {
    expect(lifetimeTotals({ ...emptyState(), games: [game('g1')] }).ratePerHour).toBe(null);
  });

  it('still records the archived run against the game', () => {
    expect(archivedRunsForGame(s, 'g1').map((r) => r.id)).toEqual(['swapped']);
  });
});

describe('enforceGameLimit', () => {
  // Buying the unlock, adding a pile of games and then reverting must not leave
  // the limit permanently bypassed.
  const withGames = (n: number): AppState => ({
    ...emptyState(),
    games: Array.from({ length: n }, (_, i) =>
      game(`g${i + 1}`, { addedAt: `2026-0${i + 1}-01T00:00:00.000Z` }),
    ),
  });

  it('leaves a state already within the limit alone', () => {
    const s = withGames(3);
    expect(enforceGameLimit(s, 3)).toBe(s);
  });

  it('archives the least recently active surplus, keeping the newest', () => {
    const s = enforceGameLimit(withGames(5), 3);
    expect(s.games.filter((g) => !g.archived).map((g) => g.id)).toEqual(['g3', 'g4', 'g5']);
    // Archived, never deleted — it comes back on unlock.
    expect(s.games).toHaveLength(5);
  });

  it('keeps the game whose clock is running, however long ago it was added', () => {
    // Starting a clock counts as activity, so the game being played right now
    // cannot be the one that loses its slot.
    const s = enforceGameLimit(
      {
        ...withGames(5),
        runs: [run('r1', 'g1')],
        timer: { gameId: 'g1', runId: 'r1', sessionId: 's1', startedAt: Date.now() - 60_000 },
      },
      3,
    );
    expect(s.games.find((g) => g.id === 'g1')!.archived).toBe(false);
    expect(s.timer).not.toBe(null);
  });

  it('banks a stale running clock when its game does lose its slot', () => {
    // A clock left running a month ago does not protect its game forever, and
    // the elapsed time must be recorded rather than discarded with the timer.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));

    const s = enforceGameLimit(
      {
        ...emptyState(),
        games: [
          game('g1', { addedAt: '2026-01-01T00:00:00.000Z' }),
          game('g2', { addedAt: '2026-05-20T00:00:00.000Z' }),
          game('g3', { addedAt: '2026-05-21T00:00:00.000Z' }),
          game('g4', { addedAt: '2026-05-22T00:00:00.000Z' }),
        ],
        runs: [run('r1', 'g1')],
        timer: {
          gameId: 'g1',
          runId: 'r1',
          sessionId: 's1',
          startedAt: Date.parse('2026-05-01T00:00:00.000Z'),
        },
      },
      3,
    );

    expect(s.games.find((g) => g.id === 'g1')!.archived).toBe(true);
    expect(s.timer).toBe(null);
    expect(s.sessions).toHaveLength(1);
    expect(s.runs[0].playedSeconds).toBe(31 * 24 * 3600);
  });
});

describe('unsessionedSecondsForRun', () => {
  it('surfaces run time no session accounts for', () => {
    // Time logged before sessions were recorded; shown rather than hidden so
    // the per-session figures add up in front of the user.
    const r = run('r1', 'g1', { playedSeconds: 5000 });
    const s: AppState = {
      ...emptyState(),
      runs: [r],
      sessions: [
        { id: 's1', gameId: 'g1', runId: 'r1', startedAt: 'a', endedAt: 'b', seconds: 1200 },
      ],
    };
    expect(unsessionedSecondsForRun(s, r)).toBe(3800);
  });

  it('never reports negative time when sessions overshoot the run', () => {
    const r = run('r1', 'g1', { playedSeconds: 100 });
    const s: AppState = {
      ...emptyState(),
      runs: [r],
      sessions: [
        { id: 's1', gameId: 'g1', runId: 'r1', startedAt: 'a', endedAt: 'b', seconds: 900 },
      ],
    };
    expect(unsessionedSecondsForRun(s, r)).toBe(0);
  });
});

describe('lastDeathAtForRun', () => {
  it('is null when the run has no deaths', () => {
    const s: AppState = { ...emptyState(), runs: [run('r1', 'g1')] };
    expect(lastDeathAtForRun(s, 'r1')).toBe(null);
  });

  it('finds the latest death regardless of stored order', () => {
    // A restored snapshot carries whatever order the writing device had, so
    // taking the last element would give the wrong answer.
    const s: AppState = {
      ...emptyState(),
      deaths: [
        death('d1', 'g1', 'r1', { diedAt: '2026-03-01T10:00:00.000Z' }),
        death('d3', 'g1', 'r1', { diedAt: '2026-03-01T12:00:00.000Z' }),
        death('d2', 'g1', 'r1', { diedAt: '2026-03-01T11:00:00.000Z' }),
      ],
    };
    expect(lastDeathAtForRun(s, 'r1')).toBe('2026-03-01T12:00:00.000Z');
  });

  it('ignores deaths on other runs', () => {
    const s: AppState = {
      ...emptyState(),
      deaths: [
        death('d1', 'g1', 'r1', { diedAt: '2026-03-01T10:00:00.000Z' }),
        death('d2', 'g1', 'r2', { diedAt: '2026-03-09T10:00:00.000Z' }),
      ],
    };
    expect(lastDeathAtForRun(s, 'r1')).toBe('2026-03-01T10:00:00.000Z');
  });
});

describe('lastPlayedGame', () => {
  it('never features an archived game', () => {
    const s: AppState = {
      ...emptyState(),
      games: [
        game('g1', { addedAt: '2026-01-01T00:00:00.000Z' }),
        game('g2', { addedAt: '2026-06-01T00:00:00.000Z', archived: true }),
      ],
    };
    expect(lastPlayedGame(s)?.id).toBe('g1');
  });

  it('is undefined when nothing is tracked', () => {
    expect(lastPlayedGame(emptyState())).toBeUndefined();
  });
});
