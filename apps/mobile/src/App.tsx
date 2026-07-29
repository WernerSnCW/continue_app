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
import { TimerBar } from './components/TimerBar';
import { cancelTrackerReminder, scheduleTrackerReminder } from './lib/notify';
import {
  activeRun,
  archivedGames,
  commitTimer,
  deathsForRun,
  latestRun,
  timedGame,
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
  /** `from` so Back returns where you came from, not always the counter. */
  | { name: 'stats'; gameId: string; from: 'counter' | 'ranking' }
  | { name: 'archive'; pending: IgdbSearchResult; cycle: number };

export default function App() {
  const [state, setState] = useState<AppState>(load);
  const [view, setView] = useState<View>({ name: 'home' });

  useEffect(() => {
    save(state);
  }, [state]);

  const timedFor = timedGame(state);

  /**
   * While the tracker runs, the app is expected to be in the background —
   * you're playing the game. But a clock left running overnight would ruin
   * the deaths-per-hour figure, so schedule a reminder when we lose focus and
   * cancel it the moment we're back.
   */
  useEffect(() => {
    if (!state.timer || !timedFor) {
      void cancelTrackerReminder();
      return;
    }
    const name = timedFor.name;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void scheduleTrackerReminder(name);
      else void cancelTrackerReminder();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Cover the case where we're already backgrounded when the timer starts.
    onVisibility();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void cancelTrackerReminder();
    };
  }, [state.timer, timedFor]);

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

  /**
   * Starts a fresh run on a game that's already tracked. The alternative —
   * letting the same game be added twice — would split its deaths across two
   * ids, breaking its stats, its ranking position, and (later) its match
   * against the global average.
   */
  const startRunOnExisting = (igdbId: number, cycle: number) => {
    const game = state.games.find((g) => g.igdbId === igdbId);
    if (!game) return;
    const current = activeRun(state, game.id);

    // An untouched run at the same cycle is already what they asked for.
    if (current && current.cycle === cycle && deathsForRun(state, current.id) === 0) {
      setView({ name: 'counter', gameId: game.id });
      return;
    }

    const run = newRun(game.id, cycle);
    const completedAt = new Date().toISOString();
    setState((s) => ({
      ...s,
      // Un-archive it too: they've just asked to play it again.
      games: s.games.map((g) => (g.id === game.id ? { ...g, archived: false } : g)),
      runs: [
        ...s.runs.map((r) => (r.id === current?.id ? { ...r, completedAt } : r)),
        run,
      ],
    }));
    setView({ name: 'counter', gameId: game.id });
  };

  const recordDeath = (gameId: string, runSeconds: number | null) =>
    setState((s) => {
      const run = activeRun(s, gameId);
      if (!run) return s;
      return { ...s, deaths: [...s.deaths, newDeath(gameId, run.id, runSeconds)] };
    });

  const undoDeath = (gameId: string) =>
    setState((s) => {
      const run = activeRun(s, gameId);
      if (!run) return s;
      const idx = s.deaths.map((d) => d.runId).lastIndexOf(run.id);
      if (idx === -1) return s;
      return { ...s, deaths: s.deaths.filter((_, i) => i !== idx) };
    });

  /**
   * Finish the current run. Deliberately does NOT start the next one — ending
   * a playthrough and beginning another are separate decisions, and a finished
   * run is locked so its tally can never drift afterwards.
   */
  const finishRun = (gameId: string) =>
    setState((prev) => {
      // Bank the clock first — a finished run can't accrue time afterwards.
      const s = commitTimer(prev);
      const run = activeRun(s, gameId);
      if (!run) return s;
      const completedAt = new Date().toISOString();
      return { ...s, runs: s.runs.map((r) => (r.id === run.id ? { ...r, completedAt } : r)) };
    });

  /** Begin a new run at a chosen cycle. Finishes anything still open first. */
  const startRun = (gameId: string, cycle: number) =>
    setState((prev) => {
      const s = commitTimer(prev);
      const open = activeRun(s, gameId);
      const completedAt = new Date().toISOString();
      return {
        ...s,
        runs: [
          ...s.runs.map((r) => (r.id === open?.id ? { ...r, completedAt } : r)),
          newRun(gameId, cycle),
        ],
      };
    });

  /**
   * Start the current cycle over. Archives the run rather than wiping it, so
   * the abandoned attempt is recoverable, then opens a fresh run at the same
   * cycle with a clean tally.
   */
  const resetRun = (gameId: string) =>
    setState((prev) => {
      const s = commitTimer(prev);
      const run = activeRun(s, gameId) ?? latestRun(s, gameId);
      if (!run) return s;
      return {
        ...s,
        runs: [
          ...s.runs.map((r) => (r.id === run.id ? { ...r, archived: true } : r)),
          newRun(gameId, run.cycle),
        ],
      };
    });

  /** Soft delete: hidden from totals and stats, kept in storage. */
  const archiveRun = (runId: string) =>
    setState((prev) => {
      const s = commitTimer(prev);
      return { ...s, runs: s.runs.map((r) => (r.id === runId ? { ...r, archived: true } : r)) };
    });

  /** Start the clock on a run. Only one can run at a time, app-wide. */
  const startTimer = (gameId: string, runId: string) =>
    // commitTimer banks any clock already running — starting a second game's
    // tracker shouldn't silently discard the first one's time.
    setState((prev) => ({
      ...commitTimer(prev),
      timer: { gameId, runId, startedAt: Date.now() },
    }));

  /** Stop the clock, folding elapsed time into the run it was timing. */
  const stopTimer = () => setState(commitTimer);


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
            onDeath={(runSeconds) => recordDeath(view.gameId, runSeconds)}
            onUndo={() => undoDeath(view.gameId)}
            onFinishRun={() => finishRun(view.gameId)}
            onStartRun={(cycle) => startRun(view.gameId, cycle)}
            onResetRun={() => resetRun(view.gameId)}
            onArchiveRun={archiveRun}
            onStartTimer={(runId) => startTimer(view.gameId, runId)}
            onStopTimer={stopTimer}
            onOpenStats={() => setView({ name: 'stats', gameId: view.gameId, from: 'counter' })}
          />
        );
      case 'stats':
        return (
          <GameStatsScreen
            state={state}
            gameId={view.gameId}
            onBack={() =>
              setView(
                view.from === 'ranking'
                  ? { name: 'ranking' }
                  : { name: 'counter', gameId: view.gameId },
              )
            }
          />
        );
      case 'add':
        return (
          <AddGameScreen
            onBack={() => setView({ name: 'home' })}
            onStart={startTracking}
            onStartRunOnExisting={startRunOnExisting}
            existingIgdbIds={existingIgdbIds}
            unlimited={state.entitlement.unlimitedGames}
          />
        );
      case 'ranking':
        return (
          <RankingScreen
            state={state}
            onBack={() => setView({ name: 'home' })}
            onOpenGame={(gameId) => setView({ name: 'stats', gameId, from: 'ranking' })}
          />
        );
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

  // Hidden on the counter of the game being timed — that screen already shows
  // the full tracker, and two clocks side by side is just noise.
  const showTimerBar =
    !!state.timer &&
    !!timedFor &&
    !(view.name === 'counter' && view.gameId === state.timer.gameId);

  return (
    <>
      {showTimerBar && (
        <TimerBar
          gameName={timedFor.name}
          baseSeconds={state.runs.find((r) => r.id === state.timer!.runId)?.playedSeconds ?? 0}
          startedAt={state.timer!.startedAt}
          onOpen={() => setView({ name: 'counter', gameId: state.timer!.gameId })}
          onPause={stopTimer}
        />
      )}
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
