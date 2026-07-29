import { useCallback, useEffect, useRef, useState } from 'react';
import { BarsIcon, SkullIcon, SwordsIcon } from '../components/icons';
import { HelpTip } from '../components/HelpTip';
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
  /** runSeconds is where in the run's play time the death landed, if timing. */
  onDeath: (runSeconds: number | null) => void;
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
  const [, setTick] = useState(0);
  const startedAt = useRef<number | null>(null);
  const [flash, setFlash] = useState<{ key: number; n: number } | null>(null);
  // Offer the tracker on arrival. Most people won't find a play/pause button
  // on their own, and without logged time the ranking has nothing to work with.
  const [showPrompt, setShowPrompt] = useState(true);

  const committedSeconds = run?.playedSeconds ?? 0;
  const liveSeconds = running && startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;
  const sessionSeconds = committedSeconds + liveSeconds;

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

  // Commit on unmount only. This deliberately reads through a ref rather than
  // depending on `commit`: the parent hands down a fresh onLogTime closure on
  // every render, so a [commit] dependency would re-run this effect — and fire
  // its cleanup — on every state change, stopping the clock dead on the first
  // death tap and silently discarding the rest of the session.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);

  const startTimer = () => {
    startedAt.current = Date.now();
    setRunning(true);
    setShowPrompt(false);
  };

  const toggleTimer = () => {
    playClick();
    if (running) {
      commit();
      setRunning(false);
    } else {
      startTimer();
    }
  };

  const leaveWith = (go: () => void) => {
    playClick();
    commit();
    setRunning(false);
    go();
  };

  if (!game || !run) return null;

  const runDeaths = deathsForRun(state, run.id);
  // Below a few minutes the rate is arithmetically true but useless — two
  // deaths in the first minute extrapolates to 120/hr. Wait for enough clock
  // that the number means something.
  const PACE_MIN_SECONDS = 300;
  const paceReady = sessionSeconds >= PACE_MIN_SECONDS && runDeaths > 0;
  const pace = paceReady ? runDeaths / (sessionSeconds / 3600) : null;

  const handleDeath = () => {
    // Timestamp the death against the run clock so the stats screen can lay
    // out a timeline. Null when not timing — the death still counts.
    onDeath(running ? Math.floor(sessionSeconds) : null);
    setFlash({ key: Date.now(), n: runDeaths + 1 });
    playDeath();
    navigator.vibrate?.(180);
  };

  return (
    <div className="screen counter-screen">
      {game.coverUrl && (
        <div
          className="cover-backdrop"
          style={{ backgroundImage: `url(${game.coverUrl})` }}
          aria-hidden="true"
        />
      )}

      {flash && (
        <div key={flash.key} className="death-flash" role="status" aria-live="polite">
          <div className="txt">FALLEN — #{flash.n}</div>
        </div>
      )}

      <div className="counter-top">
        <button className="nav-btn" onClick={() => leaveWith(onBack)} aria-label="Back to games">
          ←
        </button>
        <span className="run-chip" style={{ marginBottom: 0 }}>
          <SwordsIcon /> {game.name} · {runLabel(run.cycle)}
        </span>
        <button
          className="nav-btn"
          onClick={() => leaveWith(onOpenStats)}
          aria-label="Game stats"
          style={{ marginLeft: 'auto' }}
        >
          <BarsIcon />
        </button>
      </div>

      {/* Not a single <button> wrapping everything — the help tip is itself a
          button, and nesting them is invalid HTML that also swallows clicks. */}
      <div className={`timer-row${running ? ' is-running' : ''}`}>
        <button
          className="timer-main"
          onClick={toggleTimer}
          aria-label={running ? 'Pause play time tracker' : 'Start play time tracker'}
        >
          <span className="timer-btn">
            {running ? (
              <span className="pause">
                <span />
                <span />
              </span>
            ) : (
              <span className="play" />
            )}
          </span>
          <span className="timer-meta">
            <span className="timer-label">Play time tracker</span>
            <span className="timer-time">{formatClock(sessionSeconds)}</span>
          </span>
        </button>
        <span className={`timer-state${running ? ' on' : ''}`}>
          {running ? 'RECORDING' : committedSeconds === 0 ? 'NOT STARTED' : 'PAUSED'}
        </span>
        <HelpTip title="Play time tracker">
          Counts only while it's running, so breaks and idle time don't count against you. It's what
          turns a raw death count into <strong>deaths per hour</strong> — which is how this game gets
          scored and ranked against the others you're tracking.
          <br />
          <br />
          Without any logged time a game still counts deaths, it just can't be ranked.
        </HelpTip>
      </div>

      {showPrompt && !running && (
        <div className="tracker-prompt" role="dialog" aria-label="Start play time tracker">
          <div className="tp-title">Start the play time tracker?</div>
          <p className="tp-body">
            Deaths alone don't say how hard a game was — 200 deaths over 60 hours is a very
            different story from 200 in six. Running the tracker records how long you actually
            played, which unlocks your <strong>deaths per hour</strong> and lets this game be
            scored in the difficulty ranking.
          </p>
          <p className="tp-body tp-quiet">
            It only counts while it's running. Pause it any time — nothing is lost.
          </p>
          <div className="tp-actions">
            <button
              className="tp-ghost"
              onClick={() => {
                playClick();
                setShowPrompt(false);
              }}
            >
              Not now
            </button>
            <button
              className="tp-primary"
              onClick={() => {
                playClick();
                startTimer();
              }}
            >
              Start tracking
            </button>
          </div>
        </div>
      )}

      <div className="counter-mid">
        <div className="game-title">deaths this run</div>
        <div className="huge">{runDeaths}</div>
        <div className="huge-label">tap on death</div>

        <button className="tap-btn" onClick={handleDeath} aria-label="Record a death">
          <SkullIcon />
          <span>+1 DEATH</span>
        </button>

        <div className="pace-line">
          {pace !== null ? (
            <>
              <strong>{pace.toFixed(1)}</strong> deaths/hr at this pace
            </>
          ) : sessionSeconds === 0 ? (
            <>start the tracker to see your pace</>
          ) : (
            <>settling in — pace shows after a few minutes</>
          )}
          <HelpTip title="Deaths per hour">
            Your death count divided by the time you've logged on the clock for this run. It only
            counts while the timer is running, so pausing for a break won't make you look better
            than you are. This is what the difficulty ranking compares across your games.
          </HelpTip>
        </div>

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
