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
  addGameToList,
  clampCycle,
  MAX_CYCLE,
  adoptSnapshot,
  archivedRunsForGame,
  deathsForGame,
  emptyState,
  enforceGameLimit,
  gamesInList,
  listsForGame,
  purgeGameFromLists,
  removeGameFromList,
  renameList,
  runLabel,
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

describe('clampCycle', () => {
  // The NG+ field is typeable, so this takes whatever a number input can emit.
  it.each([
    ['a plain number', '5', 5],
    ['zero', '0', 0],
    ['the maximum', String(MAX_CYCLE), MAX_CYCLE],
  ])('accepts %s', (_label, input, expected) => {
    expect(clampCycle(input)).toBe(expected);
  });

  it('reads an empty field as NG rather than NaN', () => {
    // Clearing the box to retype must not blank the control or crash a label.
    expect(clampCycle('')).toBe(0);
  });

  it('clamps above the maximum instead of accepting NG+999999', () => {
    expect(clampCycle('250')).toBe(MAX_CYCLE);
    expect(clampCycle(1e9)).toBe(MAX_CYCLE);
  });

  it('clamps a negative to a first run', () => {
    expect(clampCycle('-4')).toBe(0);
  });

  it('floors a decimal, since half a playthrough is not a cycle', () => {
    expect(clampCycle('3.9')).toBe(3);
  });

  it.each([
    ['letters', 'abc'],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('falls back to NG for %s', (_label, input) => {
    expect(clampCycle(input as string | number)).toBe(0);
  });
});

describe('runLabel', () => {
  it.each([
    [0, 'NG'],
    [1, 'NG+'],
    [2, 'NG+2'],
    [3, 'NG+3'],
    [12, 'NG+12'],
    [99, 'NG+99'],
  ])('labels cycle %i as %s', (cycle, expected) => {
    expect(runLabel(cycle)).toBe(expected);
  });

  it('never produces a doubled plus', () => {
    // "NG++" was fine alone and fell apart after it: NG+++ against NG++++ is
    // unreadable at a glance, so every cycle past the first is numbered.
    const labels = Array.from({ length: 100 }, (_, i) => runLabel(i));
    expect(labels.filter((l) => l.includes('++'))).toEqual([]);
  });

  it('treats a negative cycle as a first run rather than showing a minus', () => {
    expect(runLabel(-1)).toBe('NG');
  });
});

describe('lists', () => {
  const base = (): AppState => ({
    ...emptyState(),
    games: [game('g1'), game('g2'), game('g3')],
    lists: [
      { id: 'l1', name: 'Souls-likes', gameIds: ['g1', 'g3'], createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  });

  it('returns members in the order the user added them', () => {
    // Not alphabetical and not library order: the list is the user's own
    // arrangement, and reordering it under them would be surprising.
    expect(gamesInList(base(), 'l1').map((g) => g.id)).toEqual(['g1', 'g3']);
  });

  it('is empty for a list that does not exist', () => {
    expect(gamesInList(base(), 'nope')).toEqual([]);
  });

  it('skips archived games without editing the list', () => {
    // A swapped-out game should drop out of the ranking, but rewriting the
    // stored list would lose the user's grouping when they unlock again.
    const s = base();
    s.games = s.games.map((g) => (g.id === 'g3' ? { ...g, archived: true } : g));
    expect(gamesInList(s, 'l1').map((g) => g.id)).toEqual(['g1']);
    expect(s.lists[0].gameIds).toEqual(['g1', 'g3']);
  });

  it('skips an id with no matching game rather than throwing', () => {
    // A game deleted on another device leaves its id behind in a restored list.
    const s = base();
    s.lists = [{ ...s.lists[0], gameIds: ['g1', 'ghost', 'g3'] }];
    expect(gamesInList(s, 'l1').map((g) => g.id)).toEqual(['g1', 'g3']);
  });

  it('adds and removes membership', () => {
    let s = addGameToList(base(), 'l1', 'g2');
    expect(gamesInList(s, 'l1').map((g) => g.id)).toEqual(['g1', 'g3', 'g2']);
    s = removeGameFromList(s, 'l1', 'g3');
    expect(gamesInList(s, 'l1').map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('never adds the same game twice', () => {
    // A double tap would otherwise put one game in the ranking twice.
    const s = addGameToList(addGameToList(base(), 'l1', 'g2'), 'l1', 'g2');
    expect(s.lists[0].gameIds.filter((id) => id === 'g2')).toHaveLength(1);
  });

  it('reports which lists a game belongs to', () => {
    const s = base();
    s.lists = [...s.lists, { id: 'l2', name: '2019', gameIds: ['g1'], createdAt: 'x' }];
    expect(listsForGame(s, 'g1').map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(listsForGame(s, 'g2')).toEqual([]);
  });

  it('trims whitespace when renaming', () => {
    expect(renameList(base(), 'l1', '  Horror  ').lists[0].name).toBe('Horror');
  });

  it('purges a deleted game from every list', () => {
    // Same reason a delete clears deaths and sessions: a dangling id is a hole
    // in a list the user is looking at.
    const s = base();
    s.lists = [...s.lists, { id: 'l2', name: 'Other', gameIds: ['g1', 'g2'], createdAt: 'x' }];
    const after = purgeGameFromLists(s, 'g1');
    expect(after.lists[0].gameIds).toEqual(['g3']);
    expect(after.lists[1].gameIds).toEqual(['g2']);
  });

  it('backfills lists when loading a state written before they existed', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ games: [game('g1')], runs: [], deaths: [] }),
    );
    expect(load().lists).toEqual([]);
  });

  it('accepts a restored list with no gameIds array', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        games: [game('g1')],
        runs: [],
        lists: [{ id: 'l1', name: 'Broken', createdAt: 'x' }],
      }),
    );
    expect(load().lists[0].gameIds).toEqual([]);
  });

  it('carries lists through a restored snapshot', () => {
    const s = adoptSnapshot({ games: [game('g1')], runs: [], lists: base().lists });
    expect(s!.lists[0].name).toBe('Souls-likes');
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
