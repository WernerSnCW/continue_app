/**
 * Pure IGDB query-building and result-collapsing logic.
 *
 * Deliberately free of Deno/Supabase imports so it can be unit-tested from
 * plain Node (see scripts/check-igdb-search.mjs) without a running edge
 * runtime.
 *
 * The problem this solves: IGDB lists every retail edition of a game as its
 * own row with its own id ("Elden Ring: Deluxe Edition", "...: Collector's
 * Edition", ...). If the picker let users select those, death counts for what
 * is really one game would fragment across several ids and the global average
 * would be meaningless. Editions are linked to their real game by
 * `version_parent`, so we collapse onto that.
 */

/**
 * IGDB replaced the old `category` field with `game_type`. Asking for
 * `category` today returns HTTP 200 with the field silently absent, so this
 * requests `game_type` — same meaning, current name.
 */
export const SEARCH_FIELDS = 'name, game_type, version_parent, first_release_date, cover.image_id';

/**
 * `game_type` values that belong in the picker. Sourced from IGDB's
 * /game_types endpoint.
 *
 * Remakes and remasters are kept deliberately: Demon's Souls (2020) is a
 * different playthrough from the 2009 original and deserves its own tally.
 * DLC, expansions, bundles, mods, ports and packs are excluded — they aren't
 * separate games you'd count deaths against.
 */
export const PICKER_GAME_TYPES: ReadonlySet<number> = new Set([
  0, // Main Game
  4, // Standalone Expansion
  8, // Remake
  9, // Remaster
  10, // Expanded Game
]);

export interface RawIgdbGame {
  id: number;
  name: string;
  game_type?: number;
  version_parent?: number;
  first_release_date?: number;
  cover?: { image_id?: string };
}

export interface CanonicalGame {
  id: number;
  name: string;
  coverUrl: string | null;
  firstReleaseYear: number | null;
}

const escapeSearch = (term: string) => term.replace(/["\\]/g, '\\$&');

export function buildSearchQuery(term: string, limit = 20): string {
  return `search "${escapeSearch(term)}"; fields ${SEARCH_FIELDS}; limit ${limit};`;
}

/** Fetches specific games by id — used to resolve parents we didn't match directly. */
export function buildByIdQuery(ids: readonly number[]): string {
  return `where id = (${ids.join(',')}); fields ${SEARCH_FIELDS}; limit ${ids.length};`;
}

export const coverUrl = (row: RawIgdbGame): string | null =>
  row.cover?.image_id
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${row.cover.image_id}.jpg`
    : null;

export const releaseYear = (row: RawIgdbGame): number | null =>
  typeof row.first_release_date === 'number'
    ? new Date(row.first_release_date * 1000).getUTCFullYear()
    : null;

/** The id a row should collapse onto: its parent if it's an edition, else itself. */
export const canonicalIdOf = (row: RawIgdbGame): number => row.version_parent ?? row.id;

/**
 * Step 1 of the collapse. Returns the canonical ids in IGDB's relevance order,
 * the rows we already have data for, and the parent ids still needing a fetch
 * (editions can match a search when their parent didn't).
 */
export function planCollapse(rows: readonly RawIgdbGame[]): {
  order: number[];
  have: Map<number, RawIgdbGame>;
  missingParentIds: number[];
} {
  const order: number[] = [];
  const have = new Map<number, RawIgdbGame>();

  for (const row of rows) {
    const canonical = canonicalIdOf(row);
    if (!order.includes(canonical)) order.push(canonical);
    // Only a row that *is* the canonical game describes it. An edition row
    // carries the edition's own name/cover/type, which must not stand in for
    // the parent's.
    if (canonical === row.id) have.set(row.id, row);
  }

  return { order, have, missingParentIds: order.filter((id) => !have.has(id)) };
}

/**
 * Step 2. Given the plan plus any parent rows that were fetched, produce the
 * final picker list: one entry per canonical game, editions folded in,
 * non-game entries (DLC, mods, bundles...) filtered out.
 *
 * Filtering happens *after* resolution on purpose — "Elden Ring: Tarnished
 * Edition" is game_type 3 (Bundle), but the game it collapses onto is a Main
 * Game and belongs in the picker.
 */
export function finishCollapse(
  plan: ReturnType<typeof planCollapse>,
  fetchedParents: readonly RawIgdbGame[] = [],
): CanonicalGame[] {
  const resolved = new Map(plan.have);
  for (const row of fetchedParents) resolved.set(row.id, row);

  const out: CanonicalGame[] = [];
  for (const id of plan.order) {
    const row = resolved.get(id);
    if (!row) continue; // parent couldn't be resolved; drop rather than guess
    if (!PICKER_GAME_TYPES.has(row.game_type ?? 0)) continue;
    out.push({
      id: row.id,
      name: row.name,
      coverUrl: coverUrl(row),
      firstReleaseYear: releaseYear(row),
    });
  }
  return out;
}
