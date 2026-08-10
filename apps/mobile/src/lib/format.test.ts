import { describe, expect, it } from 'vitest';
import { formatAgo, formatClock } from './format';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatClock', () => {
  it.each([
    [0, '00:00:00'],
    [1, '00:00:01'],
    [59, '00:00:59'],
    [60, '00:01:00'],
    [3599, '00:59:59'],
    [3600, '01:00:00'],
    [86399, '23:59:59'],
    [86400, '24:00:00'],
  ])('formats %is as %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });

  it('widens past 99 hours instead of rolling over', () => {
    // The question this suite exists for. A run total of 100 hours is ordinary
    // for a Souls game; wrapping to 00:00:00 would silently discard four days
    // of tracked time and read as data loss.
    expect(formatClock(99 * 3600 + 59 * 60 + 59)).toBe('99:59:59');
    expect(formatClock(100 * 3600)).toBe('100:00:00');
    expect(formatClock(1000 * 3600 + 61)).toBe('1000:01:01');
    expect(formatClock(10_000 * 3600)).toBe('10000:00:00');
  });

  it('keeps minutes and seconds two digits however large the hours', () => {
    // Only the hours field may grow; if minutes ever widened the colons would
    // stop lining up between the three places this clock is drawn.
    const parts = formatClock(12_345 * 3600 + 5 * 60 + 7).split(':');
    expect(parts[1]).toHaveLength(2);
    expect(parts[2]).toHaveLength(2);
    expect(parts[0]).toBe('12345');
  });

  it('truncates rather than rounds a fractional second', () => {
    // The live clock is fed a float. Rounding up would show 00:00:01 before a
    // full second had passed.
    expect(formatClock(1.99)).toBe('00:00:01');
  });

  it.each([
    ['a negative from a corrupt snapshot', -5],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('reads %s as zero rather than nonsense', (_label, input) => {
    // Untrusted restored input; the naive version renders "-1:-1:-5".
    expect(formatClock(input)).toBe('00:00:00');
  });
});

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
