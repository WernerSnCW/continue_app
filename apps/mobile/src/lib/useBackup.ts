import { useEffect, useRef, useState } from 'react';
import { isBackupConfigured, pushBackup, type BackupState } from './backup';
import type { AppState } from './store';

/** Wait this long after the last change before pushing. */
const DEBOUNCE_MS = 6000;
/** Never push more often than this, however busy the tapping gets. */
const MIN_INTERVAL_MS = 30_000;

export interface BackupInfo {
  state: BackupState;
  lastSavedAt: number | null;
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
export function useBackup(state: AppState): BackupInfo {
  const [info, setInfo] = useState<BackupInfo>({ state: 'idle', lastSavedAt: null });
  const lastPushAt = useRef(0);
  const inFlight = useRef(false);

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

    const wait = Math.max(DEBOUNCE_MS, lastPushAt.current + MIN_INTERVAL_MS - Date.now());

    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setInfo((i) => ({ ...i, state: 'saving' }));

      const result = await pushBackup(state, {
        games: state.games.length,
        deaths: state.deaths.length,
      });

      inFlight.current = false;
      if (result.ok) {
        lastPushAt.current = Date.now();
        setInfo({ state: 'saved', lastSavedAt: result.at ?? Date.now() });
      } else {
        // Failing to back up is never worth interrupting play over; the next
        // change will try again.
        setInfo((i) => ({ ...i, state: navigator.onLine ? 'error' : 'offline' }));
      }
    }, wait);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return info;
}
