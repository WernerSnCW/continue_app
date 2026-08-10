/**
 * The conflict guard — the single decision standing between a device that has
 * fallen behind and someone's tally.
 *
 * The regression these exist for: the guard compared `updated_at` as strings.
 * We send `toISOString()` (`...123Z`); Postgres returns the same instant as
 * `...123+00:00`. Never equal, so the guard could not recognise its own writes
 * and refused every push where the cloud held more — which is exactly what a
 * deliberate delete looks like. It took a phone, a real account and a delete to
 * find. It takes one assertion to catch.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isOptedOut, isSameInstant, shouldRefusePush, type RemoteMeta } from './backup';

const remote = (updatedAt: string, games: number, deaths: number): RemoteMeta => ({
  updatedAt,
  games,
  deaths,
});

describe('isOptedOut', () => {
  // The flag that stops a deleted account being silently replaced by a fresh
  // anonymous one. Pinned by key name and exact value: a typo either way makes
  // deletion a lie again, and nothing else would fail.
  const KEY = 'continue.backup.optedout.v1';

  beforeEach(() => localStorage.clear());

  it('is false on a normal install', () => {
    expect(isOptedOut()).toBe(false);
  });

  it('is true once the flag is set', () => {
    localStorage.setItem(KEY, '1');
    expect(isOptedOut()).toBe(true);
  });

  it('is false again once the flag is cleared', () => {
    localStorage.setItem(KEY, '1');
    localStorage.removeItem(KEY);
    expect(isOptedOut()).toBe(false);
  });

  it('does not treat some other truthy value as opted out', () => {
    localStorage.setItem(KEY, 'false');
    expect(isOptedOut()).toBe(false);
  });
});

describe('isSameInstant', () => {
  it('matches the same moment across Postgres and JS formats', () => {
    // The actual regression. These are the two spellings of one instant.
    const asPostgresReturnsIt = '2026-08-07T08:15:41.189+00:00';
    const asWeSentIt = Date.parse('2026-08-07T08:15:41.189Z');

    expect(asPostgresReturnsIt).not.toBe(new Date(asWeSentIt).toISOString());
    expect(isSameInstant(asPostgresReturnsIt, asWeSentIt)).toBe(true);
  });

  it('tolerates the microsecond precision of server-side now()', () => {
    // Rows written by a Postgres default carry six fractional digits; both
    // sides truncate to the same millisecond.
    const sixDigits = '2026-07-30T17:14:16.448262+00:00';
    expect(isSameInstant(sixDigits, Date.parse('2026-07-30T17:14:16.448Z'))).toBe(true);
  });

  it('is false for genuinely different instants', () => {
    expect(
      isSameInstant('2026-08-07T08:15:41.189+00:00', Date.parse('2026-08-07T08:15:42.189Z')),
    ).toBe(false);
  });

  it('is false when this device has never synced', () => {
    expect(isSameInstant('2026-08-07T08:15:41.189+00:00', null)).toBe(false);
  });

  it('is false rather than throwing on an unparseable timestamp', () => {
    expect(isSameInstant('not a date', Date.now())).toBe(false);
  });
});

describe('shouldRefusePush', () => {
  const seen = Date.parse('2026-08-07T08:15:41.189Z');
  const sameRow = '2026-08-07T08:15:41.189+00:00';
  const newerRow = '2026-08-07T09:00:00.000+00:00';

  it('allows a deliberate delete to shrink a row this device wrote', () => {
    // The bug in one line: local has fewer because the user just deleted a
    // game, and the row is the one we last wrote. Nothing to disagree about.
    expect(shouldRefusePush(remote(sameRow, 2, 243), { games: 1, deaths: 240 }, seen)).toBe(false);
  });

  it('refuses when an unseen row holds more deaths', () => {
    expect(shouldRefusePush(remote(newerRow, 1, 500), { games: 1, deaths: 240 }, seen)).toBe(true);
  });

  it('refuses when an unseen row holds more games', () => {
    expect(shouldRefusePush(remote(newerRow, 8, 240), { games: 1, deaths: 240 }, seen)).toBe(true);
  });

  it('allows pushing forward onto an unseen row that holds less', () => {
    // Normal operation: another device wrote, but we are strictly ahead.
    expect(shouldRefusePush(remote(newerRow, 1, 100), { games: 1, deaths: 240 }, seen)).toBe(false);
  });

  it('allows an equal unseen row rather than nagging about a tie', () => {
    expect(shouldRefusePush(remote(newerRow, 1, 240), { games: 1, deaths: 240 }, seen)).toBe(false);
  });

  it('refuses on a first-ever push when the cloud already holds more', () => {
    // The real incident, reproduced: a phone holding 8 games and 21 deaths,
    // against a cloud row holding the good 240-death tally, with no sync marker
    // because the device had never written. More games locally is no licence to
    // overwrite — it is deaths that were nearly lost.
    expect(shouldRefusePush(remote(newerRow, 1, 240), { games: 8, deaths: 21 }, null)).toBe(true);
  });

  it('allows a first-ever push onto a row holding strictly less', () => {
    expect(shouldRefusePush(remote(newerRow, 1, 5), { games: 3, deaths: 99 }, null)).toBe(false);
  });

  it('allows the first push when there is no cloud row yet', () => {
    expect(shouldRefusePush(null, { games: 3, deaths: 99 }, null)).toBe(false);
  });
});
