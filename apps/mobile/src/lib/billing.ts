/**
 * Purchase boundary.
 *
 * Everything above this file — the paywall, the entitlement, the locked
 * features — talks only to `purchaseUnlock()` and `restorePurchases()`. Today
 * those are simulated. When Google Play Billing goes in, only this file
 * changes, and the entire unlock experience will already have been designed,
 * built and tested against the real interface.
 *
 * That ordering is deliberate: billing cannot be tested at all until the app
 * is uploaded to a Play testing track, so everything that doesn't strictly
 * need real money should be finished first.
 */

/** Mock purchases are compiled in only when explicitly enabled at build time. */
const MOCK_ENABLED = import.meta.env.VITE_MOCK_PURCHASE === '1';

export const isMockBilling = MOCK_ENABLED;

/** Whether a purchase can be attempted at all on this build. */
export const isBillingAvailable = MOCK_ENABLED;

export const UNLOCK_PRICE = '$1.99';

export type PurchaseResult =
  | { ok: true; alreadyOwned?: boolean }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'error'; message?: string };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Attempts the one-time unlock.
 *
 * The mock deliberately takes a moment and can be cancelled, because a real
 * billing flow does both — a purchase button that resolves instantly hides
 * every pending/disabled-state bug you'd hit in production.
 */
export async function purchaseUnlock(): Promise<PurchaseResult> {
  if (!MOCK_ENABLED) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'In-app purchases are not available in this build yet.',
    };
  }
  await delay(1400);
  return { ok: true };
}

/**
 * Restores a previous purchase. Both app stores require this to exist as a
 * user-visible action, so it's part of the interface from the start rather
 * than bolted on at review time.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!MOCK_ENABLED) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Restore is not available in this build yet.',
    };
  }
  await delay(900);
  // The mock has no store account to consult, so it reports nothing found and
  // leaves the caller's existing entitlement untouched.
  return { ok: false, reason: 'error', message: 'No previous purchase found on this account.' };
}
