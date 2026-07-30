import { useEffect, useRef, useState } from 'react';
import type { IgdbSearchResult } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { searchGames } from '../lib/igdb';
import { runLabel as runLabelFor } from '../lib/store';

/** Suggestions from the prototype — genre-appropriate starting points. */
const SUGGESTED = ['Dark Souls III', 'Bloodborne', 'Lies of P', 'Nine Sols', 'Lords of the Fallen'];

interface Props {
  onBack: () => void;
  onStart: (result: IgdbSearchResult, cycle: number) => void;
  existingIgdbIds: ReadonlySet<number>;
  unlimited: boolean;
  /** What's already on file for a game, so we can say what starting fresh costs. */
  historyFor: (igdbId: number) => {
    archived: boolean;
    runs: number;
    deaths: number;
    lockedRuns: number;
    lockedDeaths: number;
  } | null;
}

export function AddGameScreen({
  onBack,
  onStart,
  existingIgdbIds,
  unlimited,
  historyFor,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IgdbSearchResult[]>([]);
  const [selected, setSelected] = useState<IgdbSearchResult | null>(null);
  const [cycle, setCycle] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    // Debounce so typing doesn't fire a request per keystroke against the
    // shared IGDB rate limit.
    const timer = setTimeout(async () => {
      setStatus('loading');
      try {
        setResults(await searchGames(term, controller.signal));
        setStatus('idle');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError((err as Error).message);
        setStatus('error');
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const segments = [
    { cycle: 0, label: 'First run', locked: false },
    { cycle: 1, label: 'NG+', locked: false },
    { cycle: 2, label: 'NG++', locked: !unlimited },
  ];

  // Someone may well install this mid-way through an NG+7 run. Unlocked users
  // shouldn't have to climb there one cycle at a time.
  const customActive = cycle > 2;

  return (
    <div className="screen">
      <div className="counter-top">
        <button className="nav-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Track a new game
        </h3>
      </div>

      <div className="field-label" style={{ marginTop: 16 }}>
        Game name
      </div>
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        value={query}
        placeholder="Type or pick below..."
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
      />

      {query.trim().length < 2 && (
        <>
          <div className="field-label">Suggested</div>
          <div className="chip-row">
            {SUGGESTED.map((name) => (
              <button key={name} className="chip" onClick={() => setQuery(name)}>
                {name}
              </button>
            ))}
          </div>
        </>
      )}

      {status === 'loading' && <p className="hint">Searching…</p>}
      {status === 'error' && <p className="hint hint-error">{error}</p>}
      {status === 'idle' && query.trim().length >= 2 && results.length === 0 && (
        <p className="hint">No games found.</p>
      )}

      {results.length > 0 && (
        <ul className="result-list">
          {results.map((r) => {
            const already = existingIgdbIds.has(r.id);
            return (
              <li key={r.id}>
                <button
                  className={`result-row${selected?.id === r.id ? ' selected' : ''}`}
                  onClick={() => setSelected(r)}
                >
                  {r.coverUrl ? (
                    <img className="cover" src={r.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="cover" />
                  )}
                  <span className="rmid">
                    <span className="rname">{r.name}</span>
                    <br />
                    <span className="ryear">{r.firstReleaseYear ?? '—'}</span>
                  </span>
                  {already && <span className="already">tracked</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="spacer" />

      {/* Picking up a swapped-out game: say plainly what happens to the old
          numbers, rather than silently handing them back or silently binning
          them. */}
      {selected &&
        (() => {
          const h = historyFor(selected.id);
          if (!h?.archived || h.lockedDeaths === 0) return null;
          return (
            <div className="history-notice">
              <div className="hn-title">You tracked this before</div>
              <p className="hn-body">
                <strong>{h.lockedDeaths} deaths</strong> across {h.lockedRuns} run
                {h.lockedRuns === 1 ? '' : 's'} {unlimited ? 'are archived.' : 'are archived.'}{' '}
                {unlimited ? (
                  <>Starting again restores them — your tally picks up where it left off.</>
                ) : (
                  <>
                    Starting again begins from zero. They stay safe and come back if you unlock —
                    nothing is deleted.
                  </>
                )}
              </p>
            </div>
          );
        })()}

      <div className="field-label">This run</div>
      <div className="segmented">
        {segments.map((seg) => (
          <button
            key={seg.cycle}
            className={`seg${cycle === seg.cycle ? ' active' : ''}`}
            disabled={seg.locked}
            onClick={() => setCycle(seg.cycle)}
          >
            {seg.label}
            {seg.locked ? ' 🔒' : ''}
          </button>
        ))}
        {unlimited && (
          <button
            className={`seg${customActive ? ' active' : ''}`}
            onClick={() => setCycle(customActive ? 3 : 3)}
          >
            NG+…
          </button>
        )}
      </div>

      {unlimited && customActive && (
        <div className="cycle-picker">
          <span className="cp-label">Starting at</span>
          <button
            className="cp-step"
            onClick={() => setCycle((c) => Math.max(3, c - 1))}
            aria-label="Lower NG+ level"
          >
            −
          </button>
          <span className="cp-value">{runLabelFor(cycle)}</span>
          <button
            className="cp-step"
            onClick={() => setCycle((c) => Math.min(99, c + 1))}
            aria-label="Raise NG+ level"
          >
            +
          </button>
        </div>
      )}

      <button
        className="primary-btn"
        disabled={!selected}
        onClick={() => selected && onStart(selected, cycle)}
      >
        {!selected
          ? 'Start tracking'
          : historyFor(selected.id)?.archived && !unlimited
            ? `Start fresh on ${selected.name}`
            : existingIgdbIds.has(selected.id)
              ? `Start ${runLabelFor(cycle)} on ${selected.name}`
              : `Start tracking ${selected.name}`}
      </button>
      <p className="ghost-note">
        {selected && historyFor(selected.id)?.archived ? (
          <>Free plan: {FREE_TIER_GAME_LIMIT} games at a time.</>
        ) : selected && existingIgdbIds.has(selected.id) ? (
          <>
            You're already tracking {selected.name}. Runs live inside a game, so this starts a new
            one and keeps every previous run's tally intact.
          </>
        ) : (
          <>
            Free plan: {FREE_TIER_GAME_LIMIT} games at a time. Swap one out later and its history is
            archived, not deleted.
          </>
        )}
      </p>
    </div>
  );
}
