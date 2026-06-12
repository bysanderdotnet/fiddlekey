/**
 * MLPitchHistogramDetector
 *
 * This detector implements the CREPE/SPICE-style pitch-tracking architecture from the
 * implementation plan while keeping the benchmark suite self-contained and browser-safe.
 * It is designed around a pluggable monophonic pitch tracker: callers may inject a
 * browser-compatible TensorFlow.js/ONNX CREPE or SPICE wrapper that returns dominant pitch
 * estimates for PCM frames, and the default tracker uses a lightweight normalized
 * autocorrelation estimator that behaves like a local pitch-tracking fallback when no model
 * asset is bundled. Each confident dominant-pitch estimate is converted to a 12-bin,
 * C-indexed pitch-class histogram so harmonic overtones are ignored instead of accumulated.
 * The histogram is kept in a rolling temporal history, normalized, and matched against the
 * shared major/minor key profiles with the standard profile-correlation logic.
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { KeyDetector } from '../detector.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { detectKey } from '../profile-matching.js';
import { frequencyToPitchClass } from './webaudio-pcp-detector.js';

const ANALYSIS_WINDOW_SECONDS = 5;
const EMIT_INTERVAL_MS = 500;
const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const MIN_FREQUENCY = 180;
const MAX_FREQUENCY = 3500;
const MIN_CONFIDENCE = 0.62;

/**
 * Lightweight browser-compatible pitch model options that can be wired into the
 * `pitchTracker` constructor option without changing detector registration.
 */
export const BROWSER_PITCH_TRACKER_CANDIDATES = [
  {
    id: 'crepe-tfjs',
    family: 'CREPE',
    runtime: 'TensorFlow.js',
    note: 'Use a TF.js CREPE wrapper when the app is willing to bundle TensorFlow.js and model weights.'
  },
  {
    id: 'spice-tfhub',
    family: 'SPICE',
    runtime: 'TensorFlow.js',
    note: 'Use the TF Hub SPICE model via a browser TF.js wrapper when external model assets are configured.'
  },
  {
    id: 'crepe-onnx',
    family: 'CREPE',
    runtime: 'ONNX Runtime Web',
    note: 'Use converted CREPE ONNX weights with onnxruntime-web in the existing Bourdon worker.'
  }
];

export class MLPitchHistogramDetector extends KeyDetector {
  constructor(options = {}) {
    super();
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.analysisWindowSeconds = options.analysisWindowSeconds ?? ANALYSIS_WINDOW_SECONDS;
    this.frameSize = options.frameSize ?? FRAME_SIZE;
    this.hopSize = options.hopSize ?? HOP_SIZE;
    this.minFrequency = options.minFrequency ?? MIN_FREQUENCY;
    this.maxFrequency = options.maxFrequency ?? MAX_FREQUENCY;
    this.minConfidence = options.minConfidence ?? MIN_CONFIDENCE;
    this.pitchTracker = options.pitchTracker ?? new AutocorrelationPitchTracker();
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.maxHistorySamples = Math.ceil(this.analysisWindowSeconds * this.sampleRate);
    this.lastAnalyzedOffset = 0;
    this.pitchClassHistory = [];
    this.maxPitchClassHistoryLength = 0;
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.maxHistorySamples = Math.ceil(this.analysisWindowSeconds * this.sampleRate);
    this.maxPitchClassHistoryLength = Math.ceil((this.analysisWindowSeconds * this.sampleRate) / this.hopSize);
    this.resetHistory();

    if (typeof this.pitchTracker.init === 'function') {
      await this.pitchTracker.init({
        sampleRate: this.sampleRate,
        frameSize: this.frameSize,
        minFrequency: this.minFrequency,
        maxFrequency: this.maxFrequency
      });
    }
  }

  process(pcmChunk) {
    if (!(pcmChunk instanceof Float32Array) || pcmChunk.length === 0) return null;

    this.addToHistory(pcmChunk);
    this.analyzeNewFrames();

    const now = Date.now();
    if (now - this.lastSendTime <= EMIT_INTERVAL_MS) return null;

    this.lastSendTime = now;
    const histogram = getAveragedChroma(this.pitchClassHistory);
    if (!histogram) return null;

    const rawDetection = detectKey(histogram);
    const smoothedDetection = this.smoother.add(rawDetection);

    if (smoothedDetection) {
      smoothedDetection.chroma = histogram;
      smoothedDetection.pitchHistogram = {
        frames: this.pitchClassHistory.length,
        tracker: this.pitchTracker.id ?? 'custom-pitch-tracker'
      };
    }

    return smoothedDetection;
  }

