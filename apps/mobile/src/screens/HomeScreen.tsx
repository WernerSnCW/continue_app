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
  onOpenAbout: () => void;
  backup: {
    state: string;
    lastSavedAt: number | null;
    recoverable: boolean | null;
    lostAccount: boolean;
    previousEmail: string | null;
    conflict: { updatedAt: string; games: number; deaths: number } | null;
    stale: boolean;
    optedOut: boolean;
    keepLocal: () => void;
  };
  onDeath: (gameId: string, runSeconds: number | null) => void;
  onStartTimer: (gameId: string, runId: string) => void;
  onStopTimer: () => void;
}

/**
 * A backup with no email attached is saved but unclaimable — a reinstall
 * creates a new anonymous identity that can't prove the old row is theirs. So
 * "Backed up just now" would be a comfortable lie; the state that matters is
 * whether it can actually be got back.
 */
/**
 * Short status only — the line already carries the "Backup & restore" label.
 *
 * Ordered worst-first: each state below is only reachable because none of the
 * ones above it apply.
 */
function backupLabel(b: Props['backup']): string {
  const { state, lastSavedAt, recoverable, lostAccount, conflict, optedOut } = b;
  if (optedOut) return 'off — account deleted';
  if (lostAccount) return 'signed out — not saving';
  if (conflict) return 'needs your attention';
  if (state === 'saving') return 'saving…';
  if (state === 'offline') return 'offline, will retry';
  if (state === 'error') return 'failed, will retry';
  if (recoverable === false) return 'not recoverable yet';
  if (!lastSavedAt) return 'pending';
  const mins = Math.floor((Date.now() - lastSavedAt) / 60000);
  if (mins < 1) return 'saved just now';
  if (mins < 60) return `saved ${mins}m ago`;
  if (mins < 1440) return `saved ${Math.floor(mins / 60)}h ago`;
  return `saved ${Math.floor(mins / 1440)}d ago`;
}

const NUDGE_KEY = 'continue.protectNudge.v1';

/**
 * Only worth interrupting someone once they'd actually be upset to lose the
 * data. Asking at first launch is the signup wall this app deliberately
 * avoids; asking after they've lost the phone is too late.
 */
const NUDGE_AFTER_DEATHS = 50;
const NUDGE_AFTER_GAMES = 2;

