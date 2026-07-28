import { BarsIcon } from '../components/icons';
import { barWidth, formatHours, rankGames, type RankableGame } from '../lib/ranking';
import {
  activeRun,
  deathsForGame,
  playedSecondsForGame,
  runLabelLong,
  visibleGames,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  onBack: () => void;
}

export function RankingScreen({ state, onBack }: Props) {
  const rankable: RankableGame[] = visibleGames(state).map((g) => {
    const run = activeRun(state, g.id);
    return {
      gameId: g.id,
      name: g.name,
      runLabel: run ? runLabelLong(run.cycle) : 'First run',
      deaths: deathsForGame(state, g.id),
      playedSeconds: playedSecondsForGame(state, g.id),
    };
  });

  const { ranked, unranked, hardest, easiest } = rankGames(rankable);

  return (
    <div className="screen">
      <div className="brand-row">
        <button className="nav-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <BarsIcon />
        <div className="grow">
          <h2 style={{ fontSize: 17 }}>Difficulty ranking</h2>
          <div className="tag">based on your deaths per hour</div>
        </div>
      </div>

      {ranked.length === 0 && unranked.length === 0 ? (
        <div className="empty-state">
          <div className="big">Nothing to rank yet</div>
          <div>Track a game and log some session time.</div>
        </div>
      ) : (
        <>
          {hardest && (
            <div className="diff-summary">
              <div className="diff-card hardest">
                <div className="dc-label">Hardest for you</div>
                <div className="dc-game">{hardest.name}</div>
                <div className="dc-score">
                  {hardest.score.toFixed(1)}
                  <span>/10</span>
                </div>
              </div>
              {easiest && (
                <div className="diff-card easiest">
                  <div className="dc-label">Easiest for you</div>
                  <div className="dc-game">{easiest.name}</div>
                  <div className="dc-score">
                    {easiest.score.toFixed(1)}
                    <span>/10</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {ranked.map((g) => (
            <div className="diff-row" key={g.gameId}>
              <div className="diff-rank">{g.rank}</div>
              <div className="diff-mid">
                <div className="diff-name">
                  {g.name}
                  <span className="diff-sub">
                    {g.runLabel} · {formatHours(g.playedSeconds)} logged
                  </span>
                </div>
                <div className="diff-bar-track">
                  <div className="diff-bar-fill" style={{ width: `${barWidth(g.score)}%` }} />
                </div>
              </div>
              <div className="diff-side">
                <div className={`diff-score-pill ${g.tier}`}>{g.score.toFixed(1)}</div>
                <div className="diff-rate">{g.rate.toFixed(1)}/hr</div>
              </div>
            </div>
          ))}

          {unranked.map((g) => (
            <div className="diff-locked-row" key={g.gameId}>
              <div className="diff-name-locked">{g.name}</div>
              <div className="diff-locked-note">
                {g.deaths === 0 ? 'no deaths logged yet' : 'log session time to rank this one'}
              </div>
            </div>
          ))}

          <p className="ghost-note" style={{ marginTop: 'auto' }}>
            Ranked against your own games only — scores shift as you log more sessions.
          </p>
        </>
      )}
    </div>
  );
}