  addToHistory(pcmChunk) {
    const copy = new Float32Array(pcmChunk);
    this.audioHistory.push(copy);
    this.historySampleCount += copy.length;

    while (this.historySampleCount > this.maxHistorySamples && this.audioHistory.length > 1) {
      const removed = this.audioHistory.shift();
      this.historySampleCount -= removed.length;
      this.lastAnalyzedOffset = Math.max(0, this.lastAnalyzedOffset - removed.length);
    }

    if (this.historySampleCount > this.maxHistorySamples && this.audioHistory.length === 1) {
      const onlyChunk = this.audioHistory[0];
      const keepFrom = onlyChunk.length - this.maxHistorySamples;
      this.audioHistory[0] = onlyChunk.slice(Math.max(0, keepFrom));
      this.historySampleCount = this.audioHistory[0].length;
      this.lastAnalyzedOffset = Math.min(this.lastAnalyzedOffset, this.historySampleCount);
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

  analyzeNewFrames() {
    if (this.historySampleCount < this.frameSize) return;

    const audio = this.getHistoryAudio();
    let offset = Math.max(0, this.lastAnalyzedOffset);

    while (offset + this.frameSize <= audio.length) {
      const frame = audio.subarray(offset, offset + this.frameSize);
      const estimate = this.pitchTracker.estimatePitch(frame, this.sampleRate, {
        minFrequency: this.minFrequency,
        maxFrequency: this.maxFrequency
      });
      this.addPitchEstimate(estimate);
      offset += this.hopSize;
    }

    this.lastAnalyzedOffset = offset;
  }

  addPitchEstimate(estimate) {
    if (!estimate || estimate.confidence < this.minConfidence) return;
    if (estimate.frequency < this.minFrequency || estimate.frequency > this.maxFrequency) return;

    const pitchClassVector = new Array(12).fill(0);
    pitchClassVector[frequencyToPitchClass(estimate.frequency)] = estimate.confidence;
    this.pitchClassHistory.push(pitchClassVector);

    while (this.pitchClassHistory.length > this.maxPitchClassHistoryLength) {
      this.pitchClassHistory.shift();
    }
  }

  resetHistory() {
    this.audioHistory = [];
    this.historySampleCount = 0;
    this.lastAnalyzedOffset = 0;
    this.pitchClassHistory = [];
    this.lastSendTime = 0;
    this.smoother.clear();
  }

  destroy() {
    if (typeof this.pitchTracker.destroy === 'function') {
      this.pitchTracker.destroy();
    }
    this.resetHistory();
  }
}

export class AutocorrelationPitchTracker {
  constructor() {
    this.id = 'normalized-autocorrelation-fallback';
    this.sampleRate = 44100;
    this.frameSize = FRAME_SIZE;
    this.minFrequency = MIN_FREQUENCY;
    this.maxFrequency = MAX_FREQUENCY;
  }

  async init({ sampleRate, frameSize, minFrequency, maxFrequency }) {
    this.sampleRate = sampleRate;
    this.frameSize = frameSize;
    this.minFrequency = minFrequency;
    this.maxFrequency = maxFrequency;
  }

  estimatePitch(frame, sampleRate = this.sampleRate, options = {}) {
    return estimatePitchByAutocorrelation(frame, sampleRate, {
      minFrequency: options.minFrequency ?? this.minFrequency,
      maxFrequency: options.maxFrequency ?? this.maxFrequency
    });
  }
}

export function estimatePitchByAutocorrelation(frame, sampleRate, options = {}) {
  const minFrequency = options.minFrequency ?? MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? MAX_FREQUENCY;
  const minLag = Math.max(1, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minFrequency));
  const rms = calculateRms(frame);

  if (rms < 0.005 || maxLag <= minLag) {
    return { frequency: 0, confidence: 0 };
  }

  let bestLag = minLag;
  let bestCorrelation = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let i = 0; i + lag < frame.length; i++) {
      const left = frame[i];
      const right = frame[i + lag];
      cross += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    const correlation = denominator > 0 ? cross / denominator : 0;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  const refinedLag = refineLagWithParabolicInterpolation(frame, bestLag, sampleRate, minFrequency, maxFrequency);
  return {
    frequency: sampleRate / refinedLag,
    confidence: Math.max(0, Math.min(1, bestCorrelation))
  };
}

function refineLagWithParabolicInterpolation(frame, bestLag, sampleRate, minFrequency, maxFrequency) {
  const minLag = Math.max(1, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minFrequency));
  if (bestLag <= minLag || bestLag >= maxLag) return bestLag;

  const previous = getLagCorrelation(frame, bestLag - 1);
  const current = getLagCorrelation(frame, bestLag);
  const next = getLagCorrelation(frame, bestLag + 1);
  const denominator = previous - (2 * current) + next;

  if (Math.abs(denominator) < 1e-9) return bestLag;

  const shift = 0.5 * (previous - next) / denominator;
  return bestLag + Math.max(-0.5, Math.min(0.5, shift));
}

function getLagCorrelation(frame, lag) {
  let cross = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;

  for (let i = 0; i + lag < frame.length; i++) {
    const left = frame[i];
    const right = frame[i + lag];
    cross += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }

  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0 ? cross / denominator : 0;
}

function calculateRms(frame) {
  let energy = 0;
  for (const sample of frame) {
    energy += sample * sample;
  }
  return Math.sqrt(energy / frame.length);
}
