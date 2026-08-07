/**
 * Cloud backup.
 *
 * The phone stays the source of truth — this app has to keep counting with no
 * signal — so this is a one-way push of a state snapshot, never a read that
 * could block or overwrite what's on the device.
 *
 * Sign-in is anonymous: a death counter that demanded an account before you
 * could tap a button would lose most of its users at the first screen. The
 * trade-off is that the identity lives in this install's storage, so a
 * reinstall produces a *new* anonymous user which cannot see the old backup.
 * Restoring on a fresh install therefore needs the identity to be linked to
 * something durable (an email, or Play Games), which is the next piece of work
 * rather than something this file quietly pretends to solve.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isBackupConfigured = Boolean(URL && KEY);

export type BackupState = 'idle' | 'signing-in' | 'saving' | 'saved' | 'offline' | 'error';

export interface BackupStatus {
  state: BackupState;
  lastSavedAt: number | null;
  userId: string | null;
  message?: string;
}

let client: SupabaseClient | null = null;

function db(): SupabaseClient | null {
  if (!isBackupConfigured) return null;
  client ??= createClient(URL!, KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The webview has no URL to parse tokens out of.
      detectSessionInUrl: false,
      storageKey: 'continue.auth.v1',
    },
  });
  return client;
}

/**
 * Signs in anonymously if there's no session yet. Returns the user id.
 *
 * Refuses to mint a new anonymous account when this install is known to have
 * had a real one. Minting on demand is right for a first run — nobody should
 * have to register before tapping a button — but wrong for a lapsed session,
 * where it silently turns a logged-out user into a brand-new one, starts
 * writing to an empty row, and leaves their actual backup orphaned. Returning
 * null instead makes the failure visible: the push fails and the app asks them
 * to sign back in.
 */
export async function ensureSession(): Promise<string | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    if (data.session?.user) return data.session.user.id;
    if (remembered()?.email) return null;
    const { data: created, error } = await c.auth.signInAnonymously();
    if (error) return null;
    if (created.user) remember({ userId: created.user.id, email: null });
    return created.user?.id ?? null;
  } catch {
    return null; // offline, most likely
  }
}

// --- reconciliation ---------------------------------------------------------

const SYNC_KEY = 'continue.backup.sync.v1';

/** The `updated_at` of the cloud row as this device last left it. */
const lastSynced = (): string | null => {
  try {
    return localStorage.getItem(SYNC_KEY);
  } catch {
    return null;
  }
};

const markSynced = (iso: string): void => {
  try {
    localStorage.setItem(SYNC_KEY, iso);
  } catch {
    /* best effort */
  }
};

/**
 * True when the cloud row is the same one this device last wrote.
 *
 * Compared as instants, never as strings. We send `toISOString()`
 * (`...123Z`) and Postgres hands the same moment back as `...123+00:00`, so a
 * string comparison is false even when the timestamps are identical. That made
 * every push look like it was landing on an unseen row, and turned the conflict
 * guard into "complain whenever the cloud holds more" — which is what a
 * deliberate delete looks like from the outside.
 */
export const isSameInstant = (remoteUpdatedAt: string, seen: number | null): boolean => {
  if (seen === null) return false;
  const remote = Date.parse(remoteUpdatedAt);
  return !Number.isNaN(remote) && remote === seen;
};

/**
 * Whether a push must be refused because the cloud holds more than we're about
 * to replace it with, on a row this device hasn't seen.
 *
 * Split out from `pushBackup` as a pure function purely so it can be tested —
 * it is the single decision standing between a stale device and someone's
 * tally, and it is not reachable from a test while buried in a network call.
 */
export function shouldRefusePush(
  remote: RemoteMeta | null,
  local: { games: number; deaths: number },
  lastSeenAt: number | null,
): boolean {
  if (!remote) return false;
  if (isSameInstant(remote.updatedAt, lastSeenAt)) return false;
  return remote.deaths > local.deaths || remote.games > local.games;
}

/**
 * When this device last successfully wrote to the cloud, across launches.
 *
 * The in-session push state starts empty every launch, so a phone that has
 * silently failed to back up for a fortnight looked exactly like one opened for
 * the first time. This is the number that can tell them apart.
 */
