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
 * The death sound: a struck funeral bell.
 *
 * An earlier version layered a noise transient over a fast pitch-drop, which
 * read as a drum hit — percussive and generic. A bell is the right instrument
 * here: bells are *inharmonic*, meaning their partials aren't whole-number
 * multiples of the fundamental, which is exactly what makes them sound like
 * struck metal rather than a tuned note. The ratios below are close to a real
 * bell's hum/prime/tierce/quint/nominal, with the tierce a minor third so the
 * whole thing rings minor.
 *
 * Higher partials decay fastest, as they do on real metal — that's what gives
 * the long, hollow tail instead of a uniform fade.
 */
export function playDeath(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime;
  const out = c.createGain();
  out.gain.value = 0.85;
  out.connect(c.destination);

  // Gentle high-cut so the strike never turns brittle on phone speakers.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5200;
  tone.Q.value = 0.4;
  tone.connect(out);

  const FUNDAMENTAL = 98; // low G — heavy without being muddy on a phone.

  // [ratio, level, decay seconds]
  const PARTIALS: readonly (readonly [number, number, number])[] = [
    [0.5, 0.30, 3.4], // hum tone — the weight underneath
    [1.0, 0.26, 2.9], // prime
    [1.19, 0.10, 2.2], // slight detune against the prime; produces slow beating
    [2.4, 0.14, 1.7], // tierce (minor) — the mournful colour
    [3.0, 0.09, 1.2], // quint
    [4.2, 0.06, 0.8], // nominal — mostly gone by the time you notice it
    [5.4, 0.035, 0.5], // strike shimmer
  ];

  for (const [ratio, level, decay] of PARTIALS) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = FUNDAMENTAL * ratio;
    // Bells sag very slightly in pitch as they ring down.
    osc.frequency.linearRampToValueAtTime(FUNDAMENTAL * ratio * 0.995, t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(tone);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  // A whisper of noise for the clapper contact — far quieter and shorter than
  // before, so it reads as "metal struck" rather than "drum".
  noiseBurst(c, tone, 0.05, 3400, 0.10);
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
