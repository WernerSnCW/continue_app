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
  /**
   * How many runs the figures below are aggregated from.
   *
   * Not the current run's cycle. These totals span every counted run, so naming
   * one cycle beside them implied they belonged to it — "NG+ · 60h logged" read
   * as sixty hours of NG+.
   */
  runs: number;
  deaths: number;
  playedSeconds: number;
}

/**
 * Below this many rankable games, the ordering is shown but no score is.
 *
 * Rank-based scoring produces a confident-looking number regardless of how
 * close the underlying rates are: two games always read 7.75 and 3.25 whether
 * one kills you twice as often or a hundred times as often, and a lone game
 * always reads 5.5. That is precision the data does not support, and it gets
 * worse with user-made lists, which are often small on purpose.
 */
export const MIN_SCORED_GAMES = 4;

export interface RankedGame extends RankableGame {
  rank: number;
  /** Deaths per hour. */
  rate: number;
  /** 1–10, rank-based. Null when there are too few games to score honestly. */
  score: number | null;
  hours: number;
  tier: 'high' | 'mid' | 'low' | null;
}

const tierFor = (score: number): 'high' | 'mid' | 'low' =>
  score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low';

/** A game needs logged session time before deaths-per-hour means anything. */
export const isRankable = (g: RankableGame): boolean => g.playedSeconds > 0 && g.deaths > 0;

export interface RankingResult {
  ranked: RankedGame[];
  /** Games with no logged session time — shown greyed out, not scored. */
  unranked: RankableGame[];
  hardest: RankedGame | null;
  easiest: RankedGame | null;
  /**
   * Whether scores are meaningful for this set. False below
   * `MIN_SCORED_GAMES`, where the ordering still holds but every `score` is
   * null — see the constant for why.
   */
  scored: boolean;
}

export function rankGames(games: readonly RankableGame[]): RankingResult {
  const unranked = games.filter((g) => !isRankable(g));
  const candidates = games
    .filter(isRankable)
    .map((g) => ({ ...g, hours: g.playedSeconds / 3600, rate: g.deaths / (g.playedSeconds / 3600) }))
    .sort((a, b) => b.rate - a.rate);

  const n = candidates.length;
  const scored = n >= MIN_SCORED_GAMES;

  // Ties share an averaged rank so equal rates can't score differently.
  const ranked: RankedGame[] = candidates.map((g, i) => {
    const first = candidates.findIndex((c) => c.rate === g.rate);
    const last = candidates.findLastIndex((c) => c.rate === g.rate);
    const rankPos = (first + last) / 2 + 1;
    const raw = 1 + 9 * (1 - (rankPos - 0.5) / n);
    return {
      ...g,
      rank: i + 1,
      // Null rather than hidden by the caller: an unscored set must not be able
      // to leak a number through a screen that forgot to check `scored`.
      score: scored ? Math.round(raw * 10) / 10 : null,
      rate: Math.round(g.rate * 10) / 10,
      hours: g.hours,
      tier: scored ? tierFor(raw) : null,
    };
  });

  return {
    ranked,
    unranked,
    hardest: ranked[0] ?? null,
    easiest: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
    scored,
  };
}

/** Bar width in the ranking list, as a percentage of the score scale. */
export const barWidth = (score: number): number => Math.max(4, Math.round(score * 10));

export function formatHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)}h`;
  if (h >= 1) return `${h.toFixed(1)}h`;
  // Below a minute, round up to "1m" and a 5-second session reads as 1m — fine
  // for a run total, misleading in a per-session list where short stretches
  // are real.
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}
