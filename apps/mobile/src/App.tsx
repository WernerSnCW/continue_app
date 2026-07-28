import { useEffect, useMemo, useState } from 'react';
import type { IgdbSearchResult } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { DevPanel } from './components/DevPanel';
import { AddGameScreen } from './screens/AddGameScreen';
import { ArchivePickerScreen } from './screens/ArchivePickerScreen';
import { CounterScreen } from './screens/CounterScreen';
import { GameStatsScreen } from './screens/GameStatsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RankingScreen } from './screens/RankingScreen';
import {
  activeRun,
  archivedGames,
  emptyState,
  load,
  newDeath,
  newGame,
  newRun,
  save,
  usedSlots,
  type AppState,
} from './lib/store';
import './App.css';

type View =
  | { name: 'home' }
  | { name: 'counter'; gameId: string }
  | { name: 'add' }
  | { name: 'ranking' }
  | { name: 'stats'; gameId: string }
  | { name: 'archive'; pending: IgdbSearchResult; cycle: number };

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

  /** Creates the game + its opening run and jumps to the counter. */
  const commitGame = (result: IgdbSearchResult, cycle: number, archiveId?: string) => {
    // Built outside the updater: StrictMode double-invokes updaters, and
    // crypto.randomUUID() there would mint ids that don't match the view.
    const game = newGame({ igdbId: result.id, name: result.name, coverUrl: result.coverUrl });
    const run = newRun(game.id, cycle);

    setState((s) => ({
      ...s,
      games: [...s.games.map((g) => (g.id === archiveId ? { ...g, archived: true } : g)), game],
      runs: [...s.runs, run],
    }));
    setView({ name: 'counter', gameId: game.id });
  };

  const startTracking = (result: IgdbSearchResult, cycle: number) => {
    // Free tier is full: make the user choose what to archive rather than
    // silently refusing or deleting anything.
    if (!state.entitlement.unlimitedGames && usedSlots(state) >= FREE_TIER_GAME_LIMIT) {
      setView({ name: 'archive', pending: result, cycle });
      return;
    }
    commitGame(result, cycle);
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

  const logTime = (gameId: string, seconds: number) =>
    setState((s) => {
      const run = activeRun(s, gameId);
      if (!run) return s;
      return {
        ...s,
        runs: s.runs.map((r) =>
          r.id === run.id ? { ...r, playedSeconds: r.playedSeconds + seconds } : r,
        ),
      };
    });

  const toggleUnlimited = () =>
    setState((s) => ({
      ...s,
      entitlement: s.entitlement.unlimitedGames
        ? { unlimitedGames: false, purchasedAt: null }
        : { unlimitedGames: true, purchasedAt: new Date().toISOString() },
    }));

  const screen = () => {
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
            onLogTime={(seconds) => logTime(view.gameId, seconds)}
            onOpenStats={() => setView({ name: 'stats', gameId: view.gameId })}
          />
        );
      case 'stats':
        return (
          <GameStatsScreen
            state={state}
            gameId={view.gameId}
            onBack={() => setView({ name: 'counter', gameId: view.gameId })}
          />
        );
      case 'add':
        return (
          <AddGameScreen
            onBack={() => setView({ name: 'home' })}
            onStart={startTracking}
            existingIgdbIds={existingIgdbIds}
            unlimited={state.entitlement.unlimitedGames}
          />
        );
      case 'ranking':
        return <RankingScreen state={state} onBack={() => setView({ name: 'home' })} />;
      case 'archive':
        return (
          <ArchivePickerScreen
            state={state}
            pendingName={view.pending.name}
            onArchive={(gameId) => commitGame(view.pending, view.cycle, gameId)}
            onCancel={() => setView({ name: 'add' })}
          />
        );
      default:
        return (
          <HomeScreen
            state={state}
            onOpenGame={(gameId) => setView({ name: 'counter', gameId })}
            onAddGame={() => setView({ name: 'add' })}
            onOpenRanking={() => setView({ name: 'ranking' })}
          />
        );
    }
  };

  return (
    <>
      {screen()}
      <DevPanel
        unlimited={state.entitlement.unlimitedGames}
        onToggleUnlimited={toggleUnlimited}
        archivedCount={archivedGames(state).length}
        onReset={() => {
          setState(emptyState());
          setView({ name: 'home' });
        }}
      />
    </>
  );
}
