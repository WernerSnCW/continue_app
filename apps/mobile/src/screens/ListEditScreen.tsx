import { useState } from 'react';
import { playClick } from '../lib/sound';
import { gamesInList, visibleGames, type AppState } from '../lib/store';

interface Props {
  state: AppState;
  listId: string;
  onBack: () => void;
  onRename: (name: string) => void;
  onToggleGame: (gameId: string, inList: boolean) => void;
  onDelete: () => void;
}

/**
 * Edit one list: its name, which games are in it, and whether it exists.
 *
 * Membership is a flat checklist of every tracked game rather than a search or
 * a picker flow. A paid user has tens of games at most, not hundreds, and one
 * screen where the whole library is visible with ticks against it is far easier
 * to reason about than adding games one at a time and wondering what is already
 * in there.
 */
export function ListEditScreen({
  state,
  listId,
  onBack,
  onRename,
  onToggleGame,
  onDelete,
}: Props) {
  const list = state.lists.find((l) => l.id === listId);
  const [name, setName] = useState(list?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!list) return null;

  const inList = new Set(gamesInList(state, listId).map((g) => g.id));
  const all = visibleGames(state);

  const commitName = () => {
    const trimmed = name.trim();
    // An empty name would leave an unlabelled chip in the ranking selector, so
    // a blank reverts rather than saving.
    if (trimmed && trimmed !== list.name) onRename(trimmed);
    else if (!trimmed) setName(list.name);
  };

  return (
    <div className="screen">
      <div className="counter-top">
        <button
          className="nav-btn"
          onClick={() => {
            playClick();
            commitName();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Edit list
        </h3>
      </div>

      <div className="field-label" style={{ marginTop: 16 }}>
        List name
      </div>
      <input
        className="search-input"
        type="text"
        value={name}
        maxLength={40}
        placeholder="Souls-likes"
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
      />

      <div className="field-label" style={{ marginTop: 18 }}>
        Games in this list ({inList.size})
      </div>
      <p className="archive-note" style={{ marginTop: 0 }}>
        Ticked games are ranked against each other. Everything stays in your overall ranking too.
      </p>

      {all.length === 0 ? (
        <div className="empty-state">
          <div className="big">No games tracked</div>
          <div>Add a game first, then group it here.</div>
        </div>
      ) : (
        all.map((g) => {
          const on = inList.has(g.id);
          return (
            <button
              key={g.id}
              className={`pick-row${on ? ' on' : ''}`}
              onClick={() => {
                playClick();
                onToggleGame(g.id, on);
              }}
            >
              <span className={`pick-box${on ? ' on' : ''}`} aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              {g.coverUrl ? (
                <img className="pick-cover" src={g.coverUrl} alt="" loading="lazy" />
              ) : (
                <span className="pick-cover placeholder" aria-hidden="true" />
              )}
              <span className="pick-name">{g.name}</span>
            </button>
          );
        })
      )}

      <div className="spacer" />

      {/* Deleting a list never touches the games in it — worth saying outright,
          since "delete" everywhere else in this app removes a tally. */}
      {confirmDelete ? (
        <div className="backup-card warn">
          <div className="bc-label">Delete this list?</div>
          <p className="bc-note">
            Only the grouping goes. All {inList.size} game{inList.size === 1 ? '' : 's'} and every
            death stay exactly as they are, and they keep their place in your overall ranking.
          </p>
          <div className="pn-actions">
            <button
              className="tp-ghost"
              onClick={() => {
                playClick();
                setConfirmDelete(false);
              }}
            >
              Keep it
            </button>
            <button
              className="danger-btn"
              onClick={() => {
                playClick();
                onDelete();
              }}
            >
              Delete list
            </button>
          </div>
        </div>
      ) : (
        <button
          className="delete-link"
          onClick={() => {
            playClick();
            setConfirmDelete(true);
          }}
        >
          Delete this list
        </button>
      )}
    </div>
  );
}
