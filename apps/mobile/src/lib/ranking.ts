/**
 * Personal difficulty ranking — ranks the user's own games by deaths per hour.
 *
 * Scoring is deliberately RANK-BASED, not a linear scale of the raw rate.
 * Linear min/max scaling lets one bad session drag every other game's score
 * with it: grind out 60 deaths in a 20-minute stretch and that game's rate
 * balloons, compressing everything else toward the bottom. Rank position is
 * immune to that — an outlier can only ever be "first", it can't stretch the
 * axis.
 *
 * The mapping is the Hazen plotting position: score = 1 + 9 * (1 - (r - 0.5)/n)
 * for rank r of n. It never pins scores to the exact ends of the scale (a
 * three-game set reads 8.5 / 5.5 / 2.5), and it degrades sensibly to a single
 * game (5.5 — nothing to compare against yet).
 */

export interface RankableGame {
  gameId: string;
  name: string;
  /** Label for the current run, e.g. "NG+2" or "First run". */
  runLabel: string;
  deaths: number;
  playedSeconds: number;
}

export interface RankedGame extends RankableGame {
  rank: number;
  /** Deaths per hour. */
  rate: number;
  /** 1–10, rank-based. */
  score: number;
  hours: number;
  tier: 'high' | 'mid' | 'low';
}

const tierFor = (score: number): RankedGame['tier'] =>
  score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low';

/** A game needs logged session time before deaths-per-hour means anything. */
export const isRankable = (g: RankableGame): boolean => g.playedSeconds > 0 && g.deaths > 0;

export interface RankingResult {
  ranked: RankedGame[];
  /** Games with no logged session time — shown greyed out, not scored. */
  unranked: RankableGame[];
  hardest: RankedGame | null;
  easiest: RankedGame | null;
}

export function rankGames(games: readonly RankableGame[]): RankingResult {
  const unranked = games.filter((g) => !isRankable(g));
  const candidates = games
    .filter(isRankable)
    .map((g) => ({ ...g, hours: g.playedSeconds / 3600, rate: g.deaths / (g.playedSeconds / 3600) }))
    .sort((a, b) => b.rate - a.rate);

  const n = candidates.length;

  // Ties share an averaged rank so equal rates can't score differently.
  const ranked: RankedGame[] = candidates.map((g, i) => {
    const first = candidates.findIndex((c) => c.rate === g.rate);
    const last = candidates.findLastIndex((c) => c.rate === g.rate);
    const rankPos = (first + last) / 2 + 1;
    const score = n === 0 ? 0 : 1 + 9 * (1 - (rankPos - 0.5) / n);
    return {
      ...g,
      rank: i + 1,
      score: Math.round(score * 10) / 10,
      rate: Math.round(g.rate * 10) / 10,
      hours: g.hours,
      tier: tierFor(score),
    };
  });

  return {
    ranked,
    unranked,
    hardest: ranked[0] ?? null,
    easiest: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
  };
}

/** Bar width in the ranking list, as a percentage of the score scale. */
export const barWidth = (score: number): number => Math.max(4, Math.round(score * 10));

export function formatHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)}h`;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}
