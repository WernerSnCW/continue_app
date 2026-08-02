import { useEffect, useMemo, useState } from 'react';
import type { IgdbSearchResult } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { DevPanel } from './components/DevPanel';
import { AddGameScreen } from './screens/AddGameScreen';
import { ArchivePickerScreen } from './screens/ArchivePickerScreen';
import { CounterScreen } from './screens/CounterScreen';
import { GameStatsScreen } from './screens/GameStatsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PaywallScreen } from './screens/PaywallScreen';
import { RankingScreen } from './screens/RankingScreen';
import { TimerBar } from './components/TimerBar';
import { cancelTrackerReminder, scheduleTrackerReminder } from './lib/notify';
import { useBackup } from './lib/useBackup';
import { AboutScreen } from './screens/AboutScreen';
import { BackupScreen } from './screens/BackupScreen';
import { GamesListScreen } from './screens/GamesListScreen';
import {
  activeRun,
  adoptSnapshot,
  archivedGames,
  commitTimer,
  deathsForRun,
  enforceGameLimit,
  historyForIgdbId,
  lastPlayedGame,
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
  | { name: 'paywall' }
  | { name: 'backup' }
  | { name: 'games' }
  | { name: 'about' }
  /** `from` so Back returns where you came from, not always the counter. */
  | { name: 'stats'; gameId: string; from: 'counter' | 'ranking' }
  | { name: 'archive'; pending: IgdbSearchResult; cycle: number };

export default function App() {
  const [state, setState] = useState<AppState>(load);
  const [view, setView] = useState<View>({ name: 'home' });

  useEffect(() => {
    save(state);
  }, [state]);

  const backup = useBackup(state);
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

  /**
   * Single entry point for "track this game", whether it's new, already
   * tracked, or being picked back up after a swap.
   *
   * The slot check lives here rather than in each path: resuming an archived
   * game un-archives it, which occupies a slot exactly like adding a new one.
   * Routing that around this check let a free user hold four active games.
   */
  const startTracking = (result: IgdbSearchResult, cycle: number, archiveId?: string) => {
    const existing = state.games.find((g) => g.igdbId === result.id);
    const needsSlot = !existing || existing.archived;

    if (
      !archiveId &&
      needsSlot &&
      !state.entitlement.unlimitedGames &&
      usedSlots(state) >= FREE_TIER_GAME_LIMIT
    ) {
      // Free tier is full: make the user choose what to archive rather than
      // silently refusing or deleting anything.
      setView({ name: 'archive', pending: result, cycle });
      return;
    }

    if (existing) startRunOnExisting(result.id, cycle, archiveId);
    else commitGame(result, cycle, archiveId);
  };

  /**
   * Starts a run on a game that's already in the library. Never duplicates the
   * game — two entries for one title would split its deaths across two ids,
   * breaking its stats, its ranking position and its future match against the
   * global average.
   *
   * Picking a *swapped-out* game back up on the free tier deliberately does
   * NOT hand its history back. Otherwise three slots quietly become unlimited:
   * rotate games at will and every tally survives, which makes both "unlimited
   * games" and "restore archived history" worthless. Instead the old runs are
   * set aside as `swapped` — kept intact, restored by the unlock — and the
   * game starts from zero. The cost of rotating is continuity, not data.
   */
  const startRunOnExisting = (igdbId: number, cycle: number, archiveId?: string) => {
    const game = state.games.find((g) => g.igdbId === igdbId);
    if (!game) return;

    const unlimited = state.entitlement.unlimitedGames;
    const resumingSwapped = game.archived && !unlimited;
    const current = activeRun(state, game.id);

    // An untouched run at the same cycle is already what they asked for.
    if (!resumingSwapped && current && current.cycle === cycle && deathsForRun(state, current.id) === 0) {
      setView({ name: 'counter', gameId: game.id });
      return;
    }

    const run = newRun(game.id, cycle);
    const completedAt = new Date().toISOString();

    setState((prev) => {
      const s = commitTimer(prev);
      return {
        ...s,
        games: s.games.map((g) =>
          g.id === game.id
            ? { ...g, archived: false }
            : g.id === archiveId
              ? { ...g, archived: true }
              : g,
        ),
        runs: [
          ...s.runs.map((r) => {
            if (r.gameId !== game.id) return r;
            if (resumingSwapped && !r.archived) {
              return { ...r, archived: true, archivedReason: 'swapped' as const };
            }
            return r.id === current?.id ? { ...r, completedAt } : r;
          }),
          run,
        ],
      };
    });
    setView({ name: 'counter', gameId: game.id });
  };

  /** Stop tracking a game. Soft: it leaves the home screen, data survives. */
  const archiveGame = (gameId: string) => {
    setState((prev) => {
      const s = commitTimer(prev);
      return { ...s, games: s.games.map((g) => (g.id === gameId ? { ...g, archived: true } : g)) };
    });
    setView({ name: 'home' });
  };

  /**
   * Permanent delete. Unlike archiving, this is exactly what it says: the
   * game, every run it ever had — archived ones included — and every death
   * recorded against them are removed from local state, and therefore from
   * the cloud backup on the next push. There is no undo.
   */
  const deleteGame = (gameId: string) => {
    setState((prev) => {
      // A clock pointed at something about to stop existing has to go first.
      const s = prev.timer?.gameId === gameId ? { ...prev, timer: null } : prev;
      const runIds = new Set(s.runs.filter((r) => r.gameId === gameId).map((r) => r.id));
      return {
        ...s,
        games: s.games.filter((g) => g.id !== gameId),
        runs: s.runs.filter((r) => r.gameId !== gameId),
        // Match on both keys: a death is orphaned if either points at the game.
        deaths: s.deaths.filter((d) => d.gameId !== gameId && !runIds.has(d.runId)),
      };
    });
    setView({ name: 'home' });
  };

  /** Permanent delete of a single run and everything recorded in it. */
  const deleteRun = (runId: string) =>
    setState((prev) => {
      const s = prev.timer?.runId === runId ? { ...prev, timer: null } : prev;
      return {
        ...s,
        runs: s.runs.filter((r) => r.id !== runId),
        deaths: s.deaths.filter((d) => d.runId !== runId),
      };
    });

  /** Bring an archived game back, along with any swap-archived runs. */
  const restoreGame = (gameId: string) =>
    setState((s) => ({
      ...s,
      games: s.games.map((g) => (g.id === gameId ? { ...g, archived: false } : g)),
      runs: s.runs.map((r) =>
        r.gameId === gameId && r.archivedReason === 'swapped'
          ? { ...r, archived: false, archivedReason: null }
          : r,
      ),
    }));

  /** Un-discard runs the user threw away by hand. */
  const restoreDiscardedRuns = (gameId: string) =>
    setState((s) => ({
      ...s,
      runs: s.runs.map((r) =>
        r.gameId === gameId && r.archivedReason === 'discarded'
          ? { ...r, archived: false, archivedReason: null }
          : r,
      ),
    }));

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
          ...s.runs.map((r) =>
            r.id === run.id ? { ...r, archived: true, archivedReason: 'discarded' as const } : r,
          ),
          newRun(gameId, run.cycle),
        ],
      };
    });

  /** Soft delete: hidden from totals and stats, kept in storage. */
  const archiveRun = (runId: string) =>
    setState((prev) => {
      const s = commitTimer(prev);
      return {
        ...s,
        runs: s.runs.map((r) =>
          r.id === runId ? { ...r, archived: true, archivedReason: 'discarded' as const } : r,
        ),
      };
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


  const setUnlocked = (unlocking: boolean) =>
    setState((prev) => {
      // Losing the unlock puts the slot limit back. The surplus is archived,
      // never deleted, so it returns if they unlock again — otherwise buying,
      // hoarding games and refunding would bypass the limit for good.
      const s = unlocking ? prev : enforceGameLimit(prev, FREE_TIER_GAME_LIMIT);
      return {
        ...s,
        // Unlocking delivers the "restore archived history" promise: games
        // swapped out come back, and so do the runs set aside by a swap. Runs
        // the user discarded on purpose don't — they asked for those to go.
        games: unlocking ? s.games.map((g) => ({ ...g, archived: false })) : s.games,
        runs: unlocking
          ? s.runs.map((r) =>
              r.archivedReason === 'swapped' ? { ...r, archived: false, archivedReason: null } : r,
            )
          : s.runs,
        entitlement: unlocking
          ? { unlimitedGames: true, purchasedAt: new Date().toISOString() }
          : { unlimitedGames: false, purchasedAt: null },
      };
    });

  const toggleUnlimited = () => setUnlocked(!state.entitlement.unlimitedGames);

  /** Everything the unlock would hand back right now, for the paywall copy. */
  const lockedBehindUnlock = useMemo(() => {
    const swapped = state.runs.filter((r) => r.archivedReason === 'swapped');
    const ids = new Set(swapped.map((r) => r.id));
    return {
      games: state.games.filter((g) => g.archived).length,
      runs: swapped.length,
      deaths: state.deaths.reduce((n, d) => (ids.has(d.runId) ? n + 1 : n), 0),
    };
  }, [state]);

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
            onDeleteRun={deleteRun}
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
            onArchiveGame={archiveGame}
            onRestoreGame={restoreGame}
            onRestoreDiscarded={restoreDiscardedRuns}
            onDeleteGame={deleteGame}
          />
        );
      case 'add':
        return (
          <AddGameScreen
            onBack={() => setView({ name: 'home' })}
            onStart={startTracking}
            existingIgdbIds={existingIgdbIds}
            unlimited={state.entitlement.unlimitedGames}
            historyFor={(igdbId) => historyForIgdbId(state, igdbId)}
          />
        );
      case 'about':
        return <AboutScreen onBack={() => setView({ name: 'home' })} />;
      case 'games':
        return (
          <GamesListScreen
            state={state}
            onBack={() => setView({ name: 'home' })}
            onOpenGame={(gameId) => setView({ name: 'counter', gameId })}
            onAddGame={() => setView({ name: 'add' })}
          />
        );
      case 'backup':
        return (
          <BackupScreen
            onBack={() => {
              // Linking an email happens in there, so re-check on the way out.
              backup.refreshIdentity();
              setView({ name: 'home' });
            }}
            onRestore={(payload) => {
              // Snapshots come from a server round trip, so run them through
              // the same migration the local store uses rather than trusting
              // the shape — an older build may have written it.
              const restored = adoptSnapshot(payload);
              if (!restored) return;
              setState(restored);
              setView({ name: 'home' });
            }}
            local={{ games: state.games.length, deaths: state.deaths.length }}
          />
        );
      case 'paywall':
        return (
          <PaywallScreen
            onBack={() => setView({ name: 'home' })}
            onUnlocked={() => {
              setUnlocked(true);
              setView({ name: 'home' });
            }}
            locked={lockedBehindUnlock}
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
            onArchive={(gameId) => startTracking(view.pending, view.cycle, gameId)}
            onCancel={() => setView({ name: 'add' })}
          />
        );
      default:
        return (
          <HomeScreen
            state={state}
            onOpenGame={(gameId) => setView({ name: 'counter', gameId })}
            onOpenGamesList={() => setView({ name: 'games' })}
            onAddGame={() => setView({ name: 'add' })}
            onOpenRanking={() => setView({ name: 'ranking' })}
            onOpenPaywall={() => setView({ name: 'paywall' })}
            onDeath={recordDeath}
            onStartTimer={startTimer}
            onStopTimer={stopTimer}
            onRevertUnlock={() => setUnlocked(false)}
            backup={backup}
            onOpenBackup={() => setView({ name: 'backup' })}
            onOpenAbout={() => setView({ name: 'about' })}
          />
        );
    }
  };

  // Hidden wherever the timed game's own clock is already on screen — its
  // counter, or the home screen when it's the last-played card. Two clocks for
  // the same run side by side is just noise.
  const timedIsFeatured = state.timer && lastPlayedGame(state)?.id === state.timer.gameId;
  const showTimerBar =
    !!state.timer &&
    !!timedFor &&
    !(view.name === 'counter' && view.gameId === state.timer.gameId) &&
    !(view.name === 'home' && timedIsFeatured);

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
