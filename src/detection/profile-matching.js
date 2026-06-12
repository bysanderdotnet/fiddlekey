/**
 * Profile matching for 12-bin chroma key detection.
 *
 * Scores an incoming chroma vector against the Krumhansl-Schmuckler major and
 * minor key profiles rotated to every tonic (24 candidates total) using
 * Pearson correlation, with a small prior boost for keys common in folk
 * sessions. Fiddlekey deliberately stops at major/minor — no church modes.
 */
import { MODES, NOTE_NAMES } from '../utils/notes.js';

// Krumhansl-Schmuckler tone profiles, index 0 = tonic (C before rotation).
export const PROFILES = {
  [MODES.MAJOR]: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  [MODES.MINOR]: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
};

// Keys folk session tunes usually live in; gets a small score boost.
const COMMON_SESSION_KEYS = [
  { tonic: NOTE_NAMES.indexOf('D'), mode: MODES.MAJOR },
  { tonic: NOTE_NAMES.indexOf('G'), mode: MODES.MAJOR },
  { tonic: NOTE_NAMES.indexOf('A'), mode: MODES.MAJOR },
  { tonic: NOTE_NAMES.indexOf('C'), mode: MODES.MAJOR },
  { tonic: NOTE_NAMES.indexOf('F'), mode: MODES.MAJOR },
  { tonic: NOTE_NAMES.indexOf('E'), mode: MODES.MINOR },
  { tonic: NOTE_NAMES.indexOf('A'), mode: MODES.MINOR },
  { tonic: NOTE_NAMES.indexOf('B'), mode: MODES.MINOR },
  { tonic: NOTE_NAMES.indexOf('D'), mode: MODES.MINOR },
  { tonic: NOTE_NAMES.indexOf('G'), mode: MODES.MINOR }
];

let cachedProfiles = null;

export function rotate(arr, n) {
  const len = arr.length;
  const result = new Array(len);
  for (let i = 0; i < len; i++) {
    result[(i + n) % len] = arr[i];
  }
  return result;
}

/**
 * Detects the most likely key from a 12-bin chroma vector.
 * @param {number[]} chroma
 * @param {Object} [options] { commonKeyBoost }
 * @returns {Object|null} { tonic, mode, score, confidence, alternate }
 */
export function detectKey(chroma, options = {}) {
  const results = scoreKeyCandidates(chroma, options);
  if (results.length === 0) return null;

  const topMatch = results[0];
  const alternate = results[1] || topMatch;

  const confidence = topMatch.score > 0
    ? Math.max(0, Math.min(1, (topMatch.score - alternate.score) / topMatch.score * 5))
    : 0;

  return {
    tonic: NOTE_NAMES[topMatch.tonic],
    mode: topMatch.mode,
    score: topMatch.score,
    confidence,
    alternate: {
      tonic: NOTE_NAMES[alternate.tonic],
      mode: alternate.mode,
      score: alternate.score
    }
  };
}

/**
 * Scores all 24 tonic/mode candidates, best first.
 * @param {number[]} chroma
 * @param {Object} [options] { commonKeyBoost }
 * @returns {Object[]} [{ tonic, tonicName, mode, rawScore, score }]
 */
export function scoreKeyCandidates(chroma, options = {}) {
  const commonKeyBoost = options.commonKeyBoost ?? 0.05;

  if (!chroma || chroma.length !== 12) return [];

  const prepared = prepareInput(chroma);
  const results = getAllProfiles().map(p => {
    const rawScore = pearsonCorrelation(chroma, p.profile, prepared.mean, prepared.variance);
    return {
      tonic: p.tonic,
      tonicName: NOTE_NAMES[p.tonic],
      mode: p.mode,
      rawScore,
      score: p.isCommon ? rawScore + commonKeyBoost : rawScore
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

function getAllProfiles() {
  if (cachedProfiles) return cachedProfiles;

  const commonKeysSet = new Set(COMMON_SESSION_KEYS.map(k => `${k.tonic}-${k.mode}`));
  const profiles = [];

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, baseProfile] of Object.entries(PROFILES)) {
      profiles.push({
        tonic,
        mode,
        profile: rotate(baseProfile, tonic),
        isCommon: commonKeysSet.has(`${tonic}-${mode}`)
      });
    }
  }

  cachedProfiles = profiles;
  return profiles;
}

function prepareInput(chroma) {
  const n = chroma.length;
  const mean = chroma.reduce((a, b) => a + b, 0) / n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    variance += Math.pow(chroma[i] - mean, 2);
  }
  return { mean, variance };
}

function pearsonCorrelation(x, y, muX, denX) {
  const n = x.length;
  const muY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - muX;
    const diffY = y[i] - muY;
    num += diffX * diffY;
    denY += diffY * diffY;
  }

  const denominator = Math.sqrt(denX * denY);
  if (denominator === 0) return 0;
  return num / denominator;
}
