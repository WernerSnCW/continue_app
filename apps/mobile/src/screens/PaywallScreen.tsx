import { useState } from 'react';
import { FREE_TIER_GAME_LIMIT } from '@continue/shared';
import { CrownIcon } from '../components/icons';
import {
  isBillingAvailable,
  isMockBilling,
  purchaseUnlock,
  restorePurchases,
  UNLOCK_PRICE,
} from '../lib/billing';
import { playAdvance, playClick } from '../lib/sound';

interface Props {
  onBack: () => void;
  onUnlocked: () => void;
  /** Deaths and runs currently locked behind the unlock, for concrete framing. */
  locked: { games: number; runs: number; deaths: number };
}

const FEATURES: readonly { title: string; body: string }[] = [
  {
    title: 'Unlimited games',
    body: `Track as many as you're playing, not just ${FREE_TIER_GAME_LIMIT}.`,
  },
  {
    title: 'Restore archived history',
    body: 'Every game you swapped out comes back, tallies intact.',
  },
  {
    title: 'NG+ / NG++ run tracking',
    body: "Keep each playthrough's count separate, however deep you go.",
  },
  {
    title: 'Global average',
    body: 'See how your death count compares to everyone else tracking it.',
  },
];

export function PaywallScreen({ onBack, onUnlocked, locked }: Props) {
  const [status, setStatus] = useState<'idle' | 'buying' | 'restoring'>('idle');
  const [error, setError] = useState('');
  const busy = status !== 'idle';

  const buy = async () => {
    playClick();
    setError('');
    setStatus('buying');
    const result = await purchaseUnlock();
    setStatus('idle');
    if (result.ok) {
      playAdvance();
      onUnlocked();
    } else if (result.reason !== 'cancelled') {
      setError(result.message ?? 'Something went wrong. Nothing was charged.');
    }
  };

  const restore = async () => {
    playClick();
    setError('');
    setStatus('restoring');
    const result = await restorePurchases();
    setStatus('idle');
    if (result.ok) {
      onUnlocked();
    } else {
      setError(result.message ?? 'No previous purchase found.');
    }
  };

  return (
    <div className="screen">
      <div className="counter-top">
        <button className="nav-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
      </div>

      <div className="paywall-head">
        <div className="crown-wrap">
          <CrownIcon />
        </div>
        <h3>Unlock everything</h3>
        <p>One tap. No subscription. Yours for good.</p>
      </div>

      {/* Concrete beats abstract: name what they personally get back. */}
      {locked.deaths > 0 && (
        <div className="history-notice">
          <div className="hn-title">Waiting for you</div>
          <p className="hn-body">
            <strong>{locked.deaths} deaths</strong> across {locked.runs} archived run
            {locked.runs === 1 ? '' : 's'}
            {locked.games > 0 && (
              <>
                {' '}
                and {locked.games} swapped-out game{locked.games === 1 ? '' : 's'}
              </>
            )}{' '}
            come straight back.
          </p>
        </div>
      )}

      {FEATURES.map((f) => (
        <div className="feature-row" key={f.title}>
          <div className="dot" />
          <div>
            <p className="t">{f.title}</p>
            <p className="s">{f.body}</p>
          </div>
        </div>
      ))}

      <div className="price-box">
        <div className="p">{UNLOCK_PRICE}</div>
        <div className="s">one-time · not a subscription</div>
      </div>

      {error && <p className="hint hint-error">{error}</p>}

      <button className="primary-btn" onClick={buy} disabled={busy || !isBillingAvailable}>
        {status === 'buying' ? 'Confirming…' : isBillingAvailable ? 'Unlock now' : 'Coming soon'}
      </button>

      <button className="secondary-action" onClick={restore} disabled={busy}>
        {status === 'restoring' ? 'Checking…' : 'Restore a previous purchase'}
      </button>

      <p className="ghost-note">
        Your {FREE_TIER_GAME_LIMIT} free games and their history stay exactly as they are.
        {isMockBilling && (
          <>
            <br />
            <strong className="mock-flag">Test build — simulated purchase, no payment taken.</strong>
          </>
        )}
      </p>
    </div>
  );
}
