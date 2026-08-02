import type { Game } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { SkullIcon } from '../components/icons';
import { formatHours } from '../lib/ranking';
import { playClick } from '../lib/sound';
import {
  activeRun,
  deathsForGame,
  playedSecondsForGame,
  runLabelLong,
  usedSlots,
  visibleGames,
  type AppState,
} from '../lib/store';

interface Props {
  state: AppState;
  onBack: () => void;
  onOpenGame: (gameId: string) => void;
  onAddGame: () => void;
}

/**
 * The full library. This used to be the home screen, but a scrolling list of
 * every game buries the one thing someone opens the app to do — log a death in
 * the game they're playing right now. It lives one tap away instead.
 */
export function GamesListScreen({ state, onBack, onOpenGame, onAddGame }: Props) {
  const games = visibleGames(state);
  const unlimited = state.entitlement.unlimitedGames;
  const slots = usedSlots(state);
  const lockedSlots = unlimited ? 0 : Math.max(0, FREE_TIER_GAME_LIMIT - slots);

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
          Your games
        </h3>
      </div>

      <div style={{ height: 12 }} />

      {games.length === 0 ? (
        <div className="empty-state">
          <div className="big">No games tracked yet</div>
          <div>Add one to start the tally.</div>
        </div>
      ) : (
        games.map((game) => <GameCard key={game.id} game={game} state={state} onOpen={onOpenGame} />)
      )}

      {/* An open slot invites the add flow; a locked slot sells the unlock. */}
      {(unlimited || lockedSlots > 0) && (
        <button className="add-slot" onClick={onAddGame}>
          + Track another game
        </button>
      )}

      {/* Genuinely inert — it advertises the unlock, it isn't a way in. The
          swap route lives below it so free-tier users aren't stranded. */}
      {!unlimited && slots >= FREE_TIER_GAME_LIMIT && (
        <>
          <div className="locked-slot" aria-disabled="true">
            <span className="name">{FREE_TIER_GAME_LIMIT + 1}th slot — locked</span>
            <span className="lock" aria-hidden="true">
              🔒
            </span>
          </div>
          <button className="swap-link" onClick={onAddGame}>
            Swap a game out instead →
          </button>
        </>
      )}
    </div>
  );
}

function GameCard({
  game,
  state,
  onOpen,
}: {
  game: Game;
  state: AppState;
  onOpen: (id: string) => void;
}) {
  const deaths = deathsForGame(state, game.id);
  const run = activeRun(state, game.id);
  const played = playedSecondsForGame(state, game.id);

  const sub = [
    run ? runLabelLong(run.cycle) : 'no active run',
    played > 0 ? `${formatHours(played)} played` : null,
    game.archived ? 'archived' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      className={`game-card${game.archived ? ' is-archived' : ''}`}
      onClick={() => onOpen(game.id)}
    >
      {game.coverUrl ? (
        <img className="card-cover" src={game.coverUrl} alt="" loading="lazy" />
      ) : (
        <span className="card-cover card-cover-blank" aria-hidden="true" />
      )}
      <span className="card-left">
        <p className="name">{game.name}</p>
        <span className="run">{sub}</span>
      </span>
      <span className="tally">
        <SkullIcon className="skull-tally" />
        {deaths}
      </span>
    </button>
  );
}
