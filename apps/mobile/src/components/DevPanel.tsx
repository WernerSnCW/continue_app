import { useState } from 'react';

interface Props {
  unlimited: boolean;
  onToggleUnlimited: () => void;
  archivedCount: number;
  onReset: () => void;
}

/**
 * Dev-only entitlement switch. Gated on `import.meta.env.DEV`, so it is tree-
 * shaken out of production builds entirely — it is not a hidden user-facing
 * feature, it's a stand-in for real billing while the store flow doesn't
 * exist. Flipping it grants unlimited games, restores archived games, and
 * unlocks the NG++ segment.
 */
export function DevPanel({ unlimited, onToggleUnlimited, archivedCount, onReset }: Props) {
  const [open, setOpen] = useState(false);

  if (!import.meta.env.DEV) return null;

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
