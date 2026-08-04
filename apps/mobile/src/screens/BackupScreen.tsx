import { useEffect, useState } from 'react';
import {
  completeSignIn,
  confirmEmail,
  fetchBackupPayload,
  getIdentity,
  linkEmail,
  requestSignIn,
  type Identity,
} from '../lib/backup';
import { playClick } from '../lib/sound';

interface Props {
  onBack: () => void;
  /** Applies a restored snapshot over local state. */
  onRestore: (payload: unknown) => void;
  local: { games: number; deaths: number };
}

type Mode = 'overview' | 'link-email' | 'link-code' | 'signin-email' | 'signin-code' | 'restore';

export function BackupScreen({ onBack, onRestore, local }: Props) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [mode, setMode] = useState<Mode>('overview');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof fetchBackupPayload>>>(null);

  useEffect(() => {
    void getIdentity().then(setIdentity);
  }, []);

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, next?: Mode) => {
    playClick();
    setError('');
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      if (next) setMode(next);
    } else {
      setError(r.message ?? 'Something went wrong.');
    }
    return r.ok;
  };

  const refresh = async () => setIdentity(await getIdentity());

  return (
    <div className="screen">
      <div className="counter-top">
        <button className="nav-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Backup
        </h3>
      </div>

      {mode === 'overview' && (
        <>
          <div className="backup-card" style={{ marginTop: 16 }}>
            <div className="bc-label">On this phone</div>
            <div className="bc-value">
              {local.games} game{local.games === 1 ? '' : 's'} · {local.deaths} death
              {local.deaths === 1 ? '' : 's'}
            </div>
          </div>

          {identity?.anonymous === false ? (
            <div className="backup-card ok">
              <div className="bc-label">Recoverable</div>
              <div className="bc-value">{identity.email}</div>
              <p className="bc-note">
                Your tally is backed up and tied to this address. Install the app on a new phone,
                choose <strong>Restore</strong>, and it comes back.
              </p>
            </div>
          ) : (
            <div className="backup-card warn">
              <div className="bc-label">Not recoverable yet</div>
              <p className="bc-note">
                Your games are saved to the cloud, but they're tied to this installation. If you
                uninstall the app or lose the phone, there's no way to prove the backup is yours.
                Adding an email fixes that — it's only used to get your tally back.
              </p>
            </div>
          )}

          {notice && <p className="hint">{notice}</p>}

          {identity?.anonymous !== false && (
            <button className="primary-btn" onClick={() => setMode('link-email')}>
              Add an email to protect my tally
            </button>
          )}

          {/* "from another phone" quietly excluded the commonest case — same
              phone, app reinstalled — so people reinstalling didn't recognise
              this as the thing they needed. */}
          <button
            className="text-btn wide"
            style={{ marginTop: 10 }}
            onClick={() => setMode('signin-email')}
          >
            Restore a backup
          </button>
          <p className="restore-hint">
            Reinstalled the app, got a new phone, or wiped your games by accident? Sign in with the
            email you linked and pull your tally back.
          </p>

          <p className="ghost-note" style={{ marginTop: 'auto' }}>
            No password, no account. The email is only ever used to send a sign-in code.
          </p>
        </>
      )}

      {(mode === 'link-email' || mode === 'signin-email') && (
        <>
          <p className="archive-note" style={{ marginTop: 16 }}>
            {mode === 'link-email'
              ? "We'll send a 6-digit code to confirm the address is yours."
              : 'Enter the email you linked to this tally, and we’ll send a 6-digit code.'}
          </p>
          <div className="field-label">Email</div>
          <input
            className="search-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p className="hint hint-error">{error}</p>}
          <div className="spacer" />
          <button
            className="primary-btn"
            disabled={busy || !email.includes('@')}
            onClick={() =>
              run(
                () => (mode === 'link-email' ? linkEmail(email) : requestSignIn(email)),
                mode === 'link-email' ? 'link-code' : 'signin-code',
              )
            }
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <button className="swap-link" onClick={() => setMode('overview')}>
            Cancel
          </button>
        </>
      )}

      {(mode === 'link-code' || mode === 'signin-code') && (
        <>
          <p className="archive-note" style={{ marginTop: 16 }}>
            Enter the 6-digit code sent to <strong>{email}</strong>.
          </p>
          <div className="field-label">Code</div>
          <input
            className="search-input code-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            placeholder="123456"
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <p className="hint hint-error">{error}</p>}
          <div className="spacer" />
          <button
            className="primary-btn"
            disabled={busy || code.trim().length < 6}
            onClick={async () => {
              if (mode === 'link-code') {
                const ok = await run(() => confirmEmail(email, code));
                if (ok) {
                  await refresh();
                  setNotice('Email confirmed. Your tally can now be restored on another phone.');
                  setMode('overview');
                  setCode('');
                }
              } else {
                const ok = await run(() => completeSignIn(email, code));
                if (ok) {
                  const backup = await fetchBackupPayload();
                  await refresh();
                  setCode('');
                  if (!backup) {
                    setNotice('Signed in, but there was no backup on that account.');
                    setMode('overview');
                  } else {
                    setFound(backup);
                    setMode('restore');
                  }
                }
              }
            }}
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <button className="swap-link" onClick={() => setMode('overview')}>
            Cancel
          </button>
        </>
      )}

      {mode === 'restore' && found && (
        <>
          <div className="backup-card ok" style={{ marginTop: 16 }}>
            <div className="bc-label">Backup found</div>
            <div className="bc-value">
              {found.games} game{found.games === 1 ? '' : 's'} · {found.deaths} death
              {found.deaths === 1 ? '' : 's'}
            </div>
            <p className="bc-note">Saved {new Date(found.updatedAt).toLocaleString()}</p>
          </div>

          {/* Restoring replaces what's here. Say so plainly, with the numbers,
              rather than letting someone find out afterwards. */}
          <div className="backup-card warn">
            <div className="bc-label">This phone will be replaced</div>
            <p className="bc-note">
              The {local.games} game{local.games === 1 ? '' : 's'} and {local.deaths} death
              {local.deaths === 1 ? '' : 's'} currently on this phone will be overwritten by the
              backup above. This can't be undone.
            </p>
          </div>

          <div className="spacer" />
          <button
            className="primary-btn"
            onClick={() => {
              playClick();
              onRestore(found.payload);
            }}
          >
            Restore this backup
          </button>
          <button className="swap-link" onClick={() => setMode('overview')}>
            Keep what's on this phone
          </button>
        </>
      )}
    </div>
  );
}
