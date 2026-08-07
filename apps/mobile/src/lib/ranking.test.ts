/**
 * Difficulty scoring. Rank-based on purpose — the tests pin that down, because
 * the tempting "simpler" rewrite is linear min/max scaling, and that lets one
 * bad session drag every other game's score with it.
 */
import { describe, expect, it } from 'vitest';
import { formatHours, isRankable, rankGames, type RankableGame } from './ranking';

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

  it('scores a lone game at the midpoint, not the top', () => {
    // Nothing to compare against yet, so a full 10 would be a lie.
    expect(rankGames([g('only', 50, 3600)]).ranked[0].score).toBe(5.5);
  });

  it('spreads three games without pinning either end of the scale', () => {
    const { ranked } = rankGames([g('easy', 1, 3600), g('hard', 30, 3600), g('mid', 10, 3600)]);
    expect(ranked.map((r) => r.gameId)).toEqual(['hard', 'mid', 'easy']);
    expect(ranked.map((r) => r.score)).toEqual([8.5, 5.5, 2.5]);
  });

  it('orders by rate, not by raw death count', () => {
    // 10 deaths in 30 minutes is harder than 20 deaths in 4 hours.
    const { ranked } = rankGames([g('grind', 20, 4 * 3600), g('brutal', 10, 1800)]);
    expect(ranked.map((r) => r.gameId)).toEqual(['brutal', 'grind']);
  });

  it('gives equal rates the same score', () => {
    // Two games at an identical rate scoring differently reads as a bug to the
    // user, whichever way the sort happened to fall.
    const { ranked } = rankGames([g('a', 10, 3600), g('b', 10, 3600), g('c', 1, 3600)]);
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(ranked[2].score).toBeLessThan(ranked[0].score);
  });

  it('is not dragged by an outlier', () => {
    // The whole reason for rank-based scoring: adding one absurd game must not
    // move the others.
    const without = rankGames([g('a', 30, 3600), g('b', 10, 3600), g('c', 1, 3600)]);
    const withOutlier = rankGames([
      g('a', 30, 3600),
      g('b', 10, 3600),
      g('c', 1, 3600),
      g('outlier', 600, 600),
    ]);
    // 'a' stays second-from-top and keeps a mid-to-high score rather than being
    // compressed toward the floor.
    expect(withOutlier.ranked[1].gameId).toBe('a');
    expect(withOutlier.ranked[1].score).toBeGreaterThan(5);
    expect(without.ranked[0].gameId).toBe('a');
  });

  it('reports no easiest game when only one is ranked', () => {
    const r = rankGames([g('only', 5, 3600)]);
    expect(r.hardest?.gameId).toBe('only');
    expect(r.easiest).toBe(null);
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
