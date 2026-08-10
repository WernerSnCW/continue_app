/**
 * Small display formatters shared across screens.
 */

/**
 * How long ago something happened, in the fewest characters that still read.
 *
 * Deliberately coarse: this exists so someone can glance down mid-fight and
 * tell whether their last death was moments ago or ten minutes ago. Seconds of
 * precision would be noise, and a value that changes every second is one more
 * thing moving on a screen that already has a running clock.
 *
 * Short because it sits in a stat pill beside four others. A friendlier "just
 * now" is three times the width of the counts next to it, which is enough to
 * wrap the row onto two lines on a 360px phone — the label supplies the "ago".
 */
export function formatAgo(millisecondsAgo: number): string {
  const s = Math.max(0, Math.floor(millisecondsAgo / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
