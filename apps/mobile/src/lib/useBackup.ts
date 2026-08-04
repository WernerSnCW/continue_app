import { useCallback, useEffect, useRef, useState } from 'react';
import {
  allowOverwrite,
  checkIdentityContinuity,
  getIdentity,
  isBackupConfigured,
  lastSyncedAt,
  pushBackup,
  snapshotVersion,
  type BackupState,
  type RemoteMeta,
} from './backup';
import type { AppState } from './store';

/** Wait this long after the last change before pushing. */
const DEBOUNCE_MS = 6000;
/** Never push more often than this, however busy the tapping gets. */
const MIN_INTERVAL_MS = 30_000;
/** After this long without a successful push, say so loudly. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface BackupInfo {
  state: BackupState;
  lastSavedAt: number | null;
  /**
   * Whether the backup could actually be claimed after a reinstall — i.e. an
   * email is linked. Null until we've checked. Kept distinct from "saved",
   * because a saved-but-unclaimable backup is the exact thing that looks safe
   * and isn't.
   */
  recoverable: boolean | null;
  /**
   * Set when the app is signed in as a different account than the one it last
   * knew about. Pushing is suspended while this is true — see
   * `checkIdentityContinuity`.
   */
  lostAccount: boolean;
  /** The address the backup is actually under, when the account was lost. */
  previousEmail: string | null;
  /**
   * Set when the cloud holds more than this phone does. Pushing is suspended
   * until the user picks a side — see `pushBackup`.
   */
  conflict: RemoteMeta | null;
  /** No successful push for a week — a failure that has stopped being a blip. */
  stale: boolean;
  /** Resolves a conflict in favour of what's on this phone. */
  keepLocal: () => void;
  /** Drops a conflict that a restore has already settled. */
  clearConflict: () => void;
  /** Re-check after the user links an address. */
  refreshIdentity: () => void;
}

/**
 * Backs the local state up to the cloud, quietly.
 *
 * Debounced and rate limited because the counter is a button people hammer —
 * a push per death would be hundreds of requests in a session, and the backup
 * only has to be recent, not live. The running play-time clock is deliberately
 * excluded from the change signal too, or the ticking seconds alone would keep
 * the debounce permanently reset.
 */
/**
 * @param paused Suspends pushing. Set while the restore flow is open.
 *
 * Signing in during a restore switches the session to the account that owns
 * the backup — at which point a routine push would send the *local* state to
 * that account and overwrite the very snapshot being restored, moments before
 * it's read. Backing up is never so urgent that it can't wait for the user to
 * finish deciding.
 */
export function useBackup(state: AppState, paused = false): BackupInfo {
  const [pushState, setPushState] = useState<{ state: BackupState; lastSavedAt: number | null }>({
    state: 'idle',
    // Seeded from disk so the age of the last backup survives a restart.
    lastSavedAt: lastSyncedAt(),
  });
  const [recoverable, setRecoverable] = useState<boolean | null>(null);
  const [continuity, setContinuity] = useState<{
    lostAccount: boolean;
    previousEmail: string | null;
  }>({ lostAccount: false, previousEmail: null });
  const [conflict, setConflict] = useState<RemoteMeta | null>(null);
  const lastPushAt = useRef(0);
  const inFlight = useRef(false);
  /** State as it stood at launch; a push only happens once it differs. */
  const baseline = useRef<string | null>(null);

  const refreshIdentity = useCallback(() => {
    if (!isBackupConfigured) return;
    void getIdentity().then((id) => setRecoverable(!id.anonymous));
    void checkIdentityContinuity().then(setContinuity);
  }, []);

  useEffect(() => refreshIdentity(), [refreshIdentity]);

  // Only the durable parts. Timer start times change every render they're
  // read, and would defeat the debounce.
  const signature = JSON.stringify({
    games: state.games,
    runs: state.runs,
    deaths: state.deaths.length,
    entitlement: state.entitlement,
  });

  useEffect(() => {
    if (!isBackupConfigured) return;

    // Never push on launch. The effect runs once on mount, so without this the
    // app uploads whatever is locally present a few seconds after every open —
    // meaning a stale phone silently overwrites a newer cloud backup before the
    // user can even reach the restore screen. Only real changes get saved.
    if (baseline.current === null) {
      baseline.current = signature;
      return;
    }
    if (paused) return;
    // Signed in as somebody else. Writing now would create a second, competing
    // backup under the wrong account and leave the real one to rot, so nothing
    // goes out until the user has been told and has signed back in.
    if (continuity.lostAccount) return;
    if (conflict) return;

    const wait = Math.max(DEBOUNCE_MS, lastPushAt.current + MIN_INTERVAL_MS - Date.now());

    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPushState((i) => ({ ...i, state: 'saving' }));

      const result = await pushBackup(state, {
        games: state.games.length,
        deaths: state.deaths.length,
      });

      inFlight.current = false;
      if (result.conflict) {
        // Stop pushing entirely. Retrying would only ask the same question
        // again, and the answer has to come from the user.
        setConflict(result.conflict);
        setPushState((i) => ({ ...i, state: 'error' }));
        return;
      }
      if (result.ok) {
        lastPushAt.current = Date.now();
        setPushState({ state: 'saved', lastSavedAt: result.at ?? Date.now() });
        // Lay down a retained snapshot alongside the live row. Rate limited
        // internally, so this is cheap on most pushes.
        void snapshotVersion(
          state,
          { games: state.games.length, deaths: state.deaths.length },
          'periodic',
        );
      } else {
        // Failing to back up is never worth interrupting play over; the next
        // change will try again.
        setPushState((i) => ({ ...i, state: navigator.onLine ? 'error' : 'offline' }));
      }
    }, wait);

    return () => clearTimeout(timer);
    // `paused` is a dependency so leaving the restore flow schedules a push of
    // whatever state won — restored or kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, paused, continuity.lostAccount, conflict]);

  /**
   * A backup that has quietly not happened for a week. Distinct from the
   * transient error state, which is expected and self-healing — this is the one
   * that has stopped being a blip. Only meaningful once the device has managed
   * at least one successful push; before that, "not recoverable yet" already
   * covers it.
   */
  const stale =
    pushState.lastSavedAt !== null && Date.now() - pushState.lastSavedAt > STALE_AFTER_MS;

  const clearConflict = useCallback(() => setConflict(null), []);
  const keepLocal = useCallback(() => {
    allowOverwrite();
    setConflict(null);
  }, []);

  return {
    ...pushState,
    recoverable,
    ...continuity,
    conflict,
    stale,
    keepLocal,
    clearConflict,
    refreshIdentity,
  };
}
