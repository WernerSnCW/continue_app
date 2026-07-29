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

// --- reverb ----------------------------------------------------------------

let impulse: AudioBuffer | null = null;

/**
 * Builds a cathedral-ish impulse response: exponentially decaying noise,
 * lowpassed so the tail darkens as it fades the way a real stone space does.
 *
 * This is the piece every earlier version was missing. A dry oscillator has no
 * space around it, and anything without space reads as a close-mic'd hit — a
 * drum. Reverb is most of what makes a sting sound cinematic rather than
 * synthetic, and it costs nothing to generate at runtime.
 */
function impulseResponse(c: AudioContext, seconds = 3.6, decay = 1.9): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(2, len, c.sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // One-pole lowpass state, per channel. Slightly different coefficients so
    // the two sides decorrelate and the tail sounds wide rather than centred.
    let lp = 0;
    const coeff = ch === 0 ? 0.20 : 0.24;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * coeff;
      data[i] = lp * env;
    }
  }
  return buf;
}

let bus: GainNode | null = null;

/**
 * Shared wet/dry reverb send. Returns the node to feed audio into.
 *
 * Built once and reused: a convolver with a 3.6s impulse is not cheap, and
 * this is a death counter — people tap it repeatedly. Creating one per tap
 * would stack live convolutions on a phone CPU.
 *
 * Pre-delay keeps the onset clear of its own reflections, which is what makes
 * a space read as large rather than just blurry.
 */
function reverbBus(c: AudioContext, wet: number): GainNode {
  if (bus) return bus;

  const input = c.createGain();

  const dry = c.createGain();
  dry.gain.value = 1 - wet;
  input.connect(dry).connect(c.destination);

  impulse ??= impulseResponse(c);
  const convolver = c.createConvolver();
  convolver.buffer = impulse;
  // Energy-normalised, so the wet level is predictable regardless of how long
  // the tail is. Overall loudness is set once at the source instead.
  convolver.normalize = true;

  const preDelay = c.createDelay(0.5);
  preDelay.delayTime.value = 0.045;

  const wetGain = c.createGain();
  wetGain.gain.value = wet;

  input.connect(preDelay).connect(convolver).connect(wetGain).connect(c.destination);

  bus = input;
  return bus;
}

// --- chiptune ---------------------------------------------------------------

/**
 * Builds an NES-style pulse wave.
 *
 * Web Audio's built-in 'square' is a fixed 50% duty cycle, which was only one
 * of the timbres the NES could produce — its pulse channels also did 12.5% and
 * 25%, and those thinner, more nasal tones are a big part of why chiptune
 * sounds like chiptune. The Fourier coefficients of a pulse of duty d are
 * (2/nπ)·sin(nπd), so the wave can be built exactly rather than approximated.
 */
function pulseWave(c: AudioContext, duty: number, harmonics = 28): PeriodicWave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return c.createPeriodicWave(real, imag);
}

const waveCache = new Map<number, PeriodicWave>();
function cachedPulse(c: AudioContext, duty: number): PeriodicWave {
  let w = waveCache.get(duty);
  if (!w) {
    w = pulseWave(c, duty);
    waveCache.set(duty, w);
  }
  return w;
}

/**
 * One chip-style note: hard on, flat sustain, hard off.
 *
 * No smooth ramps anywhere. 8-bit envelopes were stepped values written to a
 * register, and that abruptness is most of the character — exponential curves
 * immediately make it sound like a modern synth instead.
 */
function chipNote(
  c: AudioContext,
  dest: AudioNode,
  opts: {
    freq: number;
    start: number;
    duration: number;
    duty?: number;
    level?: number;
    /** Target frequency at the end of the note, for the power-down slide. */
    bendTo?: number;
    vibrato?: boolean;
  },
): void {
  const { freq, start, duration, duty = 0.5, level = 0.18, bendTo, vibrato } = opts;

  const osc = c.createOscillator();
  osc.setPeriodicWave(cachedPulse(c, duty));
  osc.frequency.setValueAtTime(freq, start);

  if (bendTo) {
    // Stepped rather than glided: real chips retuned in discrete register
    // writes, which is why old hardware slides sound like a staircase.
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      osc.frequency.setValueAtTime(
        freq + (bendTo - freq) * (i / steps),
        start + (duration * i) / steps,
      );
    }
  }

  if (vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 11;
    depth.gain.value = freq * 0.012;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + duration);
  }

  const g = c.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.setValueAtTime(level, start + 0.004);
  g.gain.setValueAtTime(level, start + duration - 0.02);
  g.gain.linearRampToValueAtTime(0, start + duration);

  osc.connect(g).connect(dest);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/**
 * The death sound: a classic 8-bit game-over jingle.
 *
 * Four earlier attempts chased "ominous" and kept landing on percussion. This
 * is a different and far more defined brief: a short descending run in a minor
 * key on pulse waves, triangle bass underneath, ending on a held note that
 * bends an octave down like the power draining out.
 */
export function playDeath(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime + 0.01;
  const out = c.createGain();
  out.gain.value = 1.15;
  // Only a hint of room so it isn't harsh through a phone speaker. Chiptune
  // went from a sound chip straight to a TV — a big tail fights the whole idea.
  out.connect(reverbBus(c, 0.12));

  const STEP = 0.105; // tempo of the descending run

  // Descent in A minor: C5, B4, A4, G#4. Falling pitch is the entire
  // game-over trope, and the semitone at the end tightens it.
  const RUN: readonly (readonly [number, number])[] = [
    [523.25, 0], // C5
    [493.88, 1], // B4
    [440.0, 2], // A4
    [415.3, 3], // G#4
  ];

  for (const [freq, i] of RUN) {
    chipNote(c, out, {
      freq,
      start: t + i * STEP,
      duration: STEP * 0.92,
      duty: 0.5,
      level: 0.24,
    });
  }

  // The landing: held, thinner, wobbling, and sagging an octave — the sound
  // of the power draining out.
  const landing = t + RUN.length * STEP;
  chipNote(c, out, {
    freq: 392.0, // G4
    start: landing,
    duration: 0.62,
    duty: 0.25,
    level: 0.26,
    bendTo: 196.0,
    vibrato: true,
  });

  // Triangle-channel bass, the way the NES handled its low end.
  const BASS: readonly (readonly [number, number, number])[] = [
    [130.81, 0, STEP * 2], // C3
    [110.0, STEP * 2, STEP * 2], // A2
    [98.0, STEP * 4, 0.62], // G2, under the landing
  ];
  for (const [freq, offset, dur] of BASS) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t + offset);
    g.gain.setValueAtTime(0, t + offset);
    g.gain.setValueAtTime(0.12, t + offset + 0.004);
    g.gain.setValueAtTime(0.12, t + offset + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + offset + dur);
    osc.connect(g).connect(out);
    osc.start(t + offset);
    osc.stop(t + offset + dur + 0.02);
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
