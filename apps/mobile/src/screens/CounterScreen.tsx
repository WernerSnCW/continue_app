import { useEffect, useRef, useState } from 'react';
import { activeRun, deathsForGame, deathsForRun, runLabel, type AppState } from '../lib/store';

interface Props {
  state: AppState;
  gameId: string;
  onBack: () => void;
  onDeath: () => void;
  onUndo: () => void;
  onAdvanceRun: () => void;
}

/** mm:ss, or h:mm:ss once you've been at it that long. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function CounterScreen({ state, gameId, onBack, onDeath, onUndo, onAdvanceRun }: Props) {
  const game = state.games.find((g) => g.id === gameId);
  const run = activeRun(state, gameId);

  // Session timer runs from when this screen opened, not from run start — it's
  // "how long have you been playing right now", which is what you want to see
  // next to a death count.
  const sessionStart = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - sessionStart.current), 1000);
    return () => clearInterval(t);
  }, []);

  if (!game || !run) return null;

  const runDeaths = deathsForRun(state, run.id);
  const totalDeaths = deathsForGame(state, gameId);

  const handleDeath = () => {
    onDeath();
    setFlashKey((k) => k + 1); // remount the overlay so the animation replays
    navigator.vibrate?.(180);
  };

  return (
    <div className="screen counter-screen">
      {flashKey > 0 && (
        <div key={flashKey} className="death-flash" role="status" aria-live="polite">
          <span className="death-flash-text">YOU DIED</span>
        </div>
      )}

      <header className="counter-head">
        <button className="btn-ghost" onClick={onBack} aria-label="Back to games">
          ←
        </button>
        <span className="counter-game">{game.name}</span>
        <button className="btn-ghost btn-run" onClick={onAdvanceRun} title="Start next run">
          {runLabel(run.cycle)}
        </button>
      </header>

      <button className="death-tap" onClick={handleDeath} aria-label="Record a death">
        <span className="death-count">{runDeaths}</span>
        <span className="death-caption">deaths this run</span>
        <span className="death-hint">tap anywhere to count</span>
      </button>

      <div className="counter-foot">
        <div className="stat">
          <span className="stat-value">{formatElapsed(elapsed)}</span>
          <span className="stat-label">session</span>
        </div>
        <div className="stat">
          <span className="stat-value">{totalDeaths}</span>
          <span className="stat-label">all runs</span>
        </div>
        <button className="btn-ghost" onClick={onUndo} disabled={runDeaths === 0}>
          Undo
        </button>
      </div>
    </div>
  );
}
