/**
 * Difficulty scoring. Rank-based on purpose — the tests pin that down, because
 * the tempting "simpler" rewrite is linear min/max scaling, and that lets one
 * bad session drag every other game's score with it.
 */
import { describe, expect, it } from 'vitest';
import {
  formatHours,
  isRankable,
  MIN_SCORED_GAMES,
  rankGames,
  type RankableGame,
} from './ranking';

const g = (gameId: string, deaths: number, playedSeconds: number): RankableGame => ({
  gameId,
  name: gameId,
  runLabel: 'NG',
  deaths,
  playedSeconds,
});

describe('isRankable', () => {
  it('needs both logged time and at least one death', () => {
    expect(isRankable(g('a', 5, 3600))).toBe(true);
    expect(isRankable(g('a', 0, 3600))).toBe(false);
    expect(isRankable(g('a', 5, 0))).toBe(false);
  });
});

describe('rankGames', () => {
  it('sets aside games with nothing to rate, without scoring them', () => {
    const { ranked, unranked } = rankGames([g('rated', 10, 3600), g('untimed', 4, 0)]);
    expect(ranked.map((r) => r.gameId)).toEqual(['rated']);
    expect(unranked.map((r) => r.gameId)).toEqual(['untimed']);
  });

  it('withholds scores below the threshold, but still orders', () => {
    // Two games always come out 7.75 and 3.25 whether one kills you twice as
    // often or a hundred times as often. The order is real; the number is not.
    const { ranked, scored } = rankGames([g('hard', 30, 3600), g('easy', 1, 3600)]);
    expect(scored).toBe(false);
    expect(ranked.map((r) => r.gameId)).toEqual(['hard', 'easy']);
    expect(ranked.map((r) => r.score)).toEqual([null, null]);
    expect(ranked.map((r) => r.tier)).toEqual([null, null]);
  });

  it.each([1, 2, 3])('does not score a set of %i', (n) => {
    const games = Array.from({ length: n }, (_, i) => g(`g${i}`, (i + 1) * 5, 3600));
    const r = rankGames(games);
    expect(r.scored).toBe(false);
    expect(r.ranked.every((x) => x.score === null)).toBe(true);
  });

  it(`scores from ${MIN_SCORED_GAMES} rankable games up`, () => {
    const games = Array.from({ length: MIN_SCORED_GAMES }, (_, i) => g(`g${i}`, (i + 1) * 5, 3600));
    const r = rankGames(games);
    expect(r.scored).toBe(true);
    expect(r.ranked.every((x) => typeof x.score === 'number')).toBe(true);
  });

  it('spreads four games without pinning either end of the scale', () => {
    const { ranked } = rankGames([
      g('easy', 1, 3600),
      g('hard', 40, 3600),
      g('mid', 10, 3600),
      g('midder', 20, 3600),
    ]);
    expect(ranked.map((r) => r.gameId)).toEqual(['hard', 'midder', 'mid', 'easy']);
    // Never 10 and never 1: the plotting position keeps room at both ends.
    expect(ranked[0].score).toBeLessThan(10);
    expect(ranked[3].score).toBeGreaterThan(1);
  });

  it('counts only rankable games toward the threshold', () => {
    // Four games, but two have no logged time. Padding a list with untracked
    // games must not switch scoring on.
    const r = rankGames([g('a', 5, 3600), g('b', 9, 3600), g('c', 3, 0), g('d', 7, 0)]);
    expect(r.unranked).toHaveLength(2);
    expect(r.scored).toBe(false);
  });

  it('orders by rate, not by raw death count', () => {
    // 10 deaths in 30 minutes is harder than 20 deaths in 4 hours.
    const { ranked } = rankGames([g('grind', 20, 4 * 3600), g('brutal', 10, 1800)]);
    expect(ranked.map((r) => r.gameId)).toEqual(['brutal', 'grind']);
  });

  it('gives equal rates the same score', () => {
    // Two games at an identical rate scoring differently reads as a bug to the
    // user, whichever way the sort happened to fall.
    const { ranked } = rankGames([
      g('a', 10, 3600),
      g('b', 10, 3600),
      g('c', 1, 3600),
      g('d', 30, 3600),
    ]);
    const a = ranked.find((r) => r.gameId === 'a')!;
    const b = ranked.find((r) => r.gameId === 'b')!;
    const c = ranked.find((r) => r.gameId === 'c')!;
    expect(a.score).toBe(b.score);
    expect(c.score!).toBeLessThan(a.score!);
  });

  it('is not dragged by an outlier', () => {
    // The whole reason for rank-based scoring: adding one absurd game must not
    // compress the others toward the floor.
    const base = [g('a', 30, 3600), g('b', 10, 3600), g('c', 4, 3600), g('d', 1, 3600)];
    const without = rankGames(base);
    const withOutlier = rankGames([...base, g('outlier', 600, 600)]);

    expect(without.ranked[0].gameId).toBe('a');
    // 'a' slips to second but keeps a high score rather than being squashed.
    expect(withOutlier.ranked[1].gameId).toBe('a');
    expect(withOutlier.ranked[1].score!).toBeGreaterThan(6);
  });

  it('reports no easiest game when only one is ranked', () => {
    const r = rankGames([g('only', 5, 3600)]);
    expect(r.hardest?.gameId).toBe('only');
    expect(r.easiest).toBe(null);
  });

  it('reports scored false for an empty set rather than throwing', () => {
    const r = rankGames([]);
    expect(r.scored).toBe(false);
    expect(r.ranked).toEqual([]);
  });

  it('has no hardest game when nothing is rankable', () => {
    const r = rankGames([g('a', 0, 0)]);
    expect(r.hardest).toBe(null);
    expect(r.easiest).toBe(null);
  });
});

describe('formatHours', () => {
  it.each([
    [45, '45s'],
    [90, '2m'],
    [3600, '1.0h'],
    [5400, '1.5h'],
    [36000, '10h'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatHours(seconds)).toBe(expected);
  });
});
