/**
 * Client for the igdb-search Edge Function.
 *
 * The app never talks to IGDB directly and never holds a Twitch token — the
 * function owns the credentials and returns canonical ids with editions
 * already collapsed.
 */
import type { IgdbSearchResult } from '@continue/shared';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSearchConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export class SearchUnavailableError extends Error {}

export async function searchGames(
  query: string,
  signal?: AbortSignal,
): Promise<IgdbSearchResult[]> {
  if (!isSearchConfigured) {
    throw new SearchUnavailableError(
      'Game search is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/mobile/.env.',
    );
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/igdb-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ q: query, limit: 20 }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new SearchUnavailableError(
      res.status === 404
        ? 'Search function not deployed yet.'
        : `Search failed (HTTP ${res.status}). ${detail.slice(0, 120)}`,
    );
  }

  const body = (await res.json()) as { results?: IgdbSearchResult[] };
  return body.results ?? [];
}
