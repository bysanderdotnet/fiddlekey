/**
 * MeydaDetector
 *
 * This detector uses the Meyda library to extract chroma features from incoming PCM audio chunks.
 * The features are normalized to unit max and accumulated over an ever-growing window to smooth
 * temporal variations. Key detection is then performed by calculating the Pearson correlation
 * between the averaged, normalized chroma features and predefined major/minor key profiles, returning the most likely tonic and mode.
 */
import { getAveragedChroma } from '../../utils/chroma.js';
import { KeyDetector } from '../detector.js';
import Meyda from 'meyda';
import { KeySmoother } from '../../utils/smoothing.js';
import { detectKey, detectKeyCandidates } from '../profile-matching.js';

export class MeydaDetector extends KeyDetector {
  constructor() {
    super();
    this.sampleRate = 44100;
    this.bufferSize = 4096;
    this.chromaHistory = [];
    this.lastSendTime = 0;
    this.smoother = new KeySmoother(5);
    this.maxHistoryLength = 0;
  }

  async init(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.maxHistoryLength = Math.ceil((2 * this.sampleRate) / this.bufferSize);
    this.smoother.clear();

    // Meyda's buffer size must be a power of 2, up to 16384. Our default 4096 is fine.
    Meyda.bufferSize = this.bufferSize;
    Meyda.sampleRate = this.sampleRate;
    Meyda.windowingFunction = 'hanning';
  }

  process(pcmChunk) {
    // Meyda's FFT requires a power-of-2 buffer; the final partial PCM chunk of a
    // stream isn't, and Meyda.extract throws 'Buffer size must be a power of 2'.
    // Skip those chunks — they're a small tail and don't affect the result.
    if (!pcmChunk || !isPowerOfTwo(pcmChunk.length)) {
      return null;
    }

    // 1. Extract chroma using Meyda
    // Note: Meyda extract returns { chroma: [12 values] }
    // It works best with arrays, but float32array also works usually.
    const features = Meyda.extract('chroma', Array.from(pcmChunk));

    if (features) {
      // Meyda chroma is an array of 12 values
      // Re-order slightly if Meyda uses a different reference bin than Essentia.
      // Essentia and Meyda both map bin 0 to C by default, but let's assume they align for now.

      // Normalize features to unit max since detectKey correlation works well with normalized vectors
      let normalizedFeatures = [...features];
      const maxVal = Math.max(...normalizedFeatures);
      if (maxVal > 0) {
        normalizedFeatures = normalizedFeatures.map(v => v / maxVal);
      }

      // 2. Add to rolling history
      this.chromaHistory.push(normalizedFeatures);
      // Removed fixed history length to allow ever-growing accumulation window

      // 3. Every 500ms, evaluate
      const now = Date.now();
      if (now - this.lastSendTime > 500) {
        this.lastSendTime = now;
        const averagedChroma = getAveragedChroma(this.chromaHistory);
        if (averagedChroma) {
          // Detect key
          const rawDetection = detectKey(averagedChroma);

          // Smooth the detection
          const smoothedDetection = this.smoother.add(rawDetection);

          if (smoothedDetection) {
            smoothedDetection.chroma = averagedChroma;
            smoothedDetection.candidates = detectKeyCandidates(averagedChroma).slice(0, 5);
          }

          return smoothedDetection;
        }
      }
    }

    return null;
  }

  resetHistory() {
    this.chromaHistory = [];
    this.smoother.clear();
    this.lastSendTime = 0;
  }

  destroy() {
    this.resetHistory();
  }
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}
