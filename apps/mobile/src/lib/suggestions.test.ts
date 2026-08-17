/**
 * The length bounds exist in two places — here and the CHECK constraint on the
 * suggestions table. These tests pin the client side; if the constraint is ever
 * changed, the numbers in `suggestions.ts` have to move with it or a valid-
 * looking submission fails as a database error the user cannot act on.
 */
import { describe, expect, it } from 'vitest';
import {
  SUGGESTION_MAX,
  SUGGESTION_MIN,
  validateSuggestion,
} from './suggestions';

describe('validateSuggestion', () => {
  it('accepts an ordinary suggestion', () => {
    expect(validateSuggestion('Please add a widget for boss names')).toBe(null);
  });

  it.each([
    ['an empty string', ''],
    ['only spaces', '    '],
    ['only newlines', '\n\n'],
  ])('rejects %s as empty', (_label, input) => {
    expect(validateSuggestion(input)).toBe('empty');
  });

  it('rejects a stray character as too short', () => {
    // Guards against an accidental submit rather than a deliberate one.
    expect(validateSuggestion('ok')).toBe('too-short');
  });

  it('measures length after trimming, not before', () => {
    // Padding must not buy its way past the minimum.
    expect(validateSuggestion(`   ${'a'.repeat(SUGGESTION_MIN - 1)}   `)).toBe('too-short');
    expect(validateSuggestion(`   ${'a'.repeat(SUGGESTION_MIN)}   `)).toBe(null);
  });

  it('accepts exactly the maximum and rejects one more', () => {
    expect(validateSuggestion('a'.repeat(SUGGESTION_MAX))).toBe(null);
    expect(validateSuggestion('a'.repeat(SUGGESTION_MAX + 1))).toBe('too-long');
  });

  it('does not count trailing whitespace toward the maximum', () => {
    // Otherwise a suggestion at the limit fails only because of a trailing
    // newline the user cannot see.
    expect(validateSuggestion('a'.repeat(SUGGESTION_MAX) + '\n\n  ')).toBe(null);
  });
});
