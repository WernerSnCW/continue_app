/**
 * Sound effects, synthesised with the Web Audio API rather than shipped as
 * audio files — a few oscillators weigh nothing, need no decoding, and can be
 * tuned in code. Keeps the repo free of binary assets.
 *
 * The AudioContext is created lazily on first play: browsers (and the Android
 * webview) block audio until a user gesture, and every call site here is
 * behind a tap.
 */

const MUTE_KEY = 'continue.muted.v1';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    // Autoplay policy can leave a fresh context suspended until a gesture.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Preference is a nicety; failing to persist it shouldn't throw.
  }
}

/**
 * The death sound: a low, dissonant toll that swells and sinks.
 *
 * Two earlier attempts read as a drum. The cause both times was the attack —
 * a noise transient and a near-instant rise. Percussion is defined by that
 * sharp onset, so no amount of tuning the tail fixes it. This version has no
 * noise layer at all and swells over 90–160ms instead, which puts it in
 * "something is looming" territory rather than "something was hit".
 *
 * The pitch content is deliberately unstable: partials a minor second and a
 * tritone above the root, a barely-detuned unison that beats slowly against
 * itself, and everything sagging in pitch as it decays.
 */
export function playDeath(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime;
  const out = c.createGain();
  out.gain.value = 0.85;
  out.connect(c.destination);

  // Filter closing from 1800Hz down to 600Hz — the sound darkens as it decays,
  // like something receding. Static brightness is what made earlier versions
  // sit there like a hit rather than a presence.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 1.1;
  tone.frequency.setValueAtTime(1800, t);
  tone.frequency.exponentialRampToValueAtTime(600, t + 2.6);
  tone.connect(out);

  const ROOT = 65.41; // C2 — low and hollow.

  // [ratio, level, decay, attack]
  // The 1.06 and 2.83 ratios are deliberately dissonant against the root: a
  // minor second and a tritone. Consonant partials sound like a musical note;
  // these sound wrong, which is the point.
  const VOICES: readonly (readonly [number, number, number, number])[] = [
    [0.5, 0.34, 4.2, 0.14], // sub drone — swells in underneath
    [1.0, 0.30, 3.8, 0.09], // root
    [1.006, 0.22, 3.6, 0.11], // barely detuned: slow beating, unsettled
    [1.06, 0.09, 2.8, 0.16], // minor second — the dread interval
    [2.0, 0.11, 2.4, 0.07],
    [2.83, 0.07, 1.9, 0.12], // tritone
    [4.05, 0.035, 1.2, 0.05],
  ];

  for (const [ratio, level, decay, attack] of VOICES) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(ROOT * ratio, t);
    // Sags downward as it rings out — sinking rather than settling.
    osc.frequency.linearRampToValueAtTime(ROOT * ratio * 0.985, t + decay);
    // Slow swell instead of an instant strike. A fast attack is the single
    // thing that makes any of this read as percussion.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(tone);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  // No noise transient at all — that was the drum.
}

/** Soft UI tick for ordinary taps. Deliberately quiet and short. */
export function playClick(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(430, t + 0.06);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

/** Rising two-note flourish for advancing into the next NG+ cycle. */
export function playAdvance(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime;
  [
    [330, 0],
    [494, 0.11],
  ].forEach(([freq, delay]) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq!;
    const start = t + delay!;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.35);
  });
}
