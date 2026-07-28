import type { Game } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { activeRun, deathsForGame, runLabel, type AppState } from '../lib/store';

interface Props {
  state: AppState;
  onOpenGame: (gameId: string) => void;
  onAddGame: () => void;
}

export function HomeScreen({ state, onOpenGame, onAddGame }: Props) {
  const { games, entitlement } = state;
  const atLimit = !entitlement.unlimitedGames && games.length >= FREE_TIER_GAME_LIMIT;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1 className="title">Continue?</h1>
        <p className="subtitle">
          {games.length === 0
            ? 'No games tracked yet'
            : `${games.length} game${games.length === 1 ? '' : 's'} · ${state.deaths.length} total deaths`}
        </p>
      </header>

      {games.length === 0 ? (
        <div className="empty">
          <p className="empty-line">Every death counts.</p>
          <p className="empty-hint">Add a game to start the tally.</p>
        </div>
      ) : (
        <ul className="game-list">
          {games.map((game) => (
            <GameRow key={game.id} game={game} state={state} onOpen={() => onOpenGame(game.id)} />
          ))}
        </ul>
      )}

      {atLimit && (
        <p className="limit-note">
          Free tier tracks {FREE_TIER_GAME_LIMIT} games. Unlock unlimited for $1.99.
        </p>
      )}

      <button className="btn-primary" onClick={onAddGame} disabled={atLimit}>
        {atLimit ? 'Game limit reached' : '+ Add game'}
      </button>
    </div>
  );
}

function GameRow({ game, state, onOpen }: { game: Game; state: AppState; onOpen: () => void }) {
  const deaths = deathsForGame(state, game.id);
  const run = activeRun(state, game.id);

  return (
    <li>
      <button className="game-row" onClick={onOpen}>
        {game.coverUrl ? (
          <img className="cover" src={game.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="cover cover-blank" aria-hidden="true" />
        )}
        <span className="game-meta">
          <span className="game-name">{game.name}</span>
          <span className="game-run">{run ? runLabel(run.cycle) : 'NG'}</span>
        </span>
        <span className="game-deaths">
          <span className="count">{deaths}</span>
          <span className="count-label">death{deaths === 1 ? '' : 's'}</span>
        </span>
      </button>
    </li>
  );
}
