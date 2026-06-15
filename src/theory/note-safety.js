/**
 * src/theory/note-safety.js
 *
 * Core of the note-safety pivot. Turns ranked
 * detector key candidates (tonic + major/minor — detector internals only) into
 * the product answer: which notes are safe / careful / avoid to play right now.
 *
 * The UI must NOT read tonic/mode from here — only safe/careful/avoid/ambiguity.
 * major/minor here are internal note-set templates, never shown to the player.
 */
import { NOTE_NAMES } from '../utils/notes.js';

export const DEFAULT_NOTE_SAFETY_OPTIONS = {
  maxCandidates: 5,
  candidateScoreWindow: 0.18,
  safeThreshold: 0.68,
  carefulThreshold: 0.32,
  observedChromaBonus: 0.15,
  anchorBonus: 0.15,
  pentatonicBonus: 0.12,
  shadowBonus: 0.18,
  ambiguityGap: 0.18,
  // Map a detector candidate score (correlation-like) to overall confidence.
  // <= floor -> no confidence; >= ceil -> full confidence.
  confidenceFloor: 0.25,
  confidenceCeil: 0.85
};

// Internal note-set templates. Names are detector internals (modes were
// Bourdon's mistake) — never surface major/minor in the UI. `shadow` is a
// slightly wider set so we don't over-commit when a tune behaves like common
// folk modality (e.g. a flat seventh). Intervals are semitones from the tonic.
const INTERNAL_NOTE_TEMPLATES = {
  major: { scale: [0, 2, 4, 5, 7, 9, 11], pentatonic: [0, 2, 4, 7, 9], shadow: [0, 2, 4, 5, 7, 9, 10] },
  minor: { scale: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 3, 5, 7, 10], shadow: [0, 2, 3, 5, 7, 9, 10] }
};

// How strongly each scale degree (semitones from tonic) supports a note.
const DEGREE_WEIGHTS = new Map([
  [0, 1.00],  // centre / anchor
  [7, 0.95],  // fifth / anchor
  [4, 0.82],  // major third
  [3, 0.82],  // minor third
  [2, 0.75],  // second
  [9, 0.72],  // sixth
  [5, 0.55],  // fourth
  [10, 0.45], // flat seventh
  [11, 0.35], // major seventh
  [8, 0.35],  // minor sixth
  [1, 0.10],
  [6, 0.10]
]);

const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B' };

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function degreeWeight(interval) {
  return DEGREE_WEIGHTS.get((((interval % 12) + 12) % 12)) ?? 0;
}

/**
 * Pitch-class index 0..11 for a note name. Accepts sharps, flats, mixed case,
 * or an already-numeric index. Returns -1 for unrecognised input.
 */
export function noteToIndex(note) {
  if (typeof note === 'number' && Number.isFinite(note)) return (((note | 0) % 12) + 12) % 12;
  if (!note) return -1;
  const raw = String(note).trim();
  if (!raw) return -1;
  let n = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
  if (FLAT_TO_SHARP[n]) n = FLAT_TO_SHARP[n];
  return NOTE_NAMES.indexOf(n);
}

/** Canonical (sharp) note name for a pitch-class index. */
export function indexToNote(index) {
  return NOTE_NAMES[(((index | 0) % 12) + 12) % 12];
}

/**
 * Filter candidates to the top plausible few (within a score window of the
 * best) and assign normalised weights (summing to 1).
 */
function selectPlausible(candidates, opt) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const norm = [];
  for (const c of candidates) {
    const index = noteToIndex(c && c.tonic);
    if (index < 0) continue;
    const mode = String((c && c.mode) || 'major').toLowerCase() === 'minor' ? 'minor' : 'major';
    const score = Number.isFinite(c && c.score) ? c.score : 0;
    norm.push({ index, mode, score });
  }
  if (norm.length === 0) return [];

  norm.sort((a, b) => b.score - a.score);
  const topScore = norm[0].score;
  const plausible = norm
    .filter(c => c.score >= topScore - opt.candidateScoreWindow)
    .slice(0, opt.maxCandidates);

  let sum = 0;
  for (const c of plausible) sum += Math.max(0, c.score);
  for (const c of plausible) {
    c.weight = sum > 0 ? Math.max(0, c.score) / sum : 1 / plausible.length;
  }
  return plausible;
}

function emptyResult(status) {
  return {
    status,
    safe: [],
    careful: [],
    avoid: [],
    ambiguity: [],
    debug: { confidence: 0, candidates: [], scores: {} }
  };
}

/**
 * Convert ranked detector key candidates into safe/careful/avoid notes.
 *
 * @param {Object} input
 * @param {Array<{tonic:string|number, mode?:string, score?:number}>} input.candidates
 * @param {number[]} [input.observedChroma] 12-bin chroma actually heard (optional bonus)
 * @param {Object} [input.options] overrides for DEFAULT_NOTE_SAFETY_OPTIONS
 * @returns {{status, safe, careful, avoid, ambiguity, debug}}
 */
