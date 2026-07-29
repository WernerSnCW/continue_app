import { useEffect, useState } from 'react';

interface Props {
  gameName: string;
  /** Seconds already committed to the run. */
  baseSeconds: number;
  /** Epoch ms the clock started. Elapsed is derived here, not passed in. */
  startedAt: number;
  /** Jump to the counter for the game being timed. */
  onOpen: () => void;
  onPause: () => void;
}

function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/**
 * Persistent "still recording" bar, shown on every screen except the counter
 * of the game being timed (which already shows the full tracker).
 *
 * Without this, a running clock is invisible the moment you navigate away —
 * which is exactly when it's easiest to forget it's going.
 */
export function TimerBar({ gameName, baseSeconds, startedAt, onOpen, onPause }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Derived on every tick rather than taken as a prop: a precomputed number
  // would only refresh when the parent happens to re-render, leaving the clock
  // visibly stuck while the tracker was in fact still running.
  const seconds = baseSeconds + Math.max(0, (Date.now() - startedAt) / 1000);

  return (
    <div className="timer-bar" role="status">
      <button className="tb-main" onClick={onOpen}>
        <span className="tb-dot" aria-hidden="true" />
        <span className="tb-text">
          <span className="tb-game">{gameName}</span>
          <span className="tb-sub">play time recording</span>
        </span>
        <span className="tb-clock">{formatClock(seconds)}</span>
      </button>
      <button className="tb-pause" onClick={onPause} aria-label="Pause play time tracker">
        <span className="pause">
          <span />
          <span />
        </span>
      </button>
    </div>
  );
}
