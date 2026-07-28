/**
 * Exercises the igdb-search collapse rule against live IGDB.
 *
 *   node scripts/check-igdb-search.mjs
 *
 * Imports the same _shared/collapse.ts the Edge Function uses and drives it
 * through the identical two-step flow (search -> resolve missing parents), so
 * this tests the real logic rather than a copy of it. Requires Node >= 22.18
 * for TypeScript type stripping.
 *
 * The token exchange here is done directly rather than through the igdb-token
 * function, since that needs a deployed or locally-served edge runtime.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildByIdQuery,
  buildSearchQuery,
  finishCollapse,
  planCollapse,
} from '../services/continue-api/supabase/functions/_shared/collapse.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const missing = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`✗ Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
tokenUrl.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
tokenUrl.searchParams.set('client_secret', env.TWITCH_CLIENT_SECRET);
tokenUrl.searchParams.set('grant_type', 'client_credentials');

const tokenRes = await fetch(tokenUrl, { method: 'POST' });
if (!tokenRes.ok) {
  console.error(`✗ Token exchange failed (HTTP ${tokenRes.status})`);
  process.exit(1);
}
const { access_token: token } = await tokenRes.json();

async function igdb(body) {
  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`IGDB query failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

/** Mirrors igdb-search/index.ts exactly. */
async function search(term, limit = 20) {
  const raw = await igdb(buildSearchQuery(term, limit));
  const plan = planCollapse(raw);
  const parents = plan.missingParentIds.length ? await igdb(buildByIdQuery(plan.missingParentIds)) : [];
  return { raw, results: finishCollapse(plan, parents) };
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// --- Case 1: the headline case ---------------------------------------------
console.log('\n=== search "Elden Ring" ===\n');
const { raw, results } = await search('Elden Ring');

const editions = raw.filter((r) => r.version_parent);
console.log(`Raw IGDB rows: ${raw.length} (${editions.length} are editions of another game)`);
for (const r of editions) {
  console.log(`    ${String(r.id).padEnd(7)} ${r.name}  →  collapses onto ${r.version_parent}`);
}

console.log(`\nCanonical results: ${results.length}`);
for (const r of results) {
  console.log(`    ${String(r.id).padEnd(7)} ${r.name} (${r.firstReleaseYear ?? '????'})`);
}

console.log('\nAssertions:');
const ids = results.map((r) => r.id);
const editionIds = editions.map((r) => r.id);

check('no edition id survives into the results', !ids.some((id) => editionIds.includes(id)));
check('every result id is unique', new Set(ids).size === ids.length);
check(
  '"Elden Ring" (119133) appears exactly once',
  ids.filter((id) => id === 119133).length === 1,
);
check(
  'all 4 base-game editions folded into 119133',
  [338079, 180258, 186227, 180259].every((id) => !ids.includes(id)),
);
check(
  'mods and DLC excluded (Seamless Co-op 381683, Shadow of the Erdtree 240009)',
  !ids.includes(381683) && !ids.includes(240009),
);
check(
  'results are strictly fewer than raw rows',
  results.length < raw.length,
  `${raw.length} → ${results.length}`,
);

// --- Case 2: only an edition matches ---------------------------------------
console.log('\n=== search "Elden Ring Tarnished Edition" (only an edition matches) ===\n');
const tarnished = await search('Elden Ring Tarnished Edition');
console.log(`Raw rows: ${tarnished.raw.map((r) => `${r.id} ${r.name}`).join(', ') || '(none)'}`);
console.log(`Canonical: ${tarnished.results.map((r) => `${r.id} ${r.name}`).join(', ') || '(none)'}`);
console.log('\nAssertions:');
check(
  'edition-only match resolves up to the parent game, not dropped',
  tarnished.results.some((r) => r.id === 119133),
);

console.log(
  failures === 0
    ? '\n✓ Collapse rule working as specified.'
    : `\n✗ ${failures} assertion(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
