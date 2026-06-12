/**
 * Minimal ABC parser + deterministic fiddle-tone synthesizer for the
 * benchmark page. Converts abc/ fixtures to PCM on the fly (audio never
 * committed, R-005). Fully deterministic: no Math.random, no wall clock —
 * identical input always yields identical samples.
 */

const NOTE_LETTER_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

// Semitones from tonic up to the relative major root.
const MODE_TO_MAJOR_OFFSET = {
  major: 0,
  minor: 3,
  dorian: 10,
  phrygian: 8,
  lydian: 7,
  mixolydian: 5
};

const KEY_SUFFIX_TO_MODE = {
  '': 'major',
  maj: 'major',
  m: 'minor',
  min: 'minor',
  dor: 'dorian',
  phr: 'phrygian',
  lyd: 'lydian',
  mix: 'mixolydian'
};

/**
 * Per-letter accidental map (semitones) for the key signature of the
 * relative major of `tonic`/`mode`.
 */
export function keySignature(tonicPc, mode) {
  const majorPc = (tonicPc + MODE_TO_MAJOR_OFFSET[mode]) % 12;
  // majorPc = (7 * sharps) mod 12; sharps in 0..11, >6 means flats.
  let sharps = 0;
  while ((7 * sharps) % 12 !== majorPc) sharps++;
  const accidentals = {};
  if (sharps <= 6) {
    for (let i = 0; i < sharps; i++) accidentals[SHARP_ORDER[i]] = 1;
  } else {
    const flats = 12 - sharps;
    for (let i = 0; i < flats; i++) accidentals[FLAT_ORDER[i]] = -1;
  }
  return accidentals;
}

/**
 * Parses a simple single-voice ABC tune.
 * Supports: X/T/M/L/K headers, notes A-G/a-g with ^ _ = accidentals,
 * , and ' octave marks, integer multipliers and / fractions, z rests.
 * Repeats are ignored (the synthesizer loops the whole tune anyway).
 * @returns {{ title: string, key: {tonicPc:number, mode:string}, unitSec: number,
 *             notes: Array<{midi: number|null, units: number}> }}
 */
