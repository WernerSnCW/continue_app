/**
 * igdb-token — hands back a valid IGDB bearer token.
 *
 * Callers get a token without knowing anything about Twitch's
 * client_credentials flow; the exchange and the ~60 day cache live behind
 * this. Requires a valid Supabase JWT (verify_jwt is on in config.toml).
 *
 *   POST /functions/v1/igdb-token
 *   -> { "accessToken": "...", "expiresIn": 5184000, "tokenType": "bearer" }
 *
 * Note: this returns an app-level token scoped to our Twitch client, so any
 * caller holding it can spend our IGDB rate limit. Prefer calling igdb-search,
 * which uses the token server-side and never exposes it.
 */
import { getIgdbToken, IgdbError, jsonResponse, serviceClient } from '../_shared/igdb.ts';

Deno.serve(async () => {
  try {
    const client = serviceClient();
    const accessToken = await getIgdbToken(client);

    const { data } = await client
      .from('igdb_token_cache')
      .select('expires_at')
      .eq('id', 1)
      .maybeSingle();

    const expiresIn = data?.expires_at
      ? Math.max(0, Math.floor((new Date(data.expires_at as string).getTime() - Date.now()) / 1000))
      : 0;

    return jsonResponse({ accessToken, expiresIn, tokenType: 'bearer' });
  } catch (err) {
    const status = err instanceof IgdbError ? err.status : 500;
    console.error('igdb-token failed:', err);
    return jsonResponse({ error: (err as Error).message }, status);
  }
});
