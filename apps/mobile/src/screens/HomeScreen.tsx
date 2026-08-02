import { useEffect, useState } from 'react';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { isBackupConfigured } from '../lib/backup';
import { isMockBilling } from '../lib/billing';
import { isMuted, playClick, playDeath, setMuted } from '../lib/sound';
import { BarsIcon, SkullIcon } from '../components/icons';
import { Logo } from '../components/Logo';
import { formatHours } from '../lib/ranking';
import {
  activeRun,
  deathsForRun,
  lastPlayedGame,
  lifetimeTotals,
  liveSecondsFor,
  runLabel,
  visibleGames,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  onOpenGame: (gameId: string) => void;
  onOpenGamesList: () => void;
  onAddGame: () => void;
  onOpenRanking: () => void;
  onOpenPaywall: () => void;
  onRevertUnlock: () => void;
  onOpenBackup: () => void;
  backup: { state: string; lastSavedAt: number | null };
  onDeath: (gameId: string, runSeconds: number | null) => void;
  onStartTimer: (gameId: string, runId: string) => void;
  onStopTimer: () => void;
}

function backupLabel(state: string, lastSavedAt: number | null): string {
  if (state === 'saving') return 'Backing up…';
  if (state === 'offline') return 'Offline — will back up later';
  if (state === 'error') return 'Backup failed — will retry';
  if (!lastSavedAt) return 'Backup pending';
  const mins = Math.floor((Date.now() - lastSavedAt) / 60000);
  if (mins < 1) return 'Backed up just now';
  if (mins < 60) return `Backed up ${mins}m ago`;
  return `Backed up ${Math.floor(mins / 60)}h ago`;
}

