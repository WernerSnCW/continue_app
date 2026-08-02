import { useState } from 'react';
import { HelpTip } from '../components/HelpTip';
import { formatHours } from '../lib/ranking';
import {
  runsArchivedBecause,
  deathsForGame,
  deathsForRun,
  deathsToday,
  playedSecondsForGame,
  runLabel,
  runsForGame,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  gameId: string;
  onBack: () => void;
  onArchiveGame: (gameId: string) => void;
  onRestoreGame: (gameId: string) => void;
  onRestoreDiscarded: (gameId: string) => void;
  onDeleteGame: (gameId: string) => void;
}

const rateOf = (deaths: number, seconds: number): number | null =>
  seconds > 0 ? deaths / (seconds / 3600) : null;

export function GameStatsScreen({
  state,
  gameId,
  onBack,
  onArchiveGame,
  onRestoreGame,
  onRestoreDiscarded,
  onDeleteGame,
}: Props) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const game = state.games.find((g) => g.id === gameId);
  const runs = runsForGame(state, gameId);
  if (!game) return null;

  const total = deathsForGame(state, gameId);
  const totalSeconds = playedSecondsForGame(state, gameId);
  const overallRate = rateOf(total, totalSeconds);

  const perRun = runs.map((r) => {
    const deaths = deathsForRun(state, r.id);
    // Timeline markers: deaths that were recorded while the clock was running,
    // positioned as a percentage across the run's logged time.
    const timeline = state.deaths
      .filter((d) => d.runId === r.id && d.runSeconds !== null)
      .map((d) => d.runSeconds!)
      .sort((a, b) => a - b);
    const untimed = deaths - timeline.length;
    return {
      run: r,
      deaths,
      rate: rateOf(deaths, r.playedSeconds),
      share: total > 0 ? deaths / total : 0,
      timeline,
      untimed,
    };
  });

  // Only runs with logged time can be compared on rate; fall back to raw
  // deaths so the highlight still says something on a fresh game.
  const timed = perRun.filter((p) => p.rate !== null);
  const worst = timed.length
    ? timed.reduce((a, b) => (b.rate! > a.rate! ? b : a))
    : perRun.length
      ? perRun.reduce((a, b) => (b.deaths > a.deaths ? b : a))
      : null;
  const best = timed.length > 1 ? timed.reduce((a, b) => (b.rate! < a.rate! ? b : a)) : null;

  const firstTracked = new Date(game.addedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="screen">
      <div className="counter-top">
        <button className="nav-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Stats
        </h3>
      </div>

      <div className="stats-head">
        {game.coverUrl ? (
          <img className="stats-cover" src={game.coverUrl} alt="" />
        ) : (
          <span className="stats-cover stats-cover-blank" aria-hidden="true" />
        )}
        <div className="stats-head-meta">
          <div className="stats-name">{game.name}</div>
          <div className="tag">
            tracked since {firstTracked}
            {game.archived ? ' · archived' : ''}
          </div>
        </div>
      </div>

      <div className="tile-grid">
        <div className="tile">
          <div className="tile-n">{total}</div>
          <div className="tile-l">total deaths</div>
        </div>
        <div className="tile">
          <div className="tile-n">{totalSeconds > 0 ? formatHours(totalSeconds) : '—'}</div>
          <div className="tile-l">time logged</div>
        </div>
        <div className="tile">
          <div className="tile-n">{overallRate !== null ? overallRate.toFixed(1) : '—'}</div>
          <div className="tile-l">
            deaths / hr
            <HelpTip title="Deaths per hour">
              Total deaths divided by the time you've logged on the session clock for this game.
              Time only accrues while the timer is running. This is the number the difficulty
              ranking sorts your games by.
            </HelpTip>
          </div>
        </div>
        <div className="tile">
          <div className="tile-n">{runs.length}</div>
          <div className="tile-l">run{runs.length === 1 ? '' : 's'}</div>
        </div>
        <div className="tile">
          <div className="tile-n">{deathsToday(state, gameId)}</div>
          <div className="tile-l">today</div>
        </div>
        <div className="tile">
          <div className="tile-n">{runs.filter((r) => r.completedAt).length}</div>
          <div className="tile-l">completed</div>
        </div>
      </div>

      <div className="field-label" style={{ marginTop: 4 }}>
        By run
      </div>

      {perRun.map(({ run, deaths, rate, share, timeline, untimed }) => {
        // Scale the timeline to whichever is longer: the logged clock, or the
        // last death. A death can land past the committed total when the run
        // is still in progress.
        const span = Math.max(run.playedSeconds, timeline[timeline.length - 1] ?? 0, 1);
        return (
          <div className="run-row" key={run.id}>
            <div className="run-row-top">
              <span className="run-row-name">
                {runLabel(run.cycle)}
                {!run.completedAt && <span className="run-badge">current</span>}
              </span>
              <span className="run-row-deaths">{deaths}</span>
            </div>
            <div className="diff-bar-track">
              <div className="diff-bar-fill" style={{ width: `${Math.round(share * 100)}%` }} />
            </div>

            {timeline.length > 0 && (
              <div className="timeline">
                <div className="timeline-track">
                  {timeline.map((sec, i) => (
                    <span
                      key={i}
                      className="timeline-mark"
                      style={{ left: `${(sec / span) * 100}%` }}
                      title={`Death ${i + 1} at ${formatHours(sec)} in`}
                    />
                  ))}
                </div>
                <div className="timeline-ends">
                  <span>0h</span>
                  <span>{formatHours(span)}</span>
                </div>
              </div>
            )}

            <div className="run-row-sub">
              <span>
                {run.playedSeconds > 0 ? `${formatHours(run.playedSeconds)} logged` : 'no time logged'}
                {untimed > 0 && timeline.length > 0 ? ` · ${untimed} untimed` : ''}
              </span>
              <span>{rate !== null ? `${rate.toFixed(1)}/hr` : '—'}</span>
            </div>
          </div>
        );
      })}

      {(worst || best) && (
        <div className="diff-summary" style={{ marginTop: 6 }}>
          {worst && (
            <div className="diff-card hardest">
              <div className="dc-label">Roughest run</div>
              <div className="dc-game">{runLabel(worst.run.cycle)}</div>
              <div className="dc-score">
                {worst.rate !== null ? worst.rate.toFixed(1) : worst.deaths}
                <span>{worst.rate !== null ? '/hr' : ' deaths'}</span>
              </div>
            </div>
          )}
          {best && (
            <div className="diff-card easiest">
              <div className="dc-label">Cleanest run</div>
              <div className="dc-game">{runLabel(best.run.cycle)}</div>
              <div className="dc-score">
                {best.rate!.toFixed(1)}
                <span>/hr</span>
              </div>
            </div>
          )}
        </div>
      )}

      {(() => {
        const unlimited = state.entitlement.unlimitedGames;
        const discarded = runsArchivedBecause(state, gameId, 'discarded');
        const swapped = runsArchivedBecause(state, gameId, 'swapped');
        const countDeaths = (rs: typeof discarded) =>
          rs.reduce((n, r) => n + deathsForRun(state, r.id), 0);
        if (!discarded.length && !swapped.length) return null;

        return (
          <div className="archived-block">
            {swapped.length > 0 && (
              <p className="archived-runs-note">
                <strong>{countDeaths(swapped)} deaths</strong> across {swapped.length} run
                {swapped.length === 1 ? '' : 's'} are archived from before you swapped this game
                out.{' '}
                {unlimited
                  ? 'Unlocked — restore them any time.'
                  : 'They return when you unlock unlimited games.'}
                {unlimited && (
                  <button className="inline-link" onClick={() => onRestoreGame(gameId)}>
                    Restore now
                  </button>
                )}
              </p>
            )}
            {discarded.length > 0 && (
              <p className="archived-runs-note">
                {discarded.length} discarded run{discarded.length === 1 ? '' : 's'} not counted
                above — {countDeaths(discarded)} deaths kept in storage.
                <button className="inline-link" onClick={() => onRestoreDiscarded(gameId)}>
                  Restore
                </button>
              </p>
            )}
          </div>
        );
      })()}

      <p className="ghost-note" style={{ marginTop: 'auto' }}>
        Bars show each run's share of your total deaths. Dots below mark when each death happened
        across the run's logged time.
      </p>

      {/* Game-level lifecycle. Archiving is soft, like everything else here. */}
      {game.archived ? (
        <button className="text-btn wide" onClick={() => onRestoreGame(gameId)}>
          Resume tracking {game.name}
        </button>
      ) : confirmStop ? (
        <div className="sheet-confirm" style={{ marginTop: 8 }}>
          <p>
            Stop tracking {game.name}? It leaves your home screen and frees a slot. Every run and
            death is kept, and you can resume it later.
          </p>
          <div className="sheet-confirm-actions">
            <button className="tp-ghost" onClick={() => setConfirmStop(false)}>
              Cancel
            </button>
            <button className="tp-primary" onClick={() => onArchiveGame(gameId)}>
              Stop tracking
            </button>
          </div>
        </div>
      ) : (
        <button className="text-btn wide danger" onClick={() => setConfirmStop(true)}>
          Stop tracking this game
        </button>
      )}

      {/* Permanent delete, kept visually and physically apart from archiving —
          the two read similarly in a list but only one is recoverable. */}
      {(() => {
        const everyRun = state.runs.filter((r) => r.gameId === gameId);
        const ids = new Set(everyRun.map((r) => r.id));
        const everyDeath = state.deaths.filter(
          (d) => d.gameId === gameId || ids.has(d.runId),
        ).length;
        const everySecond = everyRun.reduce((n, r) => n + r.playedSeconds, 0);

        if (!confirmDelete) {
          return (
            <button className="delete-link" onClick={() => setConfirmDelete(true)}>
              Delete {game.name} permanently
            </button>
          );
        }
        return (
          <div className="danger-panel">
            <div className="dp-title">Delete {game.name} permanently?</div>
            <p className="dp-body">
              This erases <strong>{everyDeath} death{everyDeath === 1 ? '' : 's'}</strong> across{' '}
              <strong>
                {everyRun.length} run{everyRun.length === 1 ? '' : 's'}
              </strong>
              {everySecond > 0 && <> and {formatHours(everySecond)} of logged play time</>}, including
              anything archived or discarded.
            </p>
            <p className="dp-body">
              It cannot be undone, and it will be removed from your cloud backup the next time the
              app saves. If you only want it off your home screen, use{' '}
              <strong>Stop tracking</strong> instead — that keeps everything.
            </p>
            <div className="sheet-confirm-actions">
              <button className="tp-ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="danger-btn" onClick={() => onDeleteGame(gameId)}>
                Delete forever
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
