import { useCallback, useEffect, useRef, useState } from 'react';
import { getIdentity, isBackupConfigured, pushBackup, type BackupState } from './backup';
import type { AppState } from './store';

/** Wait this long after the last change before pushing. */
const DEBOUNCE_MS = 6000;
/** Never push more often than this, however busy the tapping gets. */
const MIN_INTERVAL_MS = 30_000;

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
    lastSavedAt: null,
  });
  const [recoverable, setRecoverable] = useState<boolean | null>(null);
  const lastPushAt = useRef(0);
  const inFlight = useRef(false);

  const refreshIdentity = useCallback(() => {
    if (!isBackupConfigured) return;
    void getIdentity().then((id) => setRecoverable(!id.anonymous));
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
    if (!isBackupConfigured || paused) return;

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
      if (result.ok) {
        lastPushAt.current = Date.now();
        setPushState({ state: 'saved', lastSavedAt: result.at ?? Date.now() });
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
  }, [signature, paused]);

  return { ...pushState, recoverable, refreshIdentity };
}
