/**
 * igdb-search — game search for the picker, with editions collapsed.
 *
 *   POST /functions/v1/igdb-search  { "q": "elden ring", "limit": 20 }
 *   -> { "results": [{ id, name, coverUrl, firstReleaseYear }, ...] }
 *
 * Every returned id is canonical: editions ("Deluxe", "Collector's", ...)
 * resolve to the game they're an edition of, so death tallies and the global
 * average key off one id per game. The token never leaves the function.
 */
import {
  handlePreflight,
  igdbQuery,
  IgdbError,
  jsonResponse,
  serviceClient,
} from '../_shared/igdb.ts';
import {
  buildByIdQuery,
  buildSearchQuery,
  finishCollapse,
  planCollapse,
  type RawIgdbGame,
} from '../_shared/collapse.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const { q, limit } = await req.json().catch(() => ({}));

    if (typeof q !== 'string' || q.trim() === '') {
      return jsonResponse({ error: 'Body must include a non-empty "q" string.' }, 400);
    }
    const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

    const client = serviceClient();

    const raw = await igdbQuery<RawIgdbGame>('games', buildSearchQuery(q.trim(), cappedLimit), client);
    const plan = planCollapse(raw);

    // Editions can match a search when their parent game didn't; fetch those
    // parents so the game still shows up, under its canonical id.
    const parents = plan.missingParentIds.length
      ? await igdbQuery<RawIgdbGame>('games', buildByIdQuery(plan.missingParentIds), client)
      : [];

    return jsonResponse({ results: finishCollapse(plan, parents) });
  } catch (err) {
    const status = err instanceof IgdbError ? err.status : 500;
    console.error('igdb-search failed:', err);
    return jsonResponse({ error: (err as Error).message }, status);
  }
});