export const lastSyncedAt = (): number | null => {
  const iso = lastSynced();
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export interface RemoteMeta {
  updatedAt: string;
  games: number;
  deaths: number;
}

/**
 * Header only — deliberately not the payload, which can be large.
 *
 * Filtered by user id as well as trusting RLS. Belt and braces: a mis-scoped
 * read here wouldn't leak anything, but it would compare this phone against
 * someone else's counts and refuse to back up.
 */
export async function fetchRemoteMeta(userId?: string): Promise<RemoteMeta | null> {
  const c = db();
  if (!c) return null;
  try {
    const uid = userId ?? (await c.auth.getUser()).data.user?.id;
    if (!uid) return null;
    const { data } = await c
      .from('backups')
      .select('updated_at, game_count, death_count')
      .eq('user_id', uid)
      .maybeSingle();
    if (!data) return null;
    return {
      updatedAt: data.updated_at as string,
      games: (data.game_count as number) ?? 0,
      deaths: (data.death_count as number) ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Set once the user has explicitly chosen this phone's version over the
 * cloud's. Session-scoped: the next successful push records the new
 * `updated_at`, after which the two agree again and the question stops
 * being asked.
 */
let overwriteAllowed = false;

export const allowOverwrite = (): void => {
  overwriteAllowed = true;
};

/**
 * Pushes a snapshot. Returns false on any failure — callers treat backup as
 * best-effort and never surface it as something the user must fix mid-run.
 *
 * `backups` holds one row per user and a push overwrites it wholesale, so a
 * device that has fallen behind — restored from an old phone image, offline for
 * a fortnight, freshly reinstalled — can wipe out a much richer backup simply
 * by being opened. Before writing, the cloud row's header is compared against
 * what this device last left there. A cloud row that has moved on *and* holds
 * more than we're about to send is refused rather than overwritten.
 *
 * Only "more" is refused, deliberately. Any divergence would flag on every
 * upgrade and after every restore, and an alert that fires constantly is one
 * people learn to click through.
 */
export async function pushBackup(
  payload: unknown,
  counts: { games: number; deaths: number },
): Promise<{ ok: boolean; at?: number; message?: string; conflict?: RemoteMeta }> {
  const c = db();
  if (!c) return { ok: false, message: 'Backup is not configured.' };

  const userId = await ensureSession();
  if (!userId) return { ok: false, message: 'Could not reach the backup service.' };

  if (!overwriteAllowed) {
    const remote = await fetchRemoteMeta(userId);
    if (shouldRefusePush(remote, counts, lastSyncedAt())) {
      return { ok: false, conflict: remote!, message: 'The cloud backup is ahead of this phone.' };
    }
  }

  try {
    const at = new Date().toISOString();
    const { error } = await c.from('backups').upsert(
      {
        user_id: userId,
        payload,
        game_count: counts.games,
        death_count: counts.deaths,
        app_version: __APP_VERSION__,
        updated_at: at,
      },
      { onConflict: 'user_id' },
    );
    if (error) return { ok: false, message: error.message };
    markSynced(at);
    overwriteAllowed = false;
    return { ok: true, at: Date.now() };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * Called after a restore. The device now holds exactly what the cloud holds,
 * so the row it just read becomes the sync point — otherwise the first push
 * after restoring a smaller backup would look like a regression and be
 * refused by the check above.
 */
export async function adoptRemoteAsSynced(): Promise<void> {
  const remote = await fetchRemoteMeta();
  if (remote) markSynced(remote.updatedAt);
  // A version restore leaves the live row untouched and older than what is now
  // on the phone, so allow that first push through explicitly.
  overwriteAllowed = true;
}

// --- identity ---------------------------------------------------------------

export interface Identity {
  userId: string | null;
  email: string | null;
  /** True while the account is still anonymous — i.e. not recoverable. */
  anonymous: boolean;
}

const IDENTITY_KEY = 'continue.identity.v1';

interface RememberedIdentity {
  userId: string;
  email: string | null;
}

const remembered = (): RememberedIdentity | null => {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as RememberedIdentity) : null;
  } catch {
    return null;
  }
};

const remember = (id: RememberedIdentity): void => {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* best effort */
  }
};

export const forgetIdentity = (): void => {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* best effort */
  }
};

/**
 * Detects the app silently becoming a different account.
 *
 * `ensureSession` mints a fresh anonymous user whenever no session is present,
 * no questions asked. If a session lapses — a rotated refresh token, restored
 * app data, an expired login — the app quietly becomes someone new and starts
 * writing to an empty row, while the real backup sits orphaned and untouched.
 * The user finds out only when a restore turns up nothing.
 *
 * So the last known account is remembered locally and checked on launch.
 */
export async function checkIdentityContinuity(): Promise<{
  lostAccount: boolean;
  previousEmail: string | null;
}> {
  const before = remembered();
  const now = await getIdentity();

  // Nothing to compare against yet, or we never had a real account.
  if (!before?.email) {
    if (now.userId) remember({ userId: now.userId, email: now.email });
    return { lostAccount: false, previousEmail: null };
  }

  // Same account, or an upgrade of it — fine, keep it current.
  if (now.userId === before.userId || now.email === before.email) {
    if (now.userId) remember({ userId: now.userId, email: now.email });
    return { lostAccount: false, previousEmail: before.email };
  }

  // We were signed in as a real account and are now someone else. Do not
  // overwrite the remembered identity: it's the only pointer back.
  return { lostAccount: true, previousEmail: before.email };
}

export async function getIdentity(): Promise<Identity> {
  const c = db();
  if (!c) return { userId: null, email: null, anonymous: true };
  const { data } = await c.auth.getUser();
  const u = data.user;
  return {
    userId: u?.id ?? null,
    email: u?.email ?? null,
    anonymous: u ? (u.is_anonymous ?? !u.email) : true,
  };
}

export type AuthStep = { ok: true } | { ok: false; message: string };

/**
 * Attaches an email to the current (anonymous) account, which is what makes
 * the backup recoverable later. Sends a confirmation code; the account is not
 * converted until `confirmEmail` succeeds.
 */
export async function linkEmail(email: string): Promise<AuthStep> {
  const c = db();
  if (!c) return { ok: false, message: 'Backup is not configured.' };
  await ensureSession();
  const { error } = await c.auth.updateUser({ email: email.trim() });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
  return { ok: true };
}

export async function confirmEmail(email: string, token: string): Promise<AuthStep> {
  const c = db();
  if (!c) return { ok: false, message: 'Backup is not configured.' };
  const { data, error } = await c.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email_change',
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
  if (data.user) remember({ userId: data.user.id, email: data.user.email ?? null });
  return { ok: true };
}

/** Sends a sign-in code to an address that already owns a backup. */
export async function requestSignIn(email: string): Promise<AuthStep> {
  const c = db();
  if (!c) return { ok: false, message: 'Backup is not configured.' };
  const { error } = await c.auth.signInWithOtp({
    email: email.trim(),
    // Never invent an account here: typing an address that was never linked
    // should say so, not silently create an empty one.
    options: { shouldCreateUser: false },
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
  return { ok: true };
}

export async function completeSignIn(email: string, token: string): Promise<AuthStep> {
  const c = db();
  if (!c) return { ok: false, message: 'Backup is not configured.' };
  const { data, error } = await c.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
  // Deliberately signing in as this account makes it the one to remember.
  if (data.user) remember({ userId: data.user.id, email: data.user.email ?? null });
  return { ok: true };
}

/** Pulls the full snapshot for the signed-in user, for restore. */
export async function fetchBackupPayload(): Promise<{
  payload: unknown;
  games: number;
  deaths: number;
  updatedAt: string;
} | null> {
  const c = db();
  if (!c) return null;
  const { data: auth } = await c.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await c
    .from('backups')
    .select('payload, game_count, death_count, updated_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    payload: data.payload,
    games: data.game_count as number,
    deaths: data.death_count as number,
    updatedAt: data.updated_at as string,
  };
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();

  // Supabase reports the exact cooldown ("...after 47 seconds"). Passing that
  // through beats a vague "try again later" that leaves people guessing
  // whether to wait ten seconds or an hour.
  const wait = message.match(/after (\d+)\s*seconds?/i);
  if (wait) {
    const s = Number(wait[1]);
    return s >= 60
      ? `Another code can be sent in about ${Math.ceil(s / 60)} minute${Math.ceil(s / 60) === 1 ? '' : 's'}.`
      : `Another code can be sent in ${s} seconds.`;
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many codes requested in the last hour. Try again a little later.';
  }
  if (m.includes('security purposes')) {
    return 'That was too soon after the last code — wait a moment and try again.';
  }
  // Must precede the generic "invalid" check below: Supabase reports a
  // rejected address as `email_address_invalid`, which would otherwise be
  // reported to the user as a bad *code*.
  if (m.includes('email') && (m.includes('invalid') || m.includes('valid'))) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (m.includes('not found') || m.includes('signups not allowed')) {
    return "No backup found for that address. Check the spelling, or link it on the phone that has your games.";
  }
  if (m.includes('expired')) return 'That code has expired. Request a new one.';
  if (m.includes('invalid') || m.includes('token')) return "That code didn't match. Try again.";
  if (m.includes('already been registered') || m.includes('already registered')) {
    return 'That address is already linked to another backup.';
  }
  // Email delivery isn't configured until a real SMTP provider is set up.
  if (m.includes('error sending') || m.includes('smtp')) {
    return 'Email could not be sent. The backup email service is not configured yet.';
  }
  return message;
}

// --- retained history --------------------------------------------------------

/** How often a routine push also lays down a retained snapshot. */
const VERSION_EVERY_MS = 30 * 60 * 1000;

let lastVersionAt = 0;

export interface BackupVersion {
  id: string;
  games: number;
  deaths: number;
  reason: string;
  createdAt: string;
}

/**
 * Appends a retained snapshot.
 *
 * The live row is overwritten by every push, so without this a single bad
 * write destroys the only copy. Rate limited for routine saves, but `force`
 * bypasses it before anything destructive — the snapshot that matters most is
 * the one taken immediately before an overwrite.
 */
export async function snapshotVersion(
  payload: unknown,
  counts: { games: number; deaths: number },
  reason: string,
  force = false,
): Promise<boolean> {
  const c = db();
  if (!c) return false;
  if (!force && Date.now() - lastVersionAt < VERSION_EVERY_MS) return false;

  const userId = await ensureSession();
  if (!userId) return false;
  try {
    const { error } = await c.from('backup_versions').insert({
      user_id: userId,
      payload,
      game_count: counts.games,
      death_count: counts.deaths,
      app_version: __APP_VERSION__,
      reason,
    });
    if (error) return false;
    lastVersionAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

export async function listVersions(): Promise<BackupVersion[]> {
  const c = db();
  if (!c) return [];
  const userId = await ensureSession();
  if (!userId) return [];
  const { data, error } = await c
    .from('backup_versions')
    .select('id, game_count, death_count, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error || !data) return [];
  return data.map((v) => ({
    id: v.id as string,
    games: v.game_count as number,
    deaths: v.death_count as number,
    reason: v.reason as string,
    createdAt: v.created_at as string,
  }));
}

export async function fetchVersionPayload(id: string): Promise<unknown | null> {
  const c = db();
  if (!c) return null;
  const userId = await ensureSession();
  if (!userId) return null;
  const { data, error } = await c
    .from('backup_versions')
    .select('payload')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.payload;
}

/** Reads back what the server currently holds. Used for verification, not sync. */
export async function fetchBackupSummary(): Promise<{
  updatedAt: string;
  games: number;
  deaths: number;
} | null> {
  const c = db();
  if (!c) return null;
  const userId = await ensureSession();
  if (!userId) return null;
  const { data, error } = await c
    .from('backups')
    .select('updated_at, game_count, death_count')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    updatedAt: data.updated_at as string,
    games: data.game_count as number,
    deaths: data.death_count as number,
  };
}
