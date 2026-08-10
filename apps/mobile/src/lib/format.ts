/**
 * Small display formatters shared across screens.
 */

/**
 * Elapsed play time as HH:MM:SS.
 *
 * Hours are padded to two digits but never truncated, so the clock does not
 * roll over at 99:59:59 — it widens to 100:00:00 and keeps counting. That is
 * the right trade for a run total: a hundred hours on one Souls playthrough is
 * ordinary, and a clock that silently wrapped to 00:00:00 would quietly discard
 * four days of someone's tracked time. The layout is sized to take the extra
 * digits; verified down to a 360px phone at four-digit hours.
 *
 * Negative and non-finite inputs read as zero rather than "-1:-1:-5". Nothing
 * in the app produces one today — committed seconds only ever accumulate — but
 * a restored snapshot is untrusted input, and a broken clock is a bug report
 * about lost data.
 */
export function formatClock(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

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
