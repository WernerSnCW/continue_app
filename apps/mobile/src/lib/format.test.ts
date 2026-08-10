import { describe, expect, it } from 'vitest';
import { formatAgo } from './format';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatAgo', () => {
  it.each([
    [0, 'now'],
    [30 * SEC, 'now'],
    [59 * SEC, 'now'],
    [60 * SEC, '1m'],
    [5 * MIN, '5m'],
    [59 * MIN + 59 * SEC, '59m'],
    [HOUR, '1h'],
    [23 * HOUR, '23h'],
    [DAY, '1d'],
    [9 * DAY, '9d'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatAgo(ms)).toBe(expected);
  });

  it('reads as "now" rather than a negative for a clock skewed forward', () => {
    // A death timestamped slightly in the future — a restored snapshot from a
    // device whose clock ran ahead. "-3m" would look broken.
    expect(formatAgo(-3 * MIN)).toBe('now');
  });

  it('rounds down, so a reading never overstates the gap', () => {
    // 119 seconds is 1m, not 2m: better to under-report than to have someone
    // think they missed a tap they did not miss.
    expect(formatAgo(119 * SEC)).toBe('1m');
  });

  it('stays narrow enough to sit in a stat pill', () => {
    // The row fits five pills across a 360px phone only while these are short.
    const widest = [0, 59 * SEC, 59 * MIN, 23 * HOUR, 99 * DAY].map(formatAgo);
    expect(Math.max(...widest.map((v) => v.length))).toBeLessThanOrEqual(3);
  });
});
