import { useState } from 'react';
import type { Game } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { isMuted, playClick, setMuted } from '../lib/sound';
import { BarsIcon, SkullIcon } from '../components/icons';
import { Logo } from '../components/Logo';
import { formatHours } from '../lib/ranking';
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
  onOpenGame: (gameId: string) => void;
  onAddGame: () => void;
  onOpenRanking: () => void;
  onOpenPaywall: () => void;
}

export function HomeScreen({
  state,
  onOpenGame,
  onAddGame,
  onOpenRanking,
  onOpenPaywall,
}: Props) {
  const [muted, setMutedState] = useState(isMuted());
  const games = visibleGames(state);
  const unlimited = state.entitlement.unlimitedGames;
  const slots = usedSlots(state);
  const lockedSlots = unlimited ? 0 : Math.max(0, FREE_TIER_GAME_LIMIT - slots);

  return (
    <div className="screen">
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

      {games.length === 0 ? (
        <div className="empty-state">
          <div className="big">No games tracked yet</div>
          <div>Add one to start the tally.</div>
        </div>
      ) : (
        games.map((game) => <GameCard key={game.id} game={game} state={state} onOpen={onOpenGame} />)
      )}

      {/* An open slot invites the add flow; a locked slot sells the unlock. */}
      {games.length > 0 && lockedSlots > 0 && (
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

      {unlimited && (
        <button className="add-slot" onClick={onAddGame}>
          + Track another game
        </button>
      )}

      {games.length === 0 && (
        <button className="primary-btn" onClick={onAddGame}>
          Add your first game
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