export function computeNoteSafety({ candidates, observedChroma, options } = {}) {
  const opt = { ...DEFAULT_NOTE_SAFETY_OPTIONS, ...(options || {}) };

  const plausible = selectPlausible(candidates, opt);
  if (plausible.length === 0) return emptyResult('listening');

  const referenceMax = degreeWeight(0) + opt.pentatonicBonus + opt.anchorBonus + opt.shadowBonus;
  const confidence = clamp01(
    (plausible[0].score - opt.confidenceFloor) / (opt.confidenceCeil - opt.confidenceFloor)
  );

  // 1. Weighted support from each candidate's internal note-set template.
  const raw = new Array(12).fill(0);
  const scaleSets = [];
  for (const c of plausible) {
    const template = INTERNAL_NOTE_TEMPLATES[c.mode] ?? INTERNAL_NOTE_TEMPLATES.major;
    const scaleSet = new Set();
    for (const interval of template.scale) {
      const p = (c.index + interval) % 12;
      raw[p] += c.weight * degreeWeight(interval);
      scaleSet.add(p);
    }
    for (const interval of template.pentatonic) {
      raw[(c.index + interval) % 12] += c.weight * opt.pentatonicBonus;
    }
    for (const interval of [0, 7]) {
      raw[(c.index + interval) % 12] += c.weight * opt.anchorBonus;
    }
    for (const interval of template.shadow) {
      raw[(c.index + interval) % 12] += c.weight * opt.shadowBonus;
    }
    scaleSets.push(scaleSet);
  }

  // 2. Normalise against the theoretical max (rewards candidate agreement),
  //    scale by overall confidence, then add a small observed-chroma bonus for
  //    notes actually heard. Chroma is noisy, so keep its influence small.
  const score = new Array(12);
  const hasChroma = observedChroma && observedChroma.length === 12;
  for (let p = 0; p < 12; p++) {
    let s = (raw[p] / referenceMax) * confidence;
    if (hasChroma) s += clamp01(observedChroma[p]) * opt.observedChromaBonus;
    score[p] = clamp01(s);
  }

  // 3. Bucket by threshold.
  const bucket = new Array(12);
  for (let p = 0; p < 12; p++) {
    bucket[p] = score[p] >= opt.safeThreshold ? 'safe'
      : score[p] >= opt.carefulThreshold ? 'careful'
        : 'avoid';
  }

  // 4. Ambiguity: chromatic-neighbour "which version" pairs (e.g. C / C#).
  //    Both notes are scale tones in some candidate, NO single candidate holds
  //    both (mutually exclusive), and their scores are close. Surface these as
  //    careful caution — never as a confident green note.
  const present = p => scaleSets.some(set => set.has(p));
  const coexists = (a, b) => scaleSets.some(set => set.has(a) && set.has(b));
  const ambiguousNotes = new Set();
  const ambiguity = [];
  for (let a = 0; a < 12; a++) {
    const b = (a + 1) % 12;
    if (present(a) && present(b) && !coexists(a, b) && Math.abs(score[a] - score[b]) < opt.ambiguityGap) {
      bucket[a] = 'careful';
      bucket[b] = 'careful';
      ambiguousNotes.add(a);
      ambiguousNotes.add(b);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      ambiguity.push({
        notes: [indexToNote(lo), indexToNote(hi)],
        reason: 'both versions are plausible; use carefully'
      });
    }
  }

  // 5. Build output.
  const topTonic = plausible[0].index;
  const anchorSet = new Set([topTonic % 12, (topTonic + 7) % 12]);
  const safe = [];
  const careful = [];
  const avoid = [];
  for (let p = 0; p < 12; p++) {
    const note = indexToNote(p);
    if (bucket[p] === 'safe') {
      safe.push({ note, safety: score[p], reason: anchorSet.has(p) ? 'anchor' : 'common' });
    } else if (bucket[p] === 'careful') {
      careful.push({ note, safety: score[p], reason: ambiguousNotes.has(p) ? 'ambiguous' : 'likely' });
    } else {
      avoid.push(note);
    }
  }
  safe.sort((x, y) => y.safety - x.safety);
  careful.sort((x, y) => y.safety - x.safety);
  for (const entry of safe) entry.safety = round2(entry.safety);
  for (const entry of careful) entry.safety = round2(entry.safety);

  const status = safe.length < 3 ? 'uncertain' : safe.length < 5 ? 'usable' : 'stable';

  return {
    status,
    safe,
    careful,
    avoid,
    ambiguity,
    debug: {
      confidence: round2(confidence),
      candidates: plausible.map(c => ({
        tonic: indexToNote(c.index),
        mode: c.mode,
        score: c.score,
        weight: round2(c.weight)
      })),
      scores: Object.fromEntries(NOTE_NAMES.map((n, i) => [n, round2(score[i])]))
    }
  };
}
