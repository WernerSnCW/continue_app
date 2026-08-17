import { useState } from 'react';
import { playClick } from '../lib/sound';
import { SUGGESTION_MAX, submitSuggestion, validateSuggestion } from '../lib/suggestions';

interface Props {
  onBack: () => void;
}

/**
 * Send a suggestion. One way, and honest about it.
 *
 * The copy sets expectations rather than softening them: read by a human, no
 * promises, no reply. A form that reads like a support channel and isn't one
 * generates a worse feeling than having no form, because the disappointment
 * arrives later and feels like being ignored.
 */
export function SuggestScreen({ onBack }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const problem = validateSuggestion(text);
  const remaining = SUGGESTION_MAX - text.trim().length;

  const send = async () => {
    playClick();
    setBusy(true);
    setError('');
    const r = await submitSuggestion(text);
    setBusy(false);
    if (r.ok) {
      setSent(true);
      setText('');
    } else {
      setError(r.message);
    }
  };

  return (
    <div className="screen">
      <div className="counter-top">
        <button
          className="nav-btn"
          onClick={() => {
            playClick();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          Suggest something
        </h3>
      </div>

      {sent ? (
        <>
          <div className="backup-card ok" style={{ marginTop: 16 }}>
            <div className="bc-label">Sent</div>
            <p className="bc-note">
              It's in. No reply is coming — that's not a brush-off, there's just no inbox on your
              side of this. It gets read.
            </p>
          </div>
          <div className="spacer" />
          <button
            className="text-btn wide"
            onClick={() => {
              playClick();
              setSent(false);
            }}
          >
            Send another
          </button>
          <button className="secondary-action" onClick={onBack}>
            Done
          </button>
        </>
      ) : (
        <>
          <p className="archive-note" style={{ marginTop: 16 }}>
            Missing something, or is something annoying you? Say so. It goes straight to the person
            who builds this, gets read, and might well get built — no promises either way, and
            there's no reply.
          </p>

          <textarea
            className="suggest-input"
            value={text}
            maxLength={SUGGESTION_MAX + 200}
            rows={7}
            placeholder="A widget on the home screen. Boss names against each death. Dark mode that's even darker."
            onChange={(e) => setText(e.target.value)}
          />
          {/* Only once it's close to mattering — a counter from the first
              keystroke reads as a limit to fight rather than a guide. */}
          {remaining < 200 && (
            <p className={`suggest-count${remaining < 0 ? ' over' : ''}`}>
              {remaining < 0 ? `${-remaining} over the limit` : `${remaining} left`}
            </p>
          )}

          {error && <p className="hint hint-error">{error}</p>}

          <div className="spacer" />
          <button className="primary-btn" disabled={busy || problem !== null} onClick={send}>
            {busy ? 'Sending…' : 'Send it'}
          </button>
          <p className="ghost-note" style={{ marginTop: 12 }}>
            No email address is collected, so nothing here can be replied to. Want an answer? Write
            to contact@quietfoundry.io instead.
          </p>
        </>
      )}
    </div>
  );
}
