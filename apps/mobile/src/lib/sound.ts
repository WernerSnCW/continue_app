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

/**
 * The death sound: a sustained dissonant drone — a horror sting, not a hit.
 *
 * Three earlier attempts all read as a drum, and the reason was structural,
 * not a matter of tuning: a low SINE with a DECAY envelope is the textbook
 * recipe for synthesising a kick drum. Swapping partials and slowing the
 * attack couldn't fix that, because the underlying material was still
 * percussive.
 *
 * What separates a drone from a drum is sustain. A drum has none — it decays
 * from the moment it starts. So this holds at full level for most of a second
 * before releasing, and uses sawtooth oscillators through a moving filter,
 * which gives the harmonic density of bowed strings or massed voices rather
 * than the pure, hollow tone of a struck membrane.
 */
export function playDeath(): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;

  const t = c.currentTime;
  const ATTACK = 0.2;
  const HOLD = 0.6; // the plateau — this is what a drum can never have
  const RELEASE = 1.2;
  const END = ATTACK + HOLD + RELEASE;

  // Heavily wet: the reverb tail is the point. The dry signal is just the
  // thing that excites the space.
  // Normalised convolution costs a lot of level, so the source is driven hard
  // and the wet/dry split brings it back to a sensible output.
  const out = c.createGain();
  out.gain.value = 2.6;
  out.connect(reverbBus(c, 0.62));

  // Filter opens as it swells then closes as it dies, so the timbre moves
  // through the sound instead of just fading.
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 3.2;
  filter.frequency.setValueAtTime(260, t);
  filter.frequency.linearRampToValueAtTime(1150, t + ATTACK + 0.15);
  filter.frequency.exponentialRampToValueAtTime(240, t + END);
  filter.connect(out);

  // Shared swell-hold-release shape.
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(1, t + ATTACK);
  env.gain.setValueAtTime(1, t + ATTACK + HOLD);
  env.gain.exponentialRampToValueAtTime(0.0001, t + END);
  env.connect(filter);

  // Slow tremolo — an unsteady, breathing quality.
  const lfo = c.createOscillator();
  const lfoDepth = c.createGain();
  lfo.frequency.value = 4.7;
  lfoDepth.gain.value = 0.16;
  lfo.connect(lfoDepth).connect(env.gain);
  lfo.start(t);
  lfo.stop(t + END);

  // A2, plus a minor second and a tritone above it. Both intervals are
  // classic dread — they refuse to resolve.
  const CLUSTER = [110, 116.54, 155.56];

  for (const freq of CLUSTER) {
    // Two detuned saws per note: the beating between them is what makes a
    // synth cluster sound uneasy rather than clean.
    for (const cents of [-7, +7]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sawtooth';
      const f = freq * Math.pow(2, cents / 1200);
      osc.frequency.setValueAtTime(f, t);
      // Sinks a whole tone over its life — the floor giving way.
      osc.frequency.linearRampToValueAtTime(f * 0.945, t + END);
      g.gain.value = 0.09;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + END + 0.05);
    }
  }

  // Sustained filtered noise for air. Sustained, not a burst — a burst is a
  // transient, and transients are what made this sound like a drum.
  const frames = Math.floor(c.sampleRate * END);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const nf = c.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 520;
  nf.Q.value = 0.8;
  const ng = c.createGain();
  ng.gain.value = 0.05;
  noise.connect(nf).connect(ng).connect(env);
  noise.start(t);
  noise.stop(t + END);
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
