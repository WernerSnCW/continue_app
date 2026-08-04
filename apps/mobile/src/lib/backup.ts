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

/** Signs in anonymously if there's no session yet. Returns the user id. */
export async function ensureSession(): Promise<string | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    if (data.session?.user) return data.session.user.id;
    const { data: created, error } = await c.auth.signInAnonymously();
    if (error) return null;
    return created.user?.id ?? null;
  } catch {
    return null; // offline, most likely
  }
}

/**
 * Pushes a snapshot. Returns false on any failure — callers treat backup as
 * best-effort and never surface it as something the user must fix mid-run.
 */
export async function pushBackup(
  payload: unknown,
  counts: { games: number; deaths: number },
): Promise<{ ok: boolean; at?: number; message?: string }> {
  const c = db();
  if (!c) return { ok: false, message: 'Backup is not configured.' };

  const userId = await ensureSession();
  if (!userId) return { ok: false, message: 'Could not reach the backup service.' };

  try {
    const { error } = await c.from('backups').upsert(
      {
        user_id: userId,
        payload,
        game_count: counts.games,
        death_count: counts.deaths,
        app_version: __APP_VERSION__,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) return { ok: false, message: error.message };
    return { ok: true, at: Date.now() };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// --- identity ---------------------------------------------------------------

export interface Identity {
  userId: string | null;
  email: string | null;
  /** True while the account is still anonymous — i.e. not recoverable. */
  anonymous: boolean;
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
  const { error } = await c.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email_change',
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
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
  const { error } = await c.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message) };
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
