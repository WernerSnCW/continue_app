/**
 * Verifies the Twitch/IGDB credentials in .env actually work.
 *
 *   node scripts/check-igdb.mjs
 *
 * 1. Exchanges TWITCH_CLIENT_ID/SECRET for a bearer token (client_credentials).
 * 2. Uses that token to run a test IGDB game search.
 *
 * Prints nothing sensitive — the token is masked.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const raw = readFileSync(resolve(root, '.env'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const mask = (s) => (s.length <= 8 ? '***' : `${s.slice(0, 4)}…${s.slice(-4)}`);

const env = loadEnv();
const missing = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`✗ Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

// --- 1. token exchange -----------------------------------------------------
const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
tokenUrl.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
tokenUrl.searchParams.set('client_secret', env.TWITCH_CLIENT_SECRET);
tokenUrl.searchParams.set('grant_type', 'client_credentials');

const tokenRes = await fetch(tokenUrl, { method: 'POST' });
const tokenBody = await tokenRes.json().catch(() => ({}));

if (!tokenRes.ok) {
  console.error(`✗ Token exchange failed (HTTP ${tokenRes.status})`);
  console.error(`  ${tokenBody.message ?? JSON.stringify(tokenBody)}`);
  process.exit(1);
}

const token = tokenBody.access_token;
const days = Math.round(tokenBody.expires_in / 86400);
console.log(`✓ Token acquired: ${mask(token)} (expires in ~${days}d)`);

// --- 2. test IGDB search ---------------------------------------------------
const igdbRes = await fetch('https://api.igdb.com/v4/games', {
  method: 'POST',
  headers: {
    'Client-ID': env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  },
  body: 'search "Elden Ring"; fields name, first_release_date; limit 5;',
});

if (!igdbRes.ok) {
  console.error(`✗ IGDB search failed (HTTP ${igdbRes.status})`);
  console.error(`  ${await igdbRes.text()}`);
  process.exit(1);
}

const games = await igdbRes.json();
console.log(`✓ IGDB search returned ${games.length} result(s):`);
for (const g of games) {
  const year = g.first_release_date
    ? new Date(g.first_release_date * 1000).getFullYear()
    : '????';
  console.log(`    ${g.id}  ${g.name} (${year})`);
}
console.log('\n✓ Twitch/IGDB credentials are working.');
