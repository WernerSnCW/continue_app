/**
 * End-to-end check of the DEPLOYED delete-account Edge Function.
 *
 *   node scripts/check-delete-account.mjs
 *
 * Account deletion is required by Google Play and is the one operation in this
 * app that is meant to destroy data, so it needs proving rather than assuming.
 * It runs against throwaway anonymous accounts created for the purpose and
 * cleaned up afterwards — it never touches a real user.
 *
 * Verifies four things only a real deployment can show:
 *   1. the backup row, every retained version, and the auth user all go,
 *   2. a second user's data is untouched by someone else's deletion,
 *   3. an unauthenticated call is refused,
 *   4. a forged token is refused.
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

const admin = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...(init.headers ?? {}) },
  });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// --- make a throwaway account, with data ------------------------------------

/** Anonymous sign-in, the same route the app itself uses. */
const newAnonAccount = async () => {
  const r = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((res) => res.json());
  return { token: r.access_token, id: r.user?.id, raw: r };
};

const subject = await newAnonAccount();
const token = subject.token;
const userId = subject.id;
if (!token || !userId) {
  console.error('could not create a throwaway account:', JSON.stringify(subject.raw).slice(0, 300));
  process.exit(1);
}
console.log(`throwaway user: ${userId}\n`);

const asUser = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

const payload = { games: [{ id: 'g1' }], runs: [], deaths: [], sessions: [] };
await asUser('/rest/v1/backups', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ user_id: userId, payload, game_count: 1, death_count: 3 }),
});
for (const reason of ['periodic', 'before restore']) {
  await asUser('/rest/v1/backup_versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, payload, game_count: 1, death_count: 3, reason }),
  });
}

const countRows = async (table) => {
  const r = await admin(`/rest/v1/${table}?select=user_id&user_id=eq.${userId}`);
  return (await r.json()).length;
};

check('test account has a backup row', (await countRows('backups')) === 1);
check('test account has retained versions', (await countRows('backup_versions')) === 2);

// A second account, to prove deletion is scoped to the caller.
const bystander = await newAnonAccount();
const bystanderId = bystander.id;
await fetch(`${URL}/rest/v1/backups`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${bystander.token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({ user_id: bystanderId, payload, game_count: 9, death_count: 99 }),
});

// --- refuse unauthenticated calls -------------------------------------------

const noAuth = await fetch(`${URL}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { apikey: ANON },
});
check('refuses a call with no user token', noAuth.status === 401, `status ${noAuth.status}`);

const badAuth = await fetch(`${URL}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: 'Bearer not-a-real-token' },
});
check('refuses a forged token', badAuth.status === 401, `status ${badAuth.status}`);

// --- the real thing ---------------------------------------------------------

const del = await fetch(`${URL}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${token}` },
});
const delBody = await del.json();
check('deletes when called by the account owner', del.ok && delBody.deleted === true, `status ${del.status}`);

check('backup row is gone', (await countRows('backups')) === 0);
check('retained versions are gone', (await countRows('backup_versions')) === 0);

const stillThere = await admin(`/auth/v1/admin/users/${userId}`);
check('auth user is gone', stillThere.status === 404, `status ${stillThere.status}`);

const bystanderRows = await admin(`/rest/v1/backups?select=user_id&user_id=eq.${bystanderId}`);
check("another user's backup is untouched", (await bystanderRows.json()).length === 1);

// --- clean up the bystander -------------------------------------------------

await admin(`/auth/v1/admin/users/${bystanderId}`, { method: 'DELETE' });
console.log(`\ncleaned up bystander ${bystanderId}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
