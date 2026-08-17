/**
 * End-to-end check of the DEPLOYED suggestions table.
 *
 *   node scripts/check-suggestions.mjs
 *
 * The point of this table is that players can write to it and nobody can read
 * it back with the anon key — a private inbox, not a public one. That is an RLS
 * claim, and RLS claims are worth proving rather than asserting. Runs against a
 * throwaway anonymous account and cleans up after itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2] ?? process.cwd();
const env = Object.fromEntries(
  readFileSync(join(repo, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z]/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const admin = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...(init.headers ?? {}) },
  });

const anonAccount = async () => {
  const r = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((res) => res.json());
  return { token: r.access_token, id: r.user?.id };
};

const me = await anonAccount();
if (!me.token) {
  console.error('could not create a throwaway account');
  process.exit(1);
}
console.log(`throwaway user: ${me.id}\n`);

const asUser = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${me.token}`, ...(init.headers ?? {}) },
  });

const send = (body, userId = me.id) =>
  asUser('/rest/v1/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, body, app_version: '0.0.1-test' }),
  });

// --- the happy path ---------------------------------------------------------

const ok = await send('Please add a home screen widget for the death count.');
check('a player can submit a suggestion', ok.ok, `status ${ok.status}`);

// --- it is write-only -------------------------------------------------------

const read = await asUser('/rest/v1/suggestions?select=body');
const readRows = read.ok ? await read.json() : null;
check(
  'a player cannot read suggestions back',
  Array.isArray(readRows) ? readRows.length === 0 : !read.ok,
  `status ${read.status}, rows ${Array.isArray(readRows) ? readRows.length : 'n/a'}`,
);

const update = await asUser(`/rest/v1/suggestions?user_id=eq.${me.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: 'edited after sending' }),
});
const updatedRows = update.ok ? await update.json().catch(() => []) : [];
check(
  'a player cannot edit a sent suggestion',
  !update.ok || updatedRows.length === 0,
  `status ${update.status}`,
);

const del = await asUser(`/rest/v1/suggestions?user_id=eq.${me.id}`, { method: 'DELETE' });
const deletedRows = del.ok ? await del.json().catch(() => []) : [];
check('a player cannot delete a sent suggestion', !del.ok || deletedRows.length === 0);

// --- you cannot submit as somebody else -------------------------------------

const other = await anonAccount();
const forged = await send('Submitted on behalf of another account.', other.id);
check('cannot submit under another user id', !forged.ok, `status ${forged.status}`);

// --- constraints ------------------------------------------------------------

const tooShort = await send('no');
check('rejects a too-short body', !tooShort.ok, `status ${tooShort.status}`);

const tooLong = await send('a'.repeat(2001));
check('rejects an over-long body', !tooLong.ok, `status ${tooLong.status}`);

// --- rate limit -------------------------------------------------------------

let blockedAt = null;
for (let i = 2; i <= 12 && blockedAt === null; i++) {
  const r = await send(`Filler suggestion number ${i} for rate limit testing.`);
  if (!r.ok) blockedAt = i;
}
check('rate limits a flood of submissions', blockedAt !== null, `blocked at #${blockedAt}`);

// --- the developer can read them --------------------------------------------

const mine = await admin(`/rest/v1/suggestions?select=body,app_version&user_id=eq.${me.id}`);
const mineRows = await mine.json();
check('the service role can read them', Array.isArray(mineRows) && mineRows.length > 0, `${mineRows.length} rows`);
check('app version is recorded', mineRows[0]?.app_version === '0.0.1-test');

// --- cleanup ----------------------------------------------------------------

await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' });
await admin(`/auth/v1/admin/users/${other.id}`, { method: 'DELETE' });

const left = await admin(`/rest/v1/suggestions?select=id&user_id=eq.${me.id}`);
check('deleting the account removes their suggestions', (await left.json()).length === 0);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
