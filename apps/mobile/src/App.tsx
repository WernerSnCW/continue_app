import { useEffect, useMemo, useState } from 'react';
import type { IgdbSearchResult } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { AddGameScreen } from './screens/AddGameScreen';
import { CounterScreen } from './screens/CounterScreen';
import { HomeScreen } from './screens/HomeScreen';
import { activeRun, load, newDeath, newGame, newRun, save, type AppState } from './lib/store';
import './App.css';

type View = { name: 'home' } | { name: 'counter'; gameId: string } | { name: 'add' };

export default function App() {
  const [state, setState] = useState<AppState>(load);
  const [view, setView] = useState<View>({ name: 'home' });

  useEffect(() => {
    save(state);
  }, [state]);

  const existingIgdbIds = useMemo(
    () => new Set(state.games.map((g) => g.igdbId).filter((id): id is number => id !== null)),
    [state.games],
  );

  const addGame = (result: IgdbSearchResult) => {
    if (!state.entitlement.unlimitedGames && state.games.length >= FREE_TIER_GAME_LIMIT) return;

    const game = newGame({ igdbId: result.id, name: result.name, coverUrl: result.coverUrl });
    // Every game starts on a first playthrough, so the counter always has a
    // run to attribute deaths to.
    const run = newRun(game.id, 0);
    setState((s) => ({ ...s, games: [...s.games, game], runs: [...s.runs, run] }));
    setView({ name: 'counter', gameId: game.id });
  };

  const recordDeath = (gameId: string) =>
    setState((s) => {
      const run = activeRun(s, gameId);
      if (!run) return s;
      return { ...s, deaths: [...s.deaths, newDeath(gameId, run.id)] };
    });

  const undoDeath = (gameId: string) =>
    setState((s) => {
      const run = activeRun(s, gameId);
      if (!run) return s;
      const idx = s.deaths.map((d) => d.runId).lastIndexOf(run.id);
      if (idx === -1) return s;
      return { ...s, deaths: s.deaths.filter((_, i) => i !== idx) };
    });

  /** Close the current run and open the next NG+ cycle. */
  const advanceRun = (gameId: string) =>
    setState((s) => {
      const run = activeRun(s, gameId);
      if (!run) return s;
      const completedAt = new Date().toISOString();
      return {
        ...s,
        runs: [
          ...s.runs.map((r) => (r.id === run.id ? { ...r, completedAt } : r)),
          newRun(gameId, run.cycle + 1),
        ],
      };
    });

  switch (view.name) {
    case 'counter':
      return (
        <CounterScreen
          state={state}
          gameId={view.gameId}
          onBack={() => setView({ name: 'home' })}
          onDeath={() => recordDeath(view.gameId)}
          onUndo={() => undoDeath(view.gameId)}
          onAdvanceRun={() => advanceRun(view.gameId)}
        />
      );
    case 'add':
      return (
        <AddGameScreen
          onBack={() => setView({ name: 'home' })}
          onPick={addGame}
          existingIgdbIds={existingIgdbIds}
        />
      );
    default:
      return (
        <HomeScreen
          state={state}
          onOpenGame={(gameId) => setView({ name: 'counter', gameId })}
          onAddGame={() => setView({ name: 'add' })}
        />
      );
  }
}
