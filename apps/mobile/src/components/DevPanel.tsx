import { useState } from 'react';
import { isMockBilling } from '../lib/billing';

interface Props {
  unlimited: boolean;
  onToggleUnlimited: () => void;
  archivedCount: number;
  onReset: () => void;
}

/**
 * Entitlement switch for builds where billing is mocked. Flipping it grants
 * unlimited games, restores archived games, and unlocks the NG++ segment.
 *
 * Shown when running the dev server, or in a build made with
 * `pnpm build:testing`. Both are gated on the same thing that decides whether
 * a purchase can happen at all, so this panel and the mocked purchase appear
 * and disappear together — a build that can fake a purchase can also undo one.
 *
 * `.env.production` pins the mock off, so a release build satisfies neither
 * condition and this is tree-shaken out entirely. It is not a hidden
 * user-facing feature; it is a stand-in for a store flow that cannot run
 * outside Play.
 */
export function DevPanel({ unlimited, onToggleUnlimited, archivedCount, onReset }: Props) {
  const [open, setOpen] = useState(false);

  if (!import.meta.env.DEV && !isMockBilling) return null;

  return (
    <>
      {open && (
        <div className="dev-panel">
          <h4>Dev — mocked billing</h4>
          <div className="dev-row">
            <span>Paid unlock</span>
            <button
              className={`dev-toggle${unlimited ? ' on' : ''}`}
              onClick={onToggleUnlimited}
              data-testid="dev-toggle-paid"
            >
              {unlimited ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="dev-row">
            <span>Archived</span>
            <span style={{ color: 'var(--text-faint)' }}>{archivedCount}</span>
          </div>
          <div className="dev-row">
            <button className="dev-toggle" onClick={onReset}>
              Reset all data
            </button>
          </div>
        </div>
      )}
      <button className="dev-fab" onClick={() => setOpen((o) => !o)} data-testid="dev-fab">
        DEV
      </button>
    </>
  );
}
