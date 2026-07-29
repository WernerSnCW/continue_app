import { useEffect, useState } from 'react';
import { BarsIcon, SkullIcon, SwordsIcon } from '../components/icons';
import { HelpTip } from '../components/HelpTip';
import { playAdvance, playClick, playDeath } from '../lib/sound';
import {
  activeRun,
  deathsForGame,
  deathsForRun,
  deathsToday,
  latestRun,
  liveSecondsFor,
  nextCycle,
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
  onFinishRun: () => void;
  onStartRun: (cycle: number) => void;
  onResetRun: () => void;
  onArchiveRun: (runId: string) => void;
  onStartTimer: (runId: string) => void;
  onStopTimer: () => void;
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
  onFinishRun,
  onStartRun,
  onResetRun,
  onArchiveRun,
  onStartTimer,
  onStopTimer,
  onOpenStats,
}: Props) {
  const game = state.games.find((g) => g.id === gameId);
  const run = activeRun(state, gameId);
  const last = latestRun(state, gameId);

  // The tracker now lives in app state, not here — it has to keep running
  // while you browse other screens, and survive the app being backgrounded.
  const running = state.timer?.runId === run?.id && !!run;
  const [, setTick] = useState(0);
  const [flash, setFlash] = useState<{ key: number; n: number } | null>(null);
  const [showPrompt, setShowPrompt] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'discard' | null>(null);

  const committedSeconds = run?.playedSeconds ?? 0;
  const liveSeconds = run ? liveSecondsFor(state, run.id) : 0;
  const sessionSeconds = committedSeconds + liveSeconds;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startTimer = () => {
    if (!run) return;
    onStartTimer(run.id);
    setShowPrompt(false);
  };

  const toggleTimer = () => {
    playClick();
    if (running) onStopTimer();
    else startTimer();
  };

  // Leaving no longer stops the clock — that's the whole point of hoisting it.
  const leaveWith = (go: () => void) => {
    playClick();
    go();
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirm(null);
  };

  if (!game) return null;

  const runDeaths = run ? deathsForRun(state, run.id) : last ? deathsForRun(state, last.id) : 0;
  const PACE_MIN_SECONDS = 300;
  const paceReady = sessionSeconds >= PACE_MIN_SECONDS && runDeaths > 0;
  const pace = paceReady ? runDeaths / (sessionSeconds / 3600) : null;

  const handleDeath = () => {
    if (!run) return;
    onDeath(running ? Math.floor(sessionSeconds) : null);
    setFlash({ key: Date.now(), n: runDeaths + 1 });
    playDeath();
    navigator.vibrate?.(180);
  };

  const chipLabel = run ? runLabel(run.cycle) : last ? `${runLabel(last.cycle)} · finished` : 'NG';

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
          <SwordsIcon /> {game.name} · {chipLabel}
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

      {run && (
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
            Counts only while it's running, so breaks and idle time don't count against you. It's
            what turns a raw death count into <strong>deaths per hour</strong> — which is how this
            game gets scored and ranked against the others you're tracking.
          </HelpTip>
        </div>
      )}

      {run && showPrompt && !running && (
        <div className="tracker-prompt" role="dialog" aria-label="Start play time tracker">
          <div className="tp-title">Start the play time tracker?</div>
          <p className="tp-body">
            Deaths alone don't say how hard a game was — 200 deaths over 60 hours is a very
            different story from 200 in six. Running the tracker records how long you actually
            played, which unlocks your <strong>deaths per hour</strong> and lets this game be
            scored in the difficulty ranking.
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

      {/* No active run: the last one is finished and locked. Nothing can be
          added to it — the player picks what comes next. */}
      {!run ? (
        <div className="counter-mid">
          <div className="run-done">
            <div className="rd-title">Run finished</div>
            <p className="rd-body">
              {last ? (
                <>
                  Your {runLabel(last.cycle)} run is locked at{' '}
                  <strong>{deathsForRun(state, last.id)} deaths</strong>. It'll stay in this game's
                  stats exactly as it is.
                </>
              ) : (
                <>Start a run to begin counting.</>
              )}
            </p>
            <div className="rd-actions">
              <button
                className="primary-btn"
                onClick={() => {
                  playAdvance();
                  onStartRun(nextCycle(state, gameId));
                }}
              >
                Start {runLabel(nextCycle(state, gameId))} — next cycle
              </button>
              <button
                className="text-btn wide"
                onClick={() => {
                  playClick();
                  onStartRun(0);
                }}
              >
                Start a fresh playthrough (NG)
              </button>
            </div>
          </div>
        </div>
      ) : (
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
              Your death count divided by the time logged on the tracker for this run. It only
              counts while the tracker is running, so pausing for a break won't flatter your
              numbers. This is what the difficulty ranking compares across your games.
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
      )}

      <div className="counter-actions">
        {run && (
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
        )}
        <button
          className="text-btn"
          onClick={() => {
            playClick();
            setMenuOpen(true);
          }}
        >
          Run options
        </button>
      </div>

      {menuOpen && (
        <>
          <button className="sheet-scrim" onClick={closeMenu} aria-label="Close" />
          <div className="sheet" role="dialog" aria-label="Run options">
            <div className="sheet-title">
              {run ? `${runLabel(run.cycle)} — in progress` : 'Run options'}
            </div>

            {confirm === null && (
              <>
                {run && (
                  <button
                    className="sheet-row"
                    onClick={() => {
                      playAdvance();
                      onFinishRun();
                      closeMenu();
                    }}
                  >
                    <span className="sr-name">Finish this run</span>
                    <span className="sr-note">
                      Locks it at {runDeaths} deaths. Nothing more can be added, and it stays in
                      your stats.
                    </span>
                  </button>
                )}

                <button
                  className="sheet-row"
                  onClick={() => {
                    playClick();
                    onStartRun(nextCycle(state, gameId));
                    closeMenu();
                  }}
                >
                  <span className="sr-name">
                    Start {runLabel(nextCycle(state, gameId))} (next cycle)
                  </span>
                  <span className="sr-note">
                    Finishes the current run and opens the next NG+ cycle.
                  </span>
                </button>

                <button
                  className="sheet-row"
                  onClick={() => {
                    playClick();
                    onStartRun(0);
                    closeMenu();
                  }}
                >
                  <span className="sr-name">Start a fresh playthrough (NG)</span>
                  <span className="sr-note">
                    A brand new run from the beginning, counted separately.
                  </span>
                </button>

                <button className="sheet-row" onClick={() => setConfirm('reset')}>
                  <span className="sr-name">Reset this run</span>
                  <span className="sr-note">
                    Back to zero on the same cycle. The old attempt is archived, not erased.
                  </span>
                </button>

                <button className="sheet-row danger" onClick={() => setConfirm('discard')}>
                  <span className="sr-name">Discard this run</span>
                  <span className="sr-note">
                    Removes it from your totals and stats. Kept in storage, never deleted.
                  </span>
                </button>
              </>
            )}

            {confirm === 'reset' && (
              <div className="sheet-confirm">
                <p>
                  Reset {runLabel((run ?? last)!.cycle)} back to zero deaths? The current attempt is
                  archived, so nothing is lost.
                </p>
                <div className="sheet-confirm-actions">
                  <button className="tp-ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                  <button
                    className="tp-primary"
                    onClick={() => {
                      playClick();
                      onResetRun();
                      closeMenu();
                    }}
                  >
                    Reset run
                  </button>
                </div>
              </div>
            )}

            {confirm === 'discard' && (
              <div className="sheet-confirm">
                <p>
                  Discard this run? Its {runDeaths} deaths stop counting toward {game.name}. The
                  data stays in storage.
                </p>
                <div className="sheet-confirm-actions">
                  <button className="tp-ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                  <button
                    className="tp-primary"
                    onClick={() => {
                      playClick();
                      const target = run ?? last;
                      if (target) onArchiveRun(target.id);
                      closeMenu();
                    }}
                  >
                    Discard run
                  </button>
                </div>
              </div>
            )}

            <button className="sheet-cancel" onClick={closeMenu}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
