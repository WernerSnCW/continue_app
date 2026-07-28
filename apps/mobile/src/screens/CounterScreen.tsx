import { useCallback, useEffect, useRef, useState } from 'react';
import { BarsIcon, SkullIcon, SwordsIcon } from '../components/icons';
import { playAdvance, playClick, playDeath } from '../lib/sound';
import {
  activeRun,
  deathsForGame,
  deathsForRun,
  deathsToday,
  runLabel,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  gameId: string;
  onBack: () => void;
  onDeath: () => void;
  onUndo: () => void;
  onAdvanceRun: () => void;
  /** Commits accumulated session seconds to the active run. */
  onLogTime: (seconds: number) => void;
  onOpenStats: () => void;
}

function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

export function CounterScreen({
  state,
  gameId,
  onBack,
  onDeath,
  onUndo,
  onAdvanceRun,
  onLogTime,
  onOpenStats,
}: Props) {
  const game = state.games.find((g) => g.id === gameId);
  const run = activeRun(state, gameId);

  // The timer is explicitly started, matching the prototype's play/pause
  // control — only clocked-in time counts toward deaths-per-hour, so idle
  // app-open time can't quietly deflate the difficulty ranking.
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const startedAt = useRef<number | null>(null);
  const [flash, setFlash] = useState<{ key: number; n: number } | null>(null);

  const committedSeconds = run?.playedSeconds ?? 0;
  const liveSeconds = running && startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  /** Flush whatever is on the clock into the store. */
  const commit = useCallback(() => {
    if (startedAt.current === null) return;
    const elapsed = (Date.now() - startedAt.current) / 1000;
    startedAt.current = null;
    if (elapsed >= 1) onLogTime(Math.floor(elapsed));
  }, [onLogTime]);

  // Leaving the screen must not silently discard a running session.
  useEffect(() => commit, [commit]);

  const toggleTimer = () => {
    playClick();
    if (running) {
      commit();
      setRunning(false);
    } else {
      startedAt.current = Date.now();
      setRunning(true);
    }
  };

  const handleBack = () => {
    playClick();
    commit();
    setRunning(false);
    onBack();
  };

  if (!game || !run) return null;

  const runDeaths = deathsForRun(state, run.id);

  const handleDeath = () => {
    onDeath();
    setFlash({ key: Date.now(), n: runDeaths + 1 });
    playDeath();
    navigator.vibrate?.(180);
  };

  void tick; // re-render pulse for the live clock

  return (
    <div className="screen">
      {flash && (
        <div key={flash.key} className="death-flash" role="status" aria-live="polite">
          <div className="txt">FALLEN — #{flash.n}</div>
        </div>
      )}

      <div className="counter-top">
        <button className="nav-btn" onClick={handleBack} aria-label="Back to games">
          ←
        </button>
        <span className="run-chip" style={{ marginBottom: 0 }}>
          <SwordsIcon /> {game.name} · {runLabel(run.cycle)}
        </span>
        <button
          className="nav-btn"
          onClick={() => {
            playClick();
            commit();
            setRunning(false);
            onOpenStats();
          }}
          aria-label="Game stats"
          style={{ marginLeft: 'auto' }}
        >
          <BarsIcon />
        </button>
      </div>

      <div className="timer-row">
        <button
          className="timer-btn"
          onClick={toggleTimer}
          aria-label={running ? 'Pause session timer' : 'Start session timer'}
        >
          {running ? (
            <span className="pause">
              <span />
              <span />
            </span>
          ) : (
            <span className="play" />
          )}
        </button>
        <span className="timer-time">Session: {formatClock(committedSeconds + liveSeconds)}</span>
        {!running && committedSeconds === 0 && (
          <span className="timer-hint">start to rank this game</span>
        )}
      </div>

      <div className="counter-mid">
        <div className="game-title">deaths this run</div>
        <div className="huge">{runDeaths}</div>
        <div className="huge-label">tap on death</div>

        <button className="tap-btn" onClick={handleDeath} aria-label="Record a death">
          <SkullIcon />
          <span>+1 DEATH</span>
        </button>

        <div className="stat-row">
          <div className="stat-pill">
            <div className="n">{deathsToday(state, gameId)}</div>
            <div className="l">today</div>
          </div>
          <div className="stat-pill">
            <div className="n">{runDeaths}</div>
            <div className="l">this run</div>
          </div>
          <div className="stat-pill">
            <div className="n">{deathsForGame(state, gameId)}</div>
            <div className="l">all-time</div>
          </div>
        </div>
      </div>

      <div className="counter-actions">
        <button
          className="text-btn"
          onClick={() => {
            playClick();
            onUndo();
          }}
          disabled={runDeaths === 0}
        >
          Undo last
        </button>
        <button
          className="text-btn"
          onClick={() => {
            playAdvance();
            onAdvanceRun();
          }}
        >
          Finish run → {runLabel(run.cycle + 1)}
        </button>
      </div>
    </div>
  );
}
