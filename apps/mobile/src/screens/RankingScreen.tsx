import { BarsIcon } from '../components/icons';
import { HelpTip } from '../components/HelpTip';
import { playClick } from '../lib/sound';
import { barWidth, formatHours, rankGames, type RankableGame } from '../lib/ranking';
import {
  activeRun,
  deathsForGame,
  gamesInList,
  playedSecondsForGame,
  runLabelLong,
  visibleGames,
  type AppState,
} from '../lib/store';
import { MIN_SCORED_GAMES } from '../lib/ranking';

interface Props {
  state: AppState;
  onBack: () => void;
  onOpenGame: (gameId: string) => void;
  /** Null means the computed "All games" view rather than a stored list. */
  listId: string | null;
  onSelectList: (listId: string | null) => void;
  onNewList: () => void;
  onEditList: (listId: string) => void;
  onOpenPaywall: () => void;
}

export function RankingScreen({
  state,
  onBack,
  onOpenGame,
  listId,
  onSelectList,
  onNewList,
  onEditList,
  onOpenPaywall,
}: Props) {
  const unlimited = state.entitlement.unlimitedGames;
  // Lists are a paid feature, so an unlock that lapses simply stops offering
  // them. Nothing is deleted, and re-unlocking brings them straight back.
  const lists = unlimited ? state.lists : [];
  const selected = listId ? (lists.find((l) => l.id === listId) ?? null) : null;
  // A list that vanished — deleted, or the unlock lapsed — falls back to
  // All games rather than rendering an empty screen with no way out.
  const scopeGames = selected ? gamesInList(state, selected.id) : visibleGames(state);

  const rankable: RankableGame[] = scopeGames.map((g) => {
    const run = activeRun(state, g.id);
    return {
      gameId: g.id,
      name: g.name,
      runLabel: run ? runLabelLong(run.cycle) : 'First run',
      deaths: deathsForGame(state, g.id),
      playedSeconds: playedSecondsForGame(state, g.id),
    };
  });

  const { ranked, unranked, hardest, easiest, scored } = rankGames(rankable);

  return (
    <div className="screen">
      <div className="brand-row">
        <button className="nav-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <BarsIcon />
        <div className="grow">
          <h2 style={{ fontSize: 17 }}>Difficulty ranking</h2>
          <div className="tag">
            {selected ? `within ${selected.name}` : 'based on your deaths per hour'}
          </div>
        </div>
        <HelpTip title="How the score works">
          Each game's <strong>deaths per hour</strong> is worked out from the time you've logged on
          the session clock. Games are then ranked against each other and scored 1–10 by their{' '}
          <strong>position</strong> in that order — not by the raw rate.
          <br />
          <br />
          That's deliberate: one brutal half-hour can send a rate sky-high, and if scores followed
          the rate directly, that single session would squash every other game to the bottom of the
          scale. Ranking by position means an outlier can only ever take first place — it can't
          distort the rest.
          <br />
          <br />
          Scores shift as you log more time, and a game needs both deaths and clock time before it
          can be ranked at all.
        </HelpTip>
      </div>

      {/* Scope selector. A ranking is only as meaningful as the set it compares
          against, so which set is being used has to be visible and switchable
          right here rather than buried in a menu. */}
      {unlimited ? (
        <div className="scope-chips">
          <button
            className={`scope-chip${selected ? '' : ' on'}`}
            onClick={() => {
              playClick();
              onSelectList(null);
            }}
          >
            All games
          </button>
          {lists.map((l) => (
            <button
              key={l.id}
              className={`scope-chip${selected?.id === l.id ? ' on' : ''}`}
              onClick={() => {
                playClick();
                onSelectList(l.id);
              }}
            >
              {l.name}
            </button>
          ))}
          <button
            className="scope-chip add"
            onClick={() => {
              playClick();
              onNewList();
            }}
          >
            + List
          </button>
        </div>
      ) : (
        <button
          className="scope-upsell"
          onClick={() => {
            playClick();
            onOpenPaywall();
          }}
        >
          <strong>Rank within your own lists</strong>
          <span>
            Group your games — survival horror, souls-likes, whatever you like — and score each game
            against the others in that list instead of your whole library.
          </span>
        </button>
      )}

      {selected && (
        <div className="scope-actions">
          <span className="sa-count">
            {scopeGames.length} game{scopeGames.length === 1 ? '' : 's'} in this list
          </span>
          <button
            className="sa-edit"
            onClick={() => {
              playClick();
              onEditList(selected.id);
            }}
          >
            Edit list
          </button>
        </div>
      )}

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
                <div className="dc-label">Hardest {selected ? 'in this list' : 'for you'}</div>
                <div className="dc-game">{hardest.name}</div>
                {hardest.score !== null ? (
                  <div className="dc-score">
                    {hardest.score.toFixed(1)}
                    <span>/10</span>
                  </div>
                ) : (
                  <div className="dc-rate">{hardest.rate.toFixed(1)} deaths/hr</div>
                )}
              </div>
              {easiest && (
                <div className="diff-card easiest">
                  <div className="dc-label">Easiest {selected ? 'in this list' : 'for you'}</div>
                  <div className="dc-game">{easiest.name}</div>
                  {easiest.score !== null ? (
                    <div className="dc-score">
                      {easiest.score.toFixed(1)}
                      <span>/10</span>
                    </div>
                  ) : (
                    <div className="dc-rate">{easiest.rate.toFixed(1)} deaths/hr</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Below the threshold the order is real but a 1–10 score is not: with
              two games the maths returns 7.75 and 3.25 whether one kills you
              twice as often or a hundred times as often. Showing the rates and
              saying why beats printing a number that looks like a verdict. */}
          {!scored && ranked.length > 0 && (
            <div className="explainer">
              <div className="ex-title">
                {ranked.length === 1 ? 'Only one game to go on' : 'Not enough to score yet'}
              </div>
              <p className="ex-body">
                Scores are <strong>relative</strong> — each game is rated by where it sits against
                the others{selected ? ' in this list' : ' you track'}, not against some absolute
                idea of difficulty. With {ranked.length === 1 ? 'one game' : `${ranked.length}`}
                {ranked.length === 1 ? '' : ' games'} the positions are too coarse for a 1–10 score
                to mean much, so the order and the raw rates are shown instead.
              </p>
              <p className="ex-body">
                {selected
                  ? `Add games until ${MIN_SCORED_GAMES} in this list have deaths and logged time, and scoring turns on.`
                  : `Once ${MIN_SCORED_GAMES} games have deaths and logged time, scoring turns on.`}
              </p>
            </div>
          )}

          {ranked.map((g) => (
            <button
              className="diff-row"
              key={g.gameId}
              onClick={() => {
                playClick();
                onOpenGame(g.gameId);
              }}
            >
              <div className="diff-rank">{g.rank}</div>
              <div className="diff-mid">
                <div className="diff-name">
                  {g.name}
                  <span className="diff-sub">
                    {g.runLabel} · {formatHours(g.playedSeconds)} logged
                  </span>
                </div>
                {g.score !== null && (
                  <div className="diff-bar-track">
                    <div className="diff-bar-fill" style={{ width: `${barWidth(g.score)}%` }} />
                  </div>
                )}
              </div>
              <div className="diff-side">
                {g.score !== null && (
                  <div className={`diff-score-pill ${g.tier}`}>{g.score.toFixed(1)}</div>
                )}
                <div className="diff-rate">{g.rate.toFixed(1)}/hr</div>
              </div>
              <span className="row-chev" aria-hidden="true">
                ›
              </span>
            </button>
          ))}

          {unranked.map((g) => (
            <button
              className="diff-locked-row"
              key={g.gameId}
              onClick={() => {
                playClick();
                onOpenGame(g.gameId);
              }}
            >
              <div className="diff-name-locked">{g.name}</div>
              <div className="diff-locked-note">
                {g.deaths === 0 ? 'no deaths logged yet' : 'log session time to rank this one'}
              </div>
              <span className="row-chev" aria-hidden="true">
                ›
              </span>
            </button>
          ))}

          <p className="ghost-note" style={{ marginTop: 'auto' }}>
            Ranked against your own games only — scores shift as you log more sessions.
          </p>
        </>
      )}
    </div>
  );
}
