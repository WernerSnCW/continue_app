/**
 * delete-account — permanently removes the caller's account and all their data.
 *
 *   POST /functions/v1/delete-account   (Authorization: Bearer <user JWT>)
 *   -> { "deleted": true }
 *
 * Required by Google Play's User Data policy: an app that lets people create an
 * account must let them delete it from inside the app.
 *
 * This has to be a function rather than a client call for two reasons. Deleting
 * an `auth.users` row needs the service role, which must never reach a phone.
 * And `backup_versions` deliberately has no delete policy — the client can
 * append history and read it, never rewrite or erase it — so the client could
 * not clear its own history even if it tried.
 *
 * Both `backups` and `backup_versions` reference `auth.users (id) on delete
 * cascade`, so removing the user removes everything they own in one statement.
 * The explicit deletes below are belt and braces: if a future table forgets its
 * cascade, this function is the place that notices.
 */
import { corsHeaders, handlePreflight, jsonResponse, serviceClient } from '../_shared/igdb.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST.' }, 405);
  }

  // The caller proves who they are with their own access token. Nothing in the
  // body is trusted — a user id parameter here would let anyone delete anyone.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return jsonResponse({ error: 'Missing Authorization header.' }, 401);
  }

  try {
    const admin = serviceClient();

    const { data, error: whoErr } = await admin.auth.getUser(token);
    const user = data?.user;
    if (whoErr || !user) {
      return jsonResponse({ error: 'That session is not valid.' }, 401);
    }

    // Ordered child-first so a failure leaves the account intact and
    // retryable, rather than an orphaned user with unreachable rows.
    const { error: versionsErr } = await admin
      .from('backup_versions')
      .delete()
      .eq('user_id', user.id);
    if (versionsErr) throw new Error(`backup_versions: ${versionsErr.message}`);

    const { error: backupErr } = await admin.from('backups').delete().eq('user_id', user.id);
    if (backupErr) throw new Error(`backups: ${backupErr.message}`);

    // Suggestions go too. They are user-submitted content tied to the account,
    // and the deletion page promises everything held for them is removed —
    // keeping the text with a nulled user_id would quietly make that untrue.
    const { error: suggestionsErr } = await admin
      .from('suggestions')
      .delete()
      .eq('user_id', user.id);
    if (suggestionsErr) throw new Error(`suggestions: ${suggestionsErr.message}`);

    const { error: userErr } = await admin.auth.admin.deleteUser(user.id);
    if (userErr) throw new Error(`auth user: ${userErr.message}`);

    return jsonResponse({ deleted: true });
  } catch (err) {
    // Deliberately not echoing the caller's id or token back in the message.
    console.error('delete-account failed:', err);
    return new Response(
      JSON.stringify({ error: 'Could not delete the account. Nothing has been removed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
