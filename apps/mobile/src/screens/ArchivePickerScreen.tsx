import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { formatHours } from '../lib/ranking';
import {
  activeGames,
  activeRun,
  deathsForGame,
  playedSecondsForGame,
  runLabelLong,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  /** Name of the game the user is trying to add, for context. */
  pendingName: string;
  onArchive: (gameId: string) => void;
  onCancel: () => void;
}

/**
 * Shown when a free-tier user picks a 4th game. They choose which of the
 * current three to archive — the archived game's runs and deaths stay in
 * storage, it just stops occupying a slot.
 */
export function ArchivePickerScreen({ state, pendingName, onArchive, onCancel }: Props) {
  return (
    <div className="screen">
      <div className="counter-top">
        <button className="nav-btn" onClick={onCancel} aria-label="Back">
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Free up a slot
        </h3>
      </div>

      <p className="archive-note" style={{ marginTop: 16 }}>
        Free plan tracks {FREE_TIER_GAME_LIMIT} games at a time. Pick one to archive and{' '}
        <strong>{pendingName}</strong> takes its slot. Nothing is deleted — every death and run is
        kept, and unlocking restores it.
      </p>

      {activeGames(state).map((game) => {
        const played = playedSecondsForGame(state, game.id);
        const run = activeRun(state, game.id);
        return (
          <button key={game.id} className="game-card" onClick={() => onArchive(game.id)}>
            {game.coverUrl ? (
              <img className="card-cover" src={game.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className="card-cover card-cover-blank" aria-hidden="true" />
            )}
            <span className="card-left">
              <p className="name">{game.name}</p>
              <span className="run">
                {run ? runLabelLong(run.cycle) : 'First run'}
                {played > 0 ? ` · ${formatHours(played)} played` : ''}
              </span>
            </span>
            <span className="tally">{deathsForGame(state, game.id)}</span>
          </button>
        );
      })}

      <p className="ghost-note" style={{ marginTop: 'auto' }}>
        Tap a game to archive it.
      </p>
    </div>
  );
}