const clock = (totalSeconds: number): string => {
  const s = Math.floor(totalSeconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

/**
 * Summary screen.
 *
 * The job someone opens this app to do is "I just died, count it" — so the
 * game they're actually playing gets the whole top of the screen with the tap
 * target on it, and everything else is a summary. The full library is one tap
 * away rather than being the first thing they have to scroll past.
 */
export function HomeScreen({
  state,
  onOpenGame,
  onOpenGamesList,
  onAddGame,
  onOpenRanking,
  onOpenPaywall,
  onRevertUnlock,
  onOpenBackup,
  backup,
  onDeath,
  onStartTimer,
  onStopTimer,
}: Props) {
  const [muted, setMutedState] = useState(isMuted());
  const [flash, setFlash] = useState<{ key: number; n: number } | null>(null);
  const [, setTick] = useState(0);

  const games = visibleGames(state);
  const unlimited = state.entitlement.unlimitedGames;
  const featured = lastPlayedGame(state);
  const run = featured ? activeRun(state, featured.id) : undefined;
  const timing = !!run && state.timer?.runId === run.id;
  const totals = lifetimeTotals(state);

  // Only ticks while this screen is showing a running clock.
  useEffect(() => {
    if (!timing) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timing]);

  const sessionSeconds = run ? run.playedSeconds + liveSecondsFor(state, run.id) : 0;
  const runDeaths = run ? deathsForRun(state, run.id) : 0;

  const logDeath = () => {
    if (!featured || !run) return;
    onDeath(featured.id, timing ? Math.floor(sessionSeconds) : null);
    setFlash({ key: Date.now(), n: runDeaths + 1 });
    playDeath();
    navigator.vibrate?.(180);
  };

  return (
    <div className="screen">
      {flash && (
        <div key={flash.key} className="death-flash" role="status" aria-live="polite">
          <div className="txt">FALLEN — #{flash.n}</div>
        </div>
      )}

      <div className="brand-row">
        <Logo size={26} />
        <div className="grow">
          <h2>Continue?</h2>
          <div className="tag">your tally. your bragging rights.</div>
        </div>
        <button
          className="nav-btn"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
            if (!next) playClick();
          }}
          aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          aria-pressed={muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          className="nav-btn"
          onClick={() => {
            playClick();
            onOpenRanking();
          }}
          aria-label="Difficulty ranking"
        >
          <BarsIcon />
        </button>
      </div>

      {featured ? (
        <div className="last-played">
          <button className="lp-head" onClick={() => onOpenGame(featured.id)}>
            {featured.coverUrl ? (
              <img className="lp-cover" src={featured.coverUrl} alt="" />
            ) : (
              <span className="lp-cover lp-cover-blank" aria-hidden="true" />
            )}
            <span className="lp-meta">
              <span className="lp-label">Last played</span>
              <span className="lp-name">{featured.name}</span>
              <span className="lp-run">
                {run ? runLabel(run.cycle) : 'no active run'}
                {run ? ` · ${runDeaths} death${runDeaths === 1 ? '' : 's'}` : ''}
              </span>
            </span>
            <span className="lp-chev" aria-hidden="true">
              ›
            </span>
          </button>

          {run ? (
            <>
              <button className="lp-death" onClick={logDeath}>
                <SkullIcon />
                <span>+1 DEATH</span>
              </button>

              <div className={`lp-timer${timing ? ' is-running' : ''}`}>
                <button
                  className="timer-btn"
                  onClick={() => {
                    playClick();
                    if (timing) onStopTimer();
                    else onStartTimer(featured.id, run.id);
                  }}
                  aria-label={timing ? 'Pause play time tracker' : 'Start play time tracker'}
                >
                  {timing ? (
                    <span className="pause">
                      <span />
                      <span />
                    </span>
                  ) : (
                    <span className="play" />
                  )}
                </button>
                <span className="timer-time">{clock(sessionSeconds)}</span>
                <span className={`timer-state${timing ? ' on' : ''}`}>
                  {timing ? 'RECORDING' : sessionSeconds === 0 ? 'NOT STARTED' : 'PAUSED'}
                </span>
              </div>
            </>
          ) : (
            <button className="lp-death is-finished" onClick={() => onOpenGame(featured.id)}>
              <span>Run finished — start a new one</span>
            </button>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <div className="big">No games tracked yet</div>
          <div>Add one to start the tally.</div>
        </div>
      )}

      <div className="tile-row">
        <button className="nav-tile" onClick={() => {
          playClick();
          onOpenGamesList();
        }}>
          <span className="nt-n">{games.length}</span>
          <span className="nt-l">game{games.length === 1 ? '' : 's'} tracked</span>
          <span className="nt-hint">view all ›</span>
        </button>
        <button className="nav-tile accent" onClick={() => {
          playClick();
          onAddGame();
        }}>
          <span className="nt-plus" aria-hidden="true">
            +
          </span>
          <span className="nt-l">track another game</span>
        </button>
      </div>

      <div className="tile-grid summary">
        <div className="tile">
          <div className="tile-n">{totals.deaths}</div>
          <div className="tile-l">total deaths</div>
        </div>
        <div className="tile">
          <div className="tile-n">{totals.seconds > 0 ? formatHours(totals.seconds) : '—'}</div>
          <div className="tile-l">time played</div>
        </div>
        <div className="tile">
          <div className="tile-n">
            {totals.ratePerHour !== null ? totals.ratePerHour.toFixed(1) : '—'}
          </div>
          <div className="tile-l">deaths / hr</div>
        </div>
      </div>

      {games.length === 0 && (
        <button className="primary-btn" onClick={onAddGame}>
          Add your first game
        </button>
      )}

      {isBackupConfigured && games.length > 0 && (
        <button
          className={`backup-line${backup.state === 'saving' ? ' is-saving' : ''}`}
          onClick={() => {
            playClick();
            onOpenBackup();
          }}
        >
          {backupLabel(backup.state, backup.lastSavedAt)} ›
        </button>
      )}

      {!unlimited && (
        <button
          className="upsell-bar"
          onClick={() => {
            playClick();
            onOpenPaywall();
          }}
        >
          <p className="t1">Free plan: {FREE_TIER_GAME_LIMIT} games</p>
          <p className="t2">Unlock unlimited games + global average — $1.99 one-time</p>
        </button>
      )}

      {/* Test builds only (VITE_MOCK_PURCHASE), so the unlocked and free
          experiences can both be exercised on a real device. Compiled out of
          any build headed for the store. */}
      {unlimited && isMockBilling && (
        <button className="revert-link" onClick={onRevertUnlock}>
          Unlocked · test build — revert to free plan
        </button>
      )}
    </div>
  );
}
