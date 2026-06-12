/**
 * EssentiaDetector
 *
 * Uses Essentia.js to extract HPCP (Harmonic Pitch Class Profile) features
 * from incoming PCM chunks, keeps a rolling history of them, and matches the
 * averaged chroma against the major/minor key profiles every 500 ms. Results
 * are stabilized with a majority-vote smoother.
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { KeyDetector } from '../detector.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { KeySmoother } from '../../utils/smoothing.js';
import { detectKey, rotate } from '../profile-matching.js';

const EMIT_INTERVAL_MS = 500;

export class EssentiaDetector extends KeyDetector {
  constructor() {
    super();
    this.essentia = null;
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.hpcpHistory = [];
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.smoother.clear();

    const module = EssentiaWASM.ready ? await EssentiaWASM.ready : EssentiaWASM;
    this.essentia = new Essentia(module);
  }

  process(pcmChunk) {
    if (!this.essentia) return null;

    // 1. Extract HPCP using Essentia
    const inputVector = this.essentia.arrayToVector(pcmChunk);

    const windowed = this.essentia.Windowing(inputVector, true, 4096, 'blackmanharris62');
    const spectrum = this.essentia.Spectrum(windowed.frame, 4096);
    // Essentia.js 0.1.3 SpectralPeaks: (spectrum, magnitudeThreshold, maxFrequency, maxPeaks, minFrequency, orderBy, sampleRate)
    const peaks = this.essentia.SpectralPeaks(
      spectrum.spectrum,
      0,            // magnitudeThreshold (Essentia C++ default)
      5000,         // maxFrequency (Essentia C++ default)
      100,          // maxPeaks (Essentia C++ default)
      0,            // minFrequency (Essentia C++ default)
      'frequency',  // orderBy (Essentia C++ default; required by HPCP)
      this.sampleRate
    );

    // Essentia.js 0.1.3 HPCP: (frequencies, magnitudes, bandPreset, bandSplitFrequency, harmonics, maxFrequency, maxShifted, minFrequency, nonLinear, normalized, referenceFrequency, sampleRate, size, weightType, windowSize)
    const hpcpResult = this.essentia.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true,         // bandPreset
      500,          // bandSplitFrequency
      0,            // harmonics
      5000.0,       // maxFrequency
      false,        // maxShifted
      40.0,         // minFrequency
      false,        // nonLinear
      'unitMax',    // normalized
      440.0,        // referenceFrequency
      this.sampleRate,
      12,              // size (Essentia C++ default)
      'squaredCosine', // weightType (Essentia C++ default)
      1               // windowSize (Essentia C++ default)
    );

    const features = this.essentia.vectorToArray(hpcpResult.hpcp);

    // Clean up Vectors (prevent memory leaks)
    inputVector.delete();
    windowed.frame.delete();
    spectrum.spectrum.delete();
    peaks.frequencies.delete();
    peaks.magnitudes.delete();
    hpcpResult.hpcp.delete();

    if (features) {
      // Normalize HPCP to keep the correlation step scale-invariant and robust to quiet frames.
      const normalizedFeatures = normalizeHpcp(features);

      // Essentia HPCP with reference 440Hz maps bin 0 to A.
      // Our profiles expect bin 0 to be C, so apply a 9-bin right rotation
      // before correlation (A at source bin 0 moves to target bin 9).
      const shiftedFeatures = rotate(normalizedFeatures, 9);
      this.hpcpHistory.push(shiftedFeatures);

      // Every 500ms, evaluate
      const now = Date.now();
      if (now - this.lastSendTime > EMIT_INTERVAL_MS) {
        this.lastSendTime = now;
        const averagedHpcp = getAveragedChroma(this.hpcpHistory);
        if (averagedHpcp) {
          const rawDetection = detectKey(averagedHpcp);
          const smoothedDetection = this.smoother.add(rawDetection);

          if (smoothedDetection) {
            smoothedDetection.chroma = averagedHpcp;
          }

          return smoothedDetection;
        }
      }
    }

    return null;
  }

  resetHistory() {
    this.hpcpHistory = [];
    this.smoother.clear();
    this.lastSendTime = 0;
  }

  destroy() {
    this.resetHistory();
    this.essentia = null;
  }
}

function normalizeHpcp(features) {
  const sanitized = Array.from(features, value => Number.isFinite(value) ? Math.max(0, value) : 0);
  const maxVal = Math.max(...sanitized);

  if (maxVal <= 0) {
    return sanitized;
  }

  return sanitized.map(value => value / maxVal);
}
