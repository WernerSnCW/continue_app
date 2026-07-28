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

/** Short burst of filtered white noise — the "impact" layer. */
function noiseBurst(c: AudioContext, dest: AudioNode, duration: number, cutoff: number, gain: number) {
  const frames = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying noise: loud at the transient, gone almost immediately.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;

  const g = c.createGain();
  g.gain.value = gain;

  src.connect(filter).connect(g).connect(dest);
  src.start();
  src.stop(c.currentTime + duration);
}

/**
 * The death sound: a struck-bell transient over a sub drop. Meant to land
 * like a hit — weighty and final, not a notification chime.
 */
export function playDeath(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime;
  const out = c.createGain();
  out.gain.value = 0.9;
  out.connect(c.destination);

  noiseBurst(c, out, 0.18, 2200, 0.35);

  // Sub drop — the gut punch.
  const sub = c.createOscillator();
  const subGain = c.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(130, t);
  sub.frequency.exponentialRampToValueAtTime(38, t + 0.42);
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
  subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  sub.connect(subGain).connect(out);
  sub.start(t);
  sub.stop(t + 0.8);

  // Dissonant minor-second ring on top so it reads as ominous, not neutral.
  for (const [freq, level, decay] of [
    [220, 0.16, 0.9],
    [233.1, 0.11, 0.85],
  ] as const) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
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
