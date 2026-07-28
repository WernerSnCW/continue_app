/**
 * End-to-end check against the DEPLOYED Edge Functions.
 *
 *   node scripts/check-deployed.mjs
 *
 * Verifies three things that only a real deployment can prove:
 *   1. igdb_token_cache is populated on the first call,
 *   2. a second call reuses the cached token instead of re-exchanging,
 *   3. the collapse logic returns canonical results from the live function.
 *
 * Reads the cache table with the service-role key, which is the only role
 * that can see it (RLS on, no policies).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = env;
const mask = (s) => (!s ? '(none)' : s.length <= 8 ? '***' : `${s.slice(0, 4)}…${s.slice(-4)}`);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Reads the single cache row using the service-role key. */
async function readCache() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/igdb_token_cache?id=eq.1&select=access_token,expires_at,updated_at`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`cache read failed (HTTP ${res.status}): ${await res.text()}`);
  return (await res.json())[0] ?? null;
}

async function callSearch(q) {
  const started = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/igdb-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ q, limit: 20 }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - started };
}

// --- 1. cache state before any call ----------------------------------------
console.log('\n=== 1. token cache before first call ===\n');
const before = await readCache();
console.log(`  cache row: ${before ? `present (token ${mask(before.access_token)})` : 'empty'}`);

// --- 2. first call ---------------------------------------------------------
console.log('\n=== 2. first call to deployed igdb-search ===\n');
const first = await callSearch('Elden Ring');
check('function responded 200', first.status === 200, `HTTP ${first.status} in ${first.ms}ms`);
if (first.status !== 200) {
  console.error(`  body: ${JSON.stringify(first.body).slice(0, 400)}`);
  process.exit(1);
}

const afterFirst = await readCache();
check('cache row exists after first call', afterFirst !== null);
if (afterFirst) {
  const days = Math.round((new Date(afterFirst.expires_at) - Date.now()) / 86400000);
  console.log(`      token ${mask(afterFirst.access_token)}, expires in ~${days}d`);
  check('expiry is in the future', new Date(afterFirst.expires_at) > new Date());
}

// --- 3. second call: must reuse ---------------------------------------------
console.log('\n=== 3. second call — must reuse, not re-exchange ===\n');
const second = await callSearch('Elden Ring');
check('function responded 200', second.status === 200, `HTTP ${second.status} in ${second.ms}ms`);

const afterSecond = await readCache();
check(
  'cached token unchanged (no re-exchange)',
  afterFirst && afterSecond && afterFirst.access_token === afterSecond.access_token,
);
check(
  'cache row not rewritten (updated_at identical)',
  afterFirst && afterSecond && afterFirst.updated_at === afterSecond.updated_at,
  afterSecond?.updated_at,
);

// --- 4. collapse correctness from the live function -------------------------
console.log('\n=== 4. collapse results from the deployed function ===\n');
const results = first.body.results ?? [];
for (const r of results) console.log(`    ${String(r.id).padEnd(7)} ${r.name} (${r.firstReleaseYear ?? '????'})`);

const ids = results.map((r) => r.id);
console.log('');
check('returned a non-empty result set', results.length > 0);
check('every id unique', new Set(ids).size === ids.length);
check('"Elden Ring" (119133) present exactly once', ids.filter((i) => i === 119133).length === 1);
check(
  'no edition ids leaked (Deluxe/Collector\'s/Launch/Tarnished)',
  ![338079, 180258, 186227, 180259].some((i) => ids.includes(i)),
);
check('mods and DLC excluded (381683, 240009)', !ids.includes(381683) && !ids.includes(240009));

// edition-only search still resolves to the parent
const edition = await callSearch('Elden Ring Tarnished Edition');
check(
  'edition-only search resolves to parent 119133',
  (edition.body.results ?? []).some((r) => r.id === 119133),
);

console.log(
  failures === 0
    ? '\n✓ Deployed IGDB data layer verified end-to-end.'
    : `\n✗ ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
