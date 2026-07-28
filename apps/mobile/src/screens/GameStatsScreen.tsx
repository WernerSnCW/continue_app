import { formatHours } from '../lib/ranking';
import {
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
}

const rateOf = (deaths: number, seconds: number): number | null =>
  seconds > 0 ? deaths / (seconds / 3600) : null;

export function GameStatsScreen({ state, gameId, onBack }: Props) {
  const game = state.games.find((g) => g.id === gameId);
  const runs = runsForGame(state, gameId);
  if (!game) return null;

  const total = deathsForGame(state, gameId);
  const totalSeconds = playedSecondsForGame(state, gameId);
  const overallRate = rateOf(total, totalSeconds);

  const perRun = runs.map((r) => {
    const deaths = deathsForRun(state, r.id);
    return {
      run: r,
      deaths,
      rate: rateOf(deaths, r.playedSeconds),
      share: total > 0 ? deaths / total : 0,
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
          <div className="tile-l">deaths / hr</div>
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

      {perRun.map(({ run, deaths, rate, share }) => (
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
          <div className="run-row-sub">
            <span>{run.playedSeconds > 0 ? `${formatHours(run.playedSeconds)} logged` : 'no time logged'}</span>
            <span>{rate !== null ? `${rate.toFixed(1)}/hr` : '—'}</span>
          </div>
        </div>
      ))}

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

      <p className="ghost-note" style={{ marginTop: 'auto' }}>
        Bars show each run's share of your total deaths for this game.
      </p>
    </div>
  );
}
