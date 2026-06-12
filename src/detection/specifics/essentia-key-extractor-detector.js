/**
 * KeyEssentiaKeyExtractorDetector
 *
 * This detector uses Essentia.js' high-level KeyExtractor algorithm to estimate
 * key directly from accumulated PCM audio. KeyExtractor internally computes
 * spectral peaks, applies spectral whitening, derives HPCP (Harmonic Pitch Class
 * Profile) features, and runs Essentia's built-in key correlation model. The
 * detector keeps a rolling audio window so each analysis has enough context for
 * stable tonal features, then temporally smooths the resulting key estimates.
 * Essentia natively reports major/minor scales, matching the app's modes.
 */
import { KeyDetector } from '../detector.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { MODES, NOTE_NAMES } from '../../utils/notes.js';

const ANALYSIS_INTERVAL_MS = 500;
const ANALYSIS_WINDOW_SECONDS = 4;
const FRAME_SIZE = 4096;
const HOP_SIZE = 2048;
const HPCP_SIZE = 36;
const MAX_FREQUENCY = 3500;
const MAXIMUM_SPECTRAL_PEAKS = 60;
const MIN_FREQUENCY = 180;
const PCP_THRESHOLD = 0.2;
const PROFILE_TYPE = 'bgate';
const SPECTRAL_PEAKS_THRESHOLD = 0.0001;
const TUNING_FREQUENCY = 440;
const WEIGHT_TYPE = 'cosine';
const WINDOW_TYPE = 'blackmanharris62';

const ENHARMONIC_TONICS = new Map([
  ['CB', 'B'],
  ['DB', 'C#'],
  ['EB', 'D#'],
  ['FB', 'E'],
  ['GB', 'F#'],
  ['AB', 'G#'],
  ['BB', 'A#'],
  ['B#', 'C'],
  ['E#', 'F']
]);

const SCALE_TO_MODE = new Map([
  ['major', MODES.MAJOR],
  ['minor', MODES.MINOR]
]);

export class KeyEssentiaKeyExtractorDetector extends KeyDetector {
  constructor() {
    super();
    this.essentia = null;
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.maxHistorySamples = ANALYSIS_WINDOW_SECONDS * this.sampleRate;
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.maxHistorySamples = Math.ceil(ANALYSIS_WINDOW_SECONDS * this.sampleRate);
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.lastSendTime = 0;
    this.smoother.clear();

    const module = EssentiaWASM.ready ? await EssentiaWASM.ready : EssentiaWASM;
    this.essentia = new Essentia(module);
  }

  process(pcmChunk) {
    if (!this.essentia) return null;

    this.addToHistory(pcmChunk);

    const now = Date.now();
    if (now - this.lastSendTime <= ANALYSIS_INTERVAL_MS) {
      return null;
    }
    this.lastSendTime = now;

    const audio = this.getHistoryAudio();
    if (audio.length < FRAME_SIZE) {
      return null;
    }

    const inputVector = this.essentia.arrayToVector(audio);

    try {
      const result = this.essentia.KeyExtractor(
        inputVector,
        true,                       // averageDetuningCorrection
        FRAME_SIZE,
        HOP_SIZE,
        HPCP_SIZE,
        MAX_FREQUENCY,
        MAXIMUM_SPECTRAL_PEAKS,
        MIN_FREQUENCY,
        PCP_THRESHOLD,
        PROFILE_TYPE,
        this.sampleRate,
        SPECTRAL_PEAKS_THRESHOLD,
        TUNING_FREQUENCY,
        WEIGHT_TYPE,
        WINDOW_TYPE
      );

      const rawDetection = normalizeKeyExtractorResult(result);
      const smoothedDetection = this.smoother.add(rawDetection);

      return smoothedDetection;
    } finally {
      inputVector.delete();
    }
  }

  resetHistory() {
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.lastSendTime = 0;
    this.smoother.clear();
  }

  destroy() {
    this.resetHistory();
    this.essentia = null;
  }

  addToHistory(pcmChunk) {
    const chunk = new Float32Array(pcmChunk);
    this.audioHistory.push(chunk);
    this.historySampleCount += chunk.length;

    while (this.historySampleCount > this.maxHistorySamples && this.audioHistory.length > 1) {
      const removed = this.audioHistory.shift();
      this.historySampleCount -= removed.length;
    }

    if (this.historySampleCount > this.maxHistorySamples && this.audioHistory.length === 1) {
      const onlyChunk = this.audioHistory[0];
      const keepFrom = onlyChunk.length - this.maxHistorySamples;
      this.audioHistory[0] = onlyChunk.slice(Math.max(0, keepFrom));
      this.historySampleCount = this.audioHistory[0].length;
    }
  }

  getHistoryAudio() {
    const audio = new Float32Array(this.historySampleCount);
    let offset = 0;

    for (const chunk of this.audioHistory) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }

    return audio;
  }
}

function normalizeKeyExtractorResult(result) {
  const tonic = normalizeTonic(result?.key);
  const mode = normalizeScale(result?.scale);

  if (!tonic || !mode) return null;

  return {
    tonic,
    mode,
    score: normalizeStrength(result?.strength),
    confidence: normalizeStrength(result?.strength),
    alternate: null
  };
}

function normalizeTonic(key) {
  if (typeof key !== 'string' || key.trim() === '') return null;

  const compact = key.trim().replace('♯', '#').replace('♭', 'b');
  const canonical = compact.charAt(0).toUpperCase() + compact.slice(1);

  if (NOTE_NAMES.includes(canonical)) {
    return canonical;
  }

  return ENHARMONIC_TONICS.get(canonical.toUpperCase()) ?? null;
}

function normalizeScale(scale) {
  if (typeof scale !== 'string') return null;
  return SCALE_TO_MODE.get(scale.trim().toLowerCase()) ?? null;
}

function normalizeStrength(strength) {
  return Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
}
