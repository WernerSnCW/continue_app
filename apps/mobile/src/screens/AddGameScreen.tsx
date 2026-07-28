import { useEffect, useRef, useState } from 'react';
import type { IgdbSearchResult } from '@continue/shared';
import { searchGames } from '../lib/igdb';

interface Props {
  onBack: () => void;
  onPick: (result: IgdbSearchResult) => void;
  /** igdbIds already tracked, so the picker can mark them. */
  existingIgdbIds: ReadonlySet<number>;
}

export function AddGameScreen({ onBack, onPick, existingIgdbIds }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IgdbSearchResult[]>([]);
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

  return (
    <div className="screen">
      <header className="screen-head add-head">
        <button className="btn-ghost" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1 className="title-sm">Add a game</h1>
      </header>

      <input
        ref={inputRef}
        className="search-input"
        type="search"
        value={query}
        placeholder="Search games…"
        onChange={(e) => setQuery(e.target.value)}
      />

      {status === 'loading' && <p className="hint">Searching…</p>}
      {status === 'error' && <p className="hint hint-error">{error}</p>}
      {status === 'idle' && query.trim().length >= 2 && results.length === 0 && (
        <p className="hint">No games found.</p>
      )}

      <ul className="result-list">
        {results.map((r) => {
          const already = existingIgdbIds.has(r.id);
          return (
            <li key={r.id}>
              <button className="result-row" onClick={() => onPick(r)} disabled={already}>
                {r.coverUrl ? (
                  <img className="cover cover-sm" src={r.coverUrl} alt="" loading="lazy" />
                ) : (
                  <div className="cover cover-sm cover-blank" aria-hidden="true" />
                )}
                <span className="result-meta">
                  <span className="game-name">{r.name}</span>
                  <span className="game-run">{r.firstReleaseYear ?? '—'}</span>
                </span>
                {already && <span className="already">tracked</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
