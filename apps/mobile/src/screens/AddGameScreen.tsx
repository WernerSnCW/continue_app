import { useEffect, useRef, useState } from 'react';
import type { IgdbSearchResult } from '@continue/shared';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { searchGames } from '../lib/igdb';

/** Suggestions from the prototype — genre-appropriate starting points. */
const SUGGESTED = ['Dark Souls III', 'Bloodborne', 'Lies of P', 'Nine Sols', 'Lords of the Fallen'];

interface Props {
  onBack: () => void;
  onStart: (result: IgdbSearchResult, cycle: number) => void;
  existingIgdbIds: ReadonlySet<number>;
  unlimited: boolean;
}

export function AddGameScreen({ onBack, onStart, existingIgdbIds, unlimited }: Props) {
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
                  disabled={already}
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
      </div>

      <button
        className="primary-btn"
        disabled={!selected}
        onClick={() => selected && onStart(selected, cycle)}
      >
        {selected ? `Start tracking ${selected.name}` : 'Start tracking'}
      </button>
      <p className="ghost-note">
        Free plan: {FREE_TIER_GAME_LIMIT} games at a time. Swap one out later and its history is
        archived, not deleted.
      </p>
    </div>
  );
}
