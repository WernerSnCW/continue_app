/**
 * Feature suggestions.
 *
 * Fire and forget: the suggestion is written and nothing is read back. There is
 * no inbox to check and no reply — that is stated on the screen rather than
 * implied, because a feedback form that looks like a support channel and isn't
 * is worse than no form at all.
 */
import { db, ensureSession, isBackupConfigured, isOptedOut } from './backup';

/** Matches the CHECK constraint on the table; keep the two in step. */
export const SUGGESTION_MIN = 4;
export const SUGGESTION_MAX = 2000;

export type SuggestionProblem = 'empty' | 'too-short' | 'too-long';

/**
 * Validates before a round trip, so a mistyped submission fails instantly
 * rather than as a database error the user cannot act on. Pure, and the reason
 * the length bounds are worth testing: they have to agree with the constraint.
 */
export function validateSuggestion(text: string): SuggestionProblem | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length < SUGGESTION_MIN) return 'too-short';
  if (trimmed.length > SUGGESTION_MAX) return 'too-long';
  return null;
}

export type SubmitResult = { ok: true } | { ok: false; message: string };

export async function submitSuggestion(text: string): Promise<SubmitResult> {
  if (!isBackupConfigured) {
    return { ok: false, message: 'Suggestions need a connection, and this build has none set up.' };
  }
  if (validateSuggestion(text) !== null) {
    return { ok: false, message: 'Write a little more and try again.' };
  }
  // Somebody who deleted their account has asked us to stop holding anything
  // for them. Sending this would mint a replacement account behind their back,
  // so point them at email instead of quietly undoing their decision.
  if (isOptedOut()) {
    return {
      ok: false,
      message: 'You deleted your account, so this would create a new one. Email contact@quietfoundry.io instead.',
    };
  }

  const c = db();
  const userId = await ensureSession();
  if (!c || !userId) {
    return { ok: false, message: 'Could not reach the server. Nothing was sent.' };
  }

  // No .select(): there is no read policy on this table, and asking for the row
  // back would fail on a write that actually succeeded.
  const { error } = await c.from('suggestions').insert({
    user_id: userId,
    body: text.trim(),
    app_version: __APP_VERSION__,
  });

  if (error) {
    // The rate-limit trigger raises, and its message is aimed at a developer.
    if (/24 hours/i.test(error.message)) {
      return { ok: false, message: "That's plenty for one day — try again tomorrow." };
    }
    return { ok: false, message: 'Could not send that. Nothing was saved.' };
  }
  return { ok: true };
}