export function parseAbc(text, { unitSec = 0.25 } = {}) {
  const lines = text.split('\n');
  let title = '';
  let unitNote = 1 / 8;
  let key = null;
  const bodyLines = [];
  let inBody = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = /^([A-Z]):(.*)$/.exec(line);
    if (!inBody && header) {
      const [, field, value] = header;
      if (field === 'T') title = value.trim();
      if (field === 'L') {
        const [num, den] = value.trim().split('/').map(Number);
        unitNote = num / den;
      }
      if (field === 'K') {
        const k = /^([A-G])([#b]?)\s*(maj|min|mix|dor|phr|lyd|m)?/i.exec(value.trim());
        if (!k) throw new Error(`Unsupported K: field: ${value}`);
        let pc = NOTE_LETTER_TO_SEMITONE[k[1].toUpperCase()];
        if (k[2] === '#') pc = (pc + 1) % 12;
        if (k[2] === 'b') pc = (pc + 11) % 12;
        const mode = KEY_SUFFIX_TO_MODE[(k[3] || '').toLowerCase()];
        if (!mode) throw new Error(`Unsupported key mode in: ${value}`);
        key = { tonicPc: pc, mode };
        inBody = true; // K: ends the header per ABC spec
      }
      continue;
    }
    if (inBody) bodyLines.push(line);
  }

  if (!key) throw new Error('ABC tune has no K: header');
  const sig = keySignature(key.tonicPc, key.mode);

  const notes = [];
  const body = bodyLines.join(' ');
  let i = 0;
  while (i < body.length) {
    const ch = body[i];

    // Inline accidentals (override key signature for this note only).
    let accidental = null;
    if (ch === '^' || ch === '_' || ch === '=') {
      let acc = 0;
      while (body[i] === '^') { acc += 1; i++; }
      while (body[i] === '_') { acc -= 1; i++; }
      if (body[i] === '=') { acc = 0; i++; }
      accidental = acc;
    }

    const c = body[i];
    if (c === undefined) break;

    if (/[A-Ga-gz]/.test(c)) {
      i++;
      let midi = null;
      if (c !== 'z') {
        const letter = c.toUpperCase();
        const lower = c !== letter;
        let m = 60 + NOTE_LETTER_TO_SEMITONE[letter] + (lower ? 12 : 0);
        m += accidental !== null ? accidental : (sig[letter] || 0);
        while (body[i] === "'") { m += 12; i++; }
        while (body[i] === ',') { m -= 12; i++; }
        midi = m;
      }

      // Duration: digits multiply, '/' divides.
      let units = 1;
      let digits = '';
      while (/[0-9]/.test(body[i])) { digits += body[i]; i++; }
      if (digits) units = Number(digits);
      if (body[i] === '/') {
        i++;
        let den = '';
        while (/[0-9]/.test(body[i])) { den += body[i]; i++; }
        units /= den ? Number(den) : 2;
      }

      notes.push({ midi, units });
      continue;
    }

    i++; // bars, repeats, spaces, anything else: skip
  }

  // unitSec is the duration of one L: unit (default L:1/8 at 0.25s ≈ 120 bpm).
  return { title, key, unitSec: unitSec * (unitNote / (1 / 8)), notes };
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Renders a parsed/raw ABC tune to mono PCM with a fiddle-like timbre
 * (sawtooth-ish harmonic stack, gentle low-pass rolloff, 5.5 Hz vibrato,
 * short attack/release). Loops the tune until `durationSec` is filled.
 * Deterministic: same input → bit-identical Float32Array.
 * @param {string} abcText
 * @returns {Float32Array}
 */
export function synthesizeTune(abcText, { sampleRate = 44100, durationSec = 30, gain = 0.4 } = {}) {
  const tune = parseAbc(abcText);
  const totalSamples = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(totalSamples);

  const HARMONICS = 6;
  const VIBRATO_HZ = 5.5;
  const VIBRATO_CENTS = 9;
  const ATTACK = 0.012;
  const RELEASE = 0.035;

  let cursor = 0; // sample index
  let noteIndex = 0;
  while (cursor < totalSamples) {
    const note = tune.notes[noteIndex % tune.notes.length];
    noteIndex++;
    const noteSamples = Math.max(1, Math.round(note.units * tune.unitSec * sampleRate));
    if (note.midi !== null) {
      const f0 = midiToFreq(note.midi);
      const end = Math.min(cursor + noteSamples, totalSamples);
      const noteLenSec = noteSamples / sampleRate;
      for (let s = cursor; s < end; s++) {
        const t = (s - cursor) / sampleRate;
        // Vibrato fades in after 80ms, like a fiddler settling on the note.
        const vibDepth = Math.min(1, Math.max(0, (t - 0.08) / 0.15));
        const cents = VIBRATO_CENTS * vibDepth * Math.sin(2 * Math.PI * VIBRATO_HZ * t);
        const f = f0 * Math.pow(2, cents / 1200);
        let env = 1;
        if (t < ATTACK) env = t / ATTACK;
        const tail = noteLenSec - t;
        if (tail < RELEASE) env = Math.min(env, tail / RELEASE);
        let sample = 0;
        for (let h = 1; h <= HARMONICS; h++) {
          const hf = f * h;
          if (hf > sampleRate / 2) break;
          // 1/h sawtooth weights + bridge-ish low-pass around 3 kHz.
          const amp = (1 / h) / (1 + Math.pow(hf / 3000, 2));
          sample += amp * Math.sin(2 * Math.PI * hf * t);
        }
        out[s] += env * sample;
      }
    }
    cursor += noteSamples;
  }

  // Normalize to requested peak gain.
  let peak = 0;
  for (let s = 0; s < totalSamples; s++) peak = Math.max(peak, Math.abs(out[s]));
  if (peak > 0) {
    const scale = gain / peak;
    for (let s = 0; s < totalSamples; s++) out[s] *= scale;
  }
  return out;
}
