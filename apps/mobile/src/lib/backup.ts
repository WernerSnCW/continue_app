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
