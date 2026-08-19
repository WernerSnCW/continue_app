import { clampCycle, MAX_CYCLE, runLabel } from '../lib/store';

interface Props {
  value: number;
  onChange: (cycle: number) => void;
  onStart: () => void;
}

/**
 * Pick an NG+ cycle and start a run at it.
 *
 * Lives in two places on purpose: the run-options sheet, and the run-finished
 * screen. The second is where it earns its keep — being asked "what next?" is
 * exactly when somebody wants to say "I'm actually on NG+7", and having the
 * answer only in a secondary menu made it look as though the app could not do
 * it at all.
 *
 * Every target is at least 44px. The steppers were 28px squares, which is about
 * half Android's minimum and reads as a broken control rather than a near miss.
 * The value is typeable too: stepping to NG+9 was nine accurate taps to enter a
 * number the user already knew.
 */
export function CyclePicker({ value, onChange, onStart }: Props) {
  return (
    <div className="cycle-picker">
      <button
        className="cp-step"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        aria-label="Lower NG+ level"
      >
        −
      </button>

      <label className="cp-field">
        <span className="cp-prefix" aria-hidden="true">
          {value === 0 ? 'NG' : 'NG+'}
        </span>
        <input
          className="cp-input"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_CYCLE}
          // Empty rather than "0" so the field can be cleared and retyped
          // without fighting a character that reappears.
          value={value === 0 ? '' : String(value)}
          placeholder="0"
          aria-label={`NG+ level, currently ${runLabel(value)}`}
          onChange={(e) => onChange(clampCycle(e.target.value))}
        />
      </label>

      <button
        className="cp-step"
        onClick={() => onChange(Math.min(MAX_CYCLE, value + 1))}
        disabled={value >= MAX_CYCLE}
        aria-label="Raise NG+ level"
      >
        +
      </button>
      <button className="cp-go" onClick={onStart}>
        Start {runLabel(value)}
      </button>
    </div>
  );
}
