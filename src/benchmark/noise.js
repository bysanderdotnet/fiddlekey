/**
 * Deterministic background-noise generator for the benchmark.
 * Simulates the acoustic environment of a real fiddle jam session (pub/hall):
 * crowd babble + foot taps on the beat + occasional glass clinks.
 * All randomness comes from a seeded PRNG so runs are reproducible.
 */

/** mulberry32 — tiny seeded PRNG, returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash so per-tune seeds don't depend on selection order. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Paul Kellet pink-noise filter state stepper.
function makePinkNoise(rng) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return function () {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return pink * 0.11;
  };
}

// Crowd babble: a few pink-noise "voices", each amplitude-modulated at a
// syllabic rate (~3–5 Hz) with a slower conversational swell. Pink noise
// already approximates the long-term speech spectrum.
function addBabble(out, sampleRate, rng) {
  const VOICES = 4;
  for (let v = 0; v < VOICES; v++) {
    const pink = makePinkNoise(rng);
    const syllabicHz = 3 + rng() * 2;
    const syllabicPhase = rng() * 2 * Math.PI;
    const swellHz = 0.08 + rng() * 0.12;
    const swellPhase = rng() * 2 * Math.PI;
    for (let s = 0; s < out.length; s++) {
      const t = s / sampleRate;
      const syllabic = 0.55 + 0.45 * Math.sin(2 * Math.PI * syllabicHz * t + syllabicPhase);
      const swell = 0.7 + 0.3 * Math.sin(2 * Math.PI * swellHz * t + swellPhase);
      out[s] += pink() * syllabic * swell;
    }
  }
}

// Foot taps: sessions keep time with feet — low thumps roughly on the beat
// (~120 bpm) with slight human jitter.
function addFootTaps(out, sampleRate, rng, level = 0.5) {
  const TAP_HZ = 75;
  const TAP_DECAY = 0.03;
  const tapLen = Math.floor(0.08 * sampleRate);
  let t = 0.2 + rng() * 0.3;
  const durationSec = out.length / sampleRate;
  while (t < durationSec) {
    const start = Math.floor(t * sampleRate);
    const amp = level * (0.7 + 0.3 * rng());
    for (let s = 0; s < tapLen && start + s < out.length; s++) {
      const tau = s / sampleRate;
      out[start + s] += amp * Math.exp(-tau / TAP_DECAY) * Math.sin(2 * Math.PI * TAP_HZ * tau);
    }
    t += 0.5 * (0.92 + 0.16 * rng()); // ~120 bpm with jitter
  }
}

// Glass/cup clinks: sparse short high-frequency resonant pings.
function addClinks(out, sampleRate, rng, level = 0.6) {
  const clinkLen = Math.floor(0.07 * sampleRate);
  let t = 1 + rng() * 3;
  const durationSec = out.length / sampleRate;
  while (t < durationSec) {
    const start = Math.floor(t * sampleRate);
    const freq = 2400 + rng() * 2600;
    const amp = level * (0.5 + 0.5 * rng());
    for (let s = 0; s < clinkLen && start + s < out.length; s++) {
      const tau = s / sampleRate;
      out[start + s] += amp * Math.exp(-tau / 0.02) * Math.sin(2 * Math.PI * freq * tau);
    }
    t += 2 + rng() * 6;
  }
}

/**
 * Generates a noise buffer of the given type.
 * - 'session': pub babble + foot taps + glass clinks (typical jam ambience)
 * - 'babble':  crowd chatter only
 * - 'white':   uniform white noise (worst-case broadband)
 * @returns {Float32Array}
 */
export function generateNoise(type, numSamples, sampleRate, seed) {
  const out = new Float32Array(numSamples);
  const rng = mulberry32(seed);
  if (type === 'white') {
    for (let s = 0; s < numSamples; s++) out[s] = rng() * 2 - 1;
    return out;
  }
  if (type === 'babble' || type === 'session') {
    addBabble(out, sampleRate, rng);
  }
  if (type === 'session') {
    addFootTaps(out, sampleRate, rng);
    addClinks(out, sampleRate, rng);
  }
  return out;
}

function rms(buf) {
  let sum = 0;
  for (let s = 0; s < buf.length; s++) sum += buf[s] * buf[s];
  return Math.sqrt(sum / buf.length);
}

/**
 * Returns signal + noise mixed at the requested signal-to-noise ratio.
 * snrDb examples: 20 = quiet corner, 10 = lively pub, 0 = noise as loud
 * as the tune. type 'none' returns a copy of the signal.
 * @param {Float32Array} signal
 * @param {{type?: string, snrDb?: number, seed?: number}} options
 * @returns {Float32Array}
 */
export function mixNoise(signal, { type = 'none', snrDb = 10, seed = 1 } = {}, sampleRate = 44100) {
  if (type === 'none') return new Float32Array(signal);
  const noise = generateNoise(type, signal.length, sampleRate, seed);
  const signalRms = rms(signal);
  const noiseRms = rms(noise);
  const out = new Float32Array(signal.length);
  const scale = noiseRms > 0 ? (signalRms / noiseRms) * Math.pow(10, -snrDb / 20) : 0;
  let peak = 0;
  for (let s = 0; s < signal.length; s++) {
    out[s] = signal[s] + noise[s] * scale;
    peak = Math.max(peak, Math.abs(out[s]));
  }
  // Avoid clipping-like levels; keep headroom like a real mic input.
  if (peak > 0.95) {
    const norm = 0.95 / peak;
    for (let s = 0; s < out.length; s++) out[s] *= norm;
  }
  return out;
}
