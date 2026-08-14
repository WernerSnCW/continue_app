import { playClick } from '../lib/sound';
import { isRankable, MIN_SCORED_GAMES } from '../lib/ranking';
import {
  activeRun,
  deathsForGame,
  gamesInList,
  playedSecondsForGame,
  runLabelLong,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  onBack: () => void;
  /** Opens the ranking scoped to this list. */
  onOpenList: (listId: string) => void;
  onEditList: (listId: string) => void;
  onNewList: () => void;
}

/**
 * Manage lists. Deliberately its own screen rather than controls on the
 * ranking: editing from there only ever acted on whichever chip happened to be
 * selected, which is a poor way to manage a collection and gets worse with
 * every list added.
 *
 * Each row carries two separate buttons — open, and edit — as siblings rather
 * than one nested inside the other. Nested interactive elements are invalid
 * HTML and have already caused one real bug in this app.
 */
export function ListsScreen({ state, onBack, onOpenList, onEditList, onNewList }: Props) {
  /**
   * How many games in a list can actually be scored, which is not the same as
   * how many are in it — a game needs deaths and logged time before it counts.
   * Surfaced here so the reason a list shows no scores is visible from the
   * management screen rather than only after opening its ranking.
   */
  const rankableCount = (listId: string): number =>
    gamesInList(state, listId).filter((g) => {
      const run = activeRun(state, g.id);
      return isRankable({
        gameId: g.id,
        name: g.name,
        runLabel: run ? runLabelLong(run.cycle) : 'First run',
        deaths: deathsForGame(state, g.id),
        playedSeconds: playedSecondsForGame(state, g.id),
      });
    }).length;

  return (
    <div className="screen">
      <div className="counter-top">
        <button
          className="nav-btn"
          onClick={() => {
            playClick();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Lists
        </h3>
      </div>

      <p className="archive-note" style={{ marginTop: 14 }}>
        Group games you think of as comparable, and each list gets its own difficulty ranking. A
        game can sit in as many lists as you like, and stays in your overall ranking either way.
      </p>

      {state.lists.length === 0 ? (
        <div className="empty-state">
          <div className="big">No lists yet</div>
          <div>Make one for souls-likes, horror, or whatever you compare.</div>
        </div>
      ) : (
        state.lists.map((l) => {
          const total = gamesInList(state, l.id).length;
          const scorable = rankableCount(l.id);
          const shortBy = MIN_SCORED_GAMES - scorable;
          return (
            <div className="list-row" key={l.id}>
              <button
                className="lr-main"
                onClick={() => {
                  playClick();
                  onOpenList(l.id);
                }}
              >
                <span className="lr-name">{l.name}</span>
                <span className="lr-sub">
                  {total} game{total === 1 ? '' : 's'}
                  {shortBy > 0 ? ` · ${shortBy} more to start scoring` : ' · scored'}
                </span>
              </button>
              <button
                className="lr-edit"
                onClick={() => {
                  playClick();
                  onEditList(l.id);
                }}
                aria-label={`Edit ${l.name}`}
              >
                Edit
              </button>
            </div>
          );
        })
      )}

      <button
        className="primary-btn"
        style={{ marginTop: 14 }}
        onClick={() => {
          playClick();
          onNewList();
        }}
      >
        New list
      </button>

      <p className="ghost-note" style={{ marginTop: 'auto' }}>
        Deleting a list never touches the games in it.
      </p>
    </div>
  );
}