const nudgeDismissed = (): boolean => {
  try {
    return localStorage.getItem(NUDGE_KEY) === '1';
  } catch {
    return false;
  }
};

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
  onOpenAbout,
  backup,
  onDeath,
  onStartTimer,
  onStopTimer,
}: Props) {
  const [muted, setMutedState] = useState(isMuted());
  const [flash, setFlash] = useState<{ key: number; n: number } | null>(null);
  const [, setTick] = useState(0);
  const [nudgeHidden, setNudgeHidden] = useState(nudgeDismissed);

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

      {/* Loud, not dismissible, and above everything else: this is the one
          state where the app is quietly not protecting anything. */}
      {backup.lostAccount && (
        <div className="lost-account">
          <div className="la-title">You've been signed out</div>
          <p className="la-body">
            This phone was backing up to <strong>{backup.previousEmail}</strong> and no longer is.
            Nothing has been lost — your tally is safe on this phone, and that backup is untouched —
            but <strong>new deaths aren't being saved to the cloud</strong> until you sign back in.
          </p>
          <button
            className="tp-primary"
            onClick={() => {
              playClick();
              onOpenBackup();
            }}
          >
            Sign back in
          </button>
        </div>
      )}

      {/* A week of failed pushes reads the same as a working app if the only
          sign is a status line. It gets a banner. */}
      {/* Only once the backup is actually claimable. Telling someone with no
          email that their backup is a week old buries the bigger problem —
          that it was never theirs to get back. The nudge below handles that. */}
      {backup.stale &&
        backup.recoverable === true &&
        !backup.lostAccount &&
        !backup.conflict &&
        !backup.optedOut && (
        <div className="lost-account">
          <div className="la-title">Backup hasn't run in a while</div>
          <p className="la-body">
            Your last cloud backup was{' '}
            <strong>{new Date(backup.lastSavedAt!).toLocaleDateString()}</strong>. Everything since
            then is only on this phone. It usually means the app hasn't had a working connection —
            open it once on wifi and it should catch up on its own.
          </p>
          <button
            className="tp-primary"
            onClick={() => {
              playClick();
              onOpenBackup();
            }}
          >
            Check backup
          </button>
        </div>
      )}

      {/* The cloud holds more than this phone does. Neither side is obviously
          right, so the app holds still and asks rather than picking one. */}
      {backup.conflict && !backup.lostAccount && (
        <div className="lost-account">
          <div className="la-title">Your cloud backup is ahead</div>
          <p className="la-body">
            The backup holds <strong>{backup.conflict.deaths} deaths</strong> across{' '}
            {backup.conflict.games} game{backup.conflict.games === 1 ? '' : 's'}, saved{' '}
            {new Date(backup.conflict.updatedAt).toLocaleString()}. This phone has fewer.{' '}
            <strong>Nothing is being saved until you choose</strong>, so neither copy can overwrite
            the other by accident.
          </p>
          <div className="pn-actions">
            <button
              className="tp-ghost"
              onClick={() => {
                playClick();
                backup.keepLocal();
              }}
            >
              Keep this phone
            </button>
            <button
              className="tp-primary"
              onClick={() => {
                playClick();
                onOpenBackup();
              }}
            >
              Look at the backup
            </button>
          </div>
        </div>
      )}

      {/* Asked once, when there's finally something worth losing. A "no" is
          permanent — the home line keeps telling the truth either way. */}
      {isBackupConfigured &&
        !backup.lostAccount &&
        !backup.conflict &&
        // They deleted their account on purpose. "Don't lose this!" is the
        // wrong thing to say to someone who just asked us to lose it.
        !backup.optedOut &&
        backup.recoverable === false &&
        !nudgeHidden &&
        (totals.deaths >= NUDGE_AFTER_DEATHS || games.length >= NUDGE_AFTER_GAMES) && (
          <div className="protect-nudge">
            <div className="pn-title">Don't lose this</div>
            <p className="pn-body">
              You've got <strong>{totals.deaths} deaths</strong> tracked across{' '}
              {games.length === 1 ? 'a game' : `${games.length} games`}. Add an email and you can
              get it all back on a new phone. No account, no password — it's only used to send you
              a code.
            </p>
            <div className="pn-actions">
              <button
                className="tp-ghost"
                onClick={() => {
                  playClick();
                  try {
                    localStorage.setItem(NUDGE_KEY, '1');
                  } catch {
                    // Dismissal is a nicety; failing to remember it isn't fatal.
                  }
                  setNudgeHidden(true);
                }}
              >
                Not now
              </button>
              <button
                className="tp-primary"
                onClick={() => {
                  playClick();
                  onOpenBackup();
                }}
              >
                Add email
              </button>
            </div>
          </div>
        )}

      <div className="tile-row">
        <button
          className="nav-tile"
          onClick={() => {
            playClick();
            onOpenGamesList();
          }}
        >
          <span className="nt-chev" aria-hidden="true">
            ›
          </span>
          <span className="nt-n">{games.length}</span>
          <span className="nt-l">game{games.length === 1 ? '' : 's'} tracked</span>
          <span className="nt-hint">view all</span>
        </button>
        <button
          className="nav-tile accent"
          onClick={() => {
            playClick();
            onAddGame();
          }}
        >
          <span className="nt-chev" aria-hidden="true">
            ›
          </span>
          <span className="nt-plus" aria-hidden="true">
            +
          </span>
          <span className="nt-l">track another game</span>
          <span className="nt-hint">search IGDB</span>
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
        <>
          <button className="primary-btn" onClick={onAddGame}>
            Add your first game
          </button>
          {/* A fresh install is precisely when someone needs to recover, and
              the status line below is hidden while there are no games — so
              without this, restore is unreachable at the only moment it
              matters. */}
          {isBackupConfigured && (
            <button
              className="restore-cta"
              onClick={() => {
                playClick();
                onOpenBackup();
              }}
            >
              Already tracked games before? <strong>Restore your tally</strong>
            </button>
          )}
        </>
      )}

      {isBackupConfigured && games.length > 0 && (
        <button
          className={`backup-line${backup.state === 'saving' ? ' is-saving' : ''}${
            (backup.recoverable === false && !backup.optedOut) ||
            backup.lostAccount ||
            backup.conflict
              ? ' at-risk'
              : ''
          }`}
          onClick={() => {
            playClick();
            onOpenBackup();
          }}
        >
          Backup &amp; restore ·{' '}
          {backupLabel(backup)} ›
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

      <button
        className="made-by"
        onClick={() => {
          playClick();
          onOpenAbout();
        }}
      >
        made by <strong>Quiet Foundry</strong> · about
      </button>
    </div>
  );
}
