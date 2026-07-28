/**
 * IGDB access: token caching + authenticated queries.
 *
 * Callers use `getIgdbToken()` / `igdbQuery()` and never touch the Twitch
 * exchange themselves.
 *
 * Credentials come from Supabase secrets, never from committed files:
 *   supabase secrets set TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=...
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_BASE = 'https://api.igdb.com/v4';

/**
 * Refresh this far before actual expiry so a token can't lapse mid-request.
 * Tokens last ~60 days, so a day of slack costs nothing.
 */
const EXPIRY_MARGIN_MS = 24 * 60 * 60 * 1000;

export class IgdbError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'IgdbError';
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new IgdbError(`Missing required secret: ${name}`, 500);
  return value;
}

export function serviceClient(): SupabaseClient {
  // Both are injected into the edge runtime automatically.
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

/** Performs the Twitch client_credentials exchange. */
async function exchangeToken(): Promise<{ accessToken: string; expiresAt: Date }> {
  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', requireEnv('TWITCH_CLIENT_ID'));
  url.searchParams.set('client_secret', requireEnv('TWITCH_CLIENT_SECRET'));
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new IgdbError(`Twitch token exchange failed (HTTP ${res.status})`, 502);
  }
  const body = await res.json();
  return {
    accessToken: body.access_token as string,
    expiresAt: new Date(Date.now() + (body.expires_in as number) * 1000),
  };
}

/**
 * Returns a valid IGDB bearer token, exchanging only when the cached one is
 * missing or within the expiry margin.
 */
export async function getIgdbToken(client: SupabaseClient = serviceClient()): Promise<string> {
  const { data, error } = await client
    .from('igdb_token_cache')
    .select('access_token, expires_at')
    .eq('id', 1)
    .maybeSingle();

  // A read failure shouldn't take the API down — fall through to an exchange.
  if (!error && data) {
    const expiresAt = new Date(data.expires_at as string).getTime();
    if (expiresAt - Date.now() > EXPIRY_MARGIN_MS) return data.access_token as string;
  }

  const fresh = await exchangeToken();

  const { error: writeError } = await client.from('igdb_token_cache').upsert(
    {
      id: 1,
      access_token: fresh.accessToken,
      expires_at: fresh.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  // Cache write failure is non-fatal; the token in hand is still good.
  if (writeError) console.error('igdb_token_cache upsert failed:', writeError.message);

  return fresh.accessToken;
}

/** Runs an Apicalypse query against IGDB with a cached token. */
export async function igdbQuery<T = unknown>(
  endpoint: string,
  body: string,
  client?: SupabaseClient,
): Promise<T[]> {
  const token = await getIgdbToken(client);
  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': requireEnv('TWITCH_CLIENT_ID'),
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) {
    throw new IgdbError(`IGDB ${endpoint} query failed (HTTP ${res.status})`, 502);
  }
  return (await res.json()) as T[];
}

export const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
